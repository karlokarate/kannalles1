export const APP_UPDATE_MANIFEST_CONTRACT = 'kh-checker-app-update';
export const APP_UPDATE_MANIFEST_VERSION = 1;
export const SERVICE_WORKER_BUILD_CONTRACT = 'kh-checker-service-worker-build';
export const SERVICE_WORKER_BUILD_VERSION = 1;
export const SERVICE_WORKER_BUILD_QUERY = 'KH_GET_BUILD_METADATA';
export const APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
export const APP_UPDATE_FOREGROUND_THROTTLE_MS = 15 * 60 * 1_000;

export type PwaUpdatePhase =
  | 'registering'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'applying'
  | 'offline'
  | 'unsupported'
  | 'error';

export interface AppUpdateManifest {
  contract: typeof APP_UPDATE_MANIFEST_CONTRACT;
  schemaVersion: typeof APP_UPDATE_MANIFEST_VERSION;
  appVersion: string;
  buildId: string;
  catalogVersion: string;
}

export interface ServiceWorkerBuildMetadata {
  contract: typeof SERVICE_WORKER_BUILD_CONTRACT;
  schemaVersion: typeof SERVICE_WORKER_BUILD_VERSION;
  appVersion: string;
  buildId: string;
}

export interface PwaUpdateSnapshot {
  phase: PwaUpdatePhase;
  currentAppVersion: string;
  currentBuildId: string;
  remoteAppVersion: string | null;
  remoteBuildId: string | null;
  preparedBuildId: string | null;
  checkedAt: number | null;
  message: string;
  updatePromptVisible: boolean;
  offlineReadyNoticeVisible: boolean;
  canCheck: boolean;
  canApply: boolean;
}

export interface PwaUpdateBridge {
  swUrl: string;
  registration: ServiceWorkerRegistration;
  readWorkerMetadata: (worker: ServiceWorker) => Promise<ServiceWorkerBuildMetadata | null>;
  activateWaiting: (worker: ServiceWorker, reloadPage: boolean) => Promise<void>;
  reloadPage: () => void;
}

export interface PwaUpdateEnvironment {
  currentAppVersion: string;
  currentBuildId: string;
  manifestUrl: string;
  supported: boolean;
  fetch: typeof fetch;
  isOnline: () => boolean;
  now: () => number;
}

export interface PwaUpdateController {
  getSnapshot: () => PwaUpdateSnapshot;
  subscribe: (listener: () => void) => () => void;
  attachServiceWorker: (bridge: PwaUpdateBridge) => void;
  checkForUpdates: (force?: boolean) => Promise<void>;
  applyUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  markUpdateAvailable: () => void;
  markOfflineReady: () => void;
  dismissOfflineReady: () => void;
  markRegistrationError: (error: unknown) => void;
}

type MutableUpdateState = Omit<PwaUpdateSnapshot, 'canCheck' | 'canApply'>;
type PreparedUpdate =
  | { mode: 'waiting'; buildId: string; worker: ServiceWorker }
  | { mode: 'reload'; buildId: string; worker: null };

function safeVersion(value: unknown): string | null {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)
    ? value
    : null;
}

function safeBuildId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9A-Za-z._:-]{1,128}$/u.test(value)
    ? value
    : null;
}

export function parseAppUpdateManifest(value: unknown): AppUpdateManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Die Updateinformationen sind kein gültiges Objekt.');
  }
  const candidate = value as Record<string, unknown>;
  const appVersion = safeVersion(candidate.appVersion);
  const buildId = safeBuildId(candidate.buildId);
  const catalogVersion = typeof candidate.catalogVersion === 'string' && candidate.catalogVersion.trim()
    ? candidate.catalogVersion.trim()
    : null;
  if (candidate.contract !== APP_UPDATE_MANIFEST_CONTRACT
    || candidate.schemaVersion !== APP_UPDATE_MANIFEST_VERSION
    || appVersion === null
    || buildId === null
    || catalogVersion === null) {
    throw new TypeError('Die Updateinformationen erfüllen den App-Vertrag nicht.');
  }
  return {
    contract: APP_UPDATE_MANIFEST_CONTRACT,
    schemaVersion: APP_UPDATE_MANIFEST_VERSION,
    appVersion,
    buildId,
    catalogVersion
  };
}

export function parseServiceWorkerBuildMetadata(value: unknown): ServiceWorkerBuildMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Die Service-Worker-Buildinformation ist kein gültiges Objekt.');
  }
  const candidate = value as Record<string, unknown>;
  const appVersion = safeVersion(candidate.appVersion);
  const buildId = safeBuildId(candidate.buildId);
  if (candidate.contract !== SERVICE_WORKER_BUILD_CONTRACT
    || candidate.schemaVersion !== SERVICE_WORKER_BUILD_VERSION
    || appVersion === null
    || buildId === null) {
    throw new TypeError('Die Service-Worker-Buildinformation erfüllt den Vertrag nicht.');
  }
  return {
    contract: SERVICE_WORKER_BUILD_CONTRACT,
    schemaVersion: SERVICE_WORKER_BUILD_VERSION,
    appVersion,
    buildId
  };
}

function technicalMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Unbekannter Fehler bei der Updateprüfung.';
}

function appendCacheBuster(url: string, now: number): string {
  const target = new URL(url);
  target.searchParams.set('kh-update-check', String(now));
  return target.href;
}

export function createPwaUpdateController(environment: PwaUpdateEnvironment): PwaUpdateController {
  const listeners = new Set<() => void>();
  const observedWorkers = new WeakSet<ServiceWorker>();
  const knownWorkerMetadata = new WeakMap<ServiceWorker, ServiceWorkerBuildMetadata>();
  const workerHandlers = new WeakMap<ServiceWorker, Promise<void>>();
  let bridge: PwaUpdateBridge | null = null;
  let preparedUpdate: PreparedUpdate | null = null;
  let inFlight: Promise<void> | null = null;
  let lastAttemptAt: number | null = null;
  let mutable: MutableUpdateState = {
    phase: environment.supported ? 'registering' : 'unsupported',
    currentAppVersion: environment.currentAppVersion,
    currentBuildId: environment.currentBuildId,
    remoteAppVersion: null,
    remoteBuildId: null,
    preparedBuildId: null,
    checkedAt: null,
    message: environment.supported
      ? 'Die automatische Updateprüfung wird vorbereitet.'
      : 'Automatische App-Updates werden in diesem Browser nicht unterstützt.',
    updatePromptVisible: false,
    offlineReadyNoticeVisible: false
  };
  let snapshot: PwaUpdateSnapshot = decorate(mutable);

  function decorate(state: MutableUpdateState): PwaUpdateSnapshot {
    return Object.freeze({
      ...state,
      canCheck: environment.supported
        && bridge !== null
        && state.phase !== 'checking'
        && state.phase !== 'applying',
      canApply: bridge !== null
        && state.phase === 'update-available'
        && preparedUpdate !== null
        && preparedUpdate.buildId !== environment.currentBuildId
    });
  }

  function publish(patch: Partial<MutableUpdateState>): void {
    mutable = { ...mutable, ...patch };
    snapshot = decorate(mutable);
    for (const listener of listeners) listener();
  }

  function clearPreparedUpdate(): void {
    preparedUpdate = null;
    if (mutable.preparedBuildId !== null) publish({ preparedBuildId: null });
  }

  function publishUpToDate(checkedAt = environment.now()): void {
    preparedUpdate = null;
    publish({
      phase: 'up-to-date',
      checkedAt,
      preparedBuildId: null,
      message: `FishIT KH Checker ${environment.currentAppVersion} ist aktuell.`,
      updatePromptVisible: false
    });
  }

  function publishPreparedUpdate(
    update: PreparedUpdate,
    showPrompt = true,
    message = 'Eine neue App-Version ist verfügbar.'
  ): void {
    if (update.buildId === environment.currentBuildId) {
      throw new Error('Der aktuelle App-Build darf nicht als Update angeboten werden.');
    }
    preparedUpdate = update;
    publish({
      phase: 'update-available',
      preparedBuildId: update.buildId,
      message,
      updatePromptVisible: showPrompt,
      offlineReadyNoticeVisible: false
    });
  }

  async function readMetadata(worker: ServiceWorker): Promise<ServiceWorkerBuildMetadata | null> {
    const known = knownWorkerMetadata.get(worker);
    if (known) return known;
    if (!bridge) return null;
    try {
      const metadata = await bridge.readWorkerMetadata(worker);
      if (metadata) knownWorkerMetadata.set(worker, metadata);
      return metadata;
    } catch {
      return null;
    }
  }

  async function activateCurrentBuildSilently(
    worker: ServiceWorker,
    checkedAt = environment.now()
  ): Promise<void> {
    if (!bridge || bridge.registration.waiting !== worker) return;
    clearPreparedUpdate();
    publish({
      phase: 'checking',
      message: 'Die aktuelle App ist bereits geladen; der Offline-Cache wird im Hintergrund synchronisiert …',
      updatePromptVisible: false
    });
    try {
      await bridge.activateWaiting(worker, false);
      publishUpToDate(checkedAt);
    } catch (error) {
      publish({
        phase: 'error',
        checkedAt,
        preparedBuildId: null,
        updatePromptVisible: false,
        message: `Die App ist aktuell, aber der Offline-Cache konnte nicht synchronisiert werden: ${technicalMessage(error)}`
      });
    }
  }

  async function handleWaitingWorkerInternal(
    worker: ServiceWorker,
    checkedAt = environment.now()
  ): Promise<void> {
    if (!bridge || worker.state === 'redundant') return;
    const metadata = await readMetadata(worker);
    if (!metadata) {
      // Workers deployed before the metadata contract are never offered blindly.
      // A no-store registration.update() will replace them with an identifiable
      // worker from the current deployment.
      publish({
        phase: 'checking',
        message: 'Der bereitgestellte Service Worker wird eindeutig geprüft …',
        updatePromptVisible: false
      });
      if (!inFlight && environment.isOnline()) void checkForUpdates(true);
      return;
    }

    const remoteBuildId = mutable.remoteBuildId;
    if (metadata.buildId === environment.currentBuildId) {
      if (remoteBuildId === null || remoteBuildId === environment.currentBuildId) {
        await activateCurrentBuildSilently(worker, checkedAt);
        return;
      }
      // The waiting worker belongs to the currently loaded (old) app while the
      // deployment manifest already identifies a newer build. Never activate it.
      publish({
        phase: 'checking',
        message: 'Die tatsächlich neuere App-Version wird vorbereitet …',
        updatePromptVisible: false
      });
      return;
    }

    if (remoteBuildId === null) {
      if (environment.isOnline()) {
        publish({
          phase: 'checking',
          message: 'Der bereitgestellte Build wird vor der Updateanzeige geprüft …',
          updatePromptVisible: false
        });
        if (!inFlight) void checkForUpdates(true);
      } else {
        publishPreparedUpdate(
          { mode: 'waiting', buildId: metadata.buildId, worker },
          true,
          'Eine andere App-Version ist bereits lokal vorbereitet und kann offline aktiviert werden.'
        );
      }
      return;
    }

    if (metadata.buildId === remoteBuildId && remoteBuildId !== environment.currentBuildId) {
      publishPreparedUpdate({ mode: 'waiting', buildId: metadata.buildId, worker });
      return;
    }

    if (remoteBuildId === environment.currentBuildId) {
      // The loaded page is already the deployment. A differently identified
      // waiting worker is stale, not an update. Keep the app usable and request
      // a fresh worker instead of presenting a broken button.
      publish({
        phase: 'checking',
        message: 'Ein veralteter Service Worker wird durch den aktuellen Build ersetzt …',
        updatePromptVisible: false,
        preparedBuildId: null
      });
      return;
    }

    publish({
      phase: 'checking',
      message: 'Eine veraltete Zwischenversion wird übersprungen; der aktuelle Deploy wird vorbereitet …',
      updatePromptVisible: false,
      preparedBuildId: null
    });
  }

  function handleWaitingWorker(
    worker: ServiceWorker,
    checkedAt = environment.now()
  ): Promise<void> {
    const existing = workerHandlers.get(worker);
    if (existing) return existing;
    const operation = handleWaitingWorkerInternal(worker, checkedAt).finally(() => {
      workerHandlers.delete(worker);
    });
    workerHandlers.set(worker, operation);
    return operation;
  }

  function observeInstallingWorker(worker: ServiceWorker | null): void {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    worker.addEventListener('statechange', () => {
      if (!bridge) return;
      if (worker.state === 'installed' && bridge.registration.waiting === worker) {
        void handleWaitingWorker(worker);
      } else if (worker.state === 'activated') {
        void inspectRegistration(environment.now());
      } else if (worker.state === 'redundant' && mutable.phase === 'checking') {
        publish({
          phase: 'error',
          message: 'Die neue App-Version konnte nicht vorbereitet werden. Bitte erneut prüfen.'
        });
      }
    });
  }

  async function inspectRegistration(checkedAt: number): Promise<void> {
    if (!bridge) return;
    const { registration } = bridge;
    if (registration.installing) {
      observeInstallingWorker(registration.installing);
      publish({
        phase: 'checking',
        checkedAt,
        message: mutable.remoteBuildId === environment.currentBuildId
          ? 'Der Offline-Cache des aktuellen Builds wird vorbereitet …'
          : 'Eine neue App-Version wurde gefunden und wird vorbereitet …',
        updatePromptVisible: false
      });
      return;
    }

    if (registration.waiting) {
      await handleWaitingWorker(registration.waiting, checkedAt);
      return;
    }

    if (registration.active) {
      const metadata = await readMetadata(registration.active);
      const remoteBuildId = mutable.remoteBuildId;
      if (remoteBuildId === environment.currentBuildId) {
        if (metadata && metadata.buildId !== environment.currentBuildId) {
          publish({
            phase: 'error',
            checkedAt,
            preparedBuildId: null,
            updatePromptVisible: false,
            message: 'Die App ist aktuell, aber der Offline-Cache verwendet noch einen alten Build. Bitte erneut prüfen.'
          });
          return;
        }
        publishUpToDate(checkedAt);
        return;
      }

      if (remoteBuildId && metadata?.buildId === remoteBuildId) {
        publishPreparedUpdate({ mode: 'reload', buildId: remoteBuildId, worker: null });
        return;
      }

      if (remoteBuildId && remoteBuildId !== environment.currentBuildId) {
        publish({
          phase: 'error',
          checkedAt,
          preparedBuildId: null,
          updatePromptVisible: false,
          message: 'Der neue Deploy wurde gefunden, aber der zugehörige Offline-Build ist noch nicht bereit. Bitte erneut prüfen.'
        });
        return;
      }
    }

    if (mutable.remoteBuildId === environment.currentBuildId) {
      publishUpToDate(checkedAt);
    } else {
      publish({
        phase: 'checking',
        checkedAt,
        message: 'Die Service-Worker-Installation wird abgeschlossen …',
        updatePromptVisible: false
      });
    }
  }

  function markUpdateAvailable(): void {
    const waiting = bridge?.registration.waiting;
    if (waiting) {
      void handleWaitingWorker(waiting);
    } else if (!inFlight && environment.isOnline()) {
      void checkForUpdates(true);
    }
  }

  function attachServiceWorker(nextBridge: PwaUpdateBridge): void {
    bridge = nextBridge;
    nextBridge.registration.addEventListener('updatefound', () => {
      observeInstallingWorker(nextBridge.registration.installing);
    });
    observeInstallingWorker(nextBridge.registration.installing);
    publish({
      phase: 'idle',
      message: 'Die Updateprüfung ist bereit.'
    });
    // A pre-existing waiting worker is classified only after its build metadata
    // is read. Its mere existence is never enough to show an update prompt.
    if (nextBridge.registration.waiting) markUpdateAvailable();
  }

  async function performCheck(force: boolean): Promise<void> {
    if (!environment.supported) {
      publish({
        phase: 'unsupported',
        message: 'Automatische App-Updates werden in diesem Browser nicht unterstützt.'
      });
      return;
    }
    if (!bridge) {
      publish({
        phase: 'error',
        message: 'Der Update-Dienst ist noch nicht bereit. Bitte gleich erneut prüfen.'
      });
      return;
    }
    if (mutable.phase === 'applying') return;

    const startedAt = environment.now();
    if (!force && lastAttemptAt !== null
      && startedAt - lastAttemptAt < APP_UPDATE_FOREGROUND_THROTTLE_MS) {
      return;
    }
    lastAttemptAt = startedAt;

    if (!environment.isOnline()) {
      if (bridge.registration.waiting) {
        await handleWaitingWorker(bridge.registration.waiting, startedAt);
        if (mutable.phase === 'update-available') return;
      }
      publish({
        phase: 'offline',
        message: 'Keine Verbindung zur Bereitstellungsseite. Die lokal gespeicherte App bleibt nutzbar.'
      });
      return;
    }

    publish({
      phase: 'checking',
      message: 'Die bereitgestellte App-Version wird ohne Cache geprüft …',
      updatePromptVisible: false
    });

    const requestInit: RequestInit = {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    };

    try {
      const manifestResponse = await environment.fetch(
        appendCacheBuster(environment.manifestUrl, startedAt),
        requestInit
      );
      if (!manifestResponse.ok) {
        throw new Error(`Updateinformationen antworten mit HTTP ${manifestResponse.status}.`);
      }
      const remote = parseAppUpdateManifest(await manifestResponse.json());
      publish({
        remoteAppVersion: remote.appVersion,
        remoteBuildId: remote.buildId
      });

      const serviceWorkerResponse = await environment.fetch(bridge.swUrl, requestInit);
      if (serviceWorkerResponse.status !== 200) {
        throw new Error(`Service Worker antwortet mit HTTP ${serviceWorkerResponse.status}.`);
      }

      if (!bridge.registration.installing) {
        await bridge.registration.update();
      } else {
        observeInstallingWorker(bridge.registration.installing);
      }

      await inspectRegistration(environment.now());
    } catch (error) {
      if (bridge.registration.waiting) {
        await handleWaitingWorker(bridge.registration.waiting);
        if (mutable.phase === 'update-available') return;
      }
      publish({
        phase: environment.isOnline() ? 'error' : 'offline',
        message: environment.isOnline()
          ? `Updateprüfung fehlgeschlagen: ${technicalMessage(error)}`
          : 'Die Verbindung wurde während der Updateprüfung unterbrochen. Die lokale App bleibt nutzbar.'
      });
    }
  }

  function checkForUpdates(force = false): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = performCheck(force).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function applyUpdate(): Promise<void> {
    if (!bridge || mutable.phase !== 'update-available' || !preparedUpdate) return;
    if (preparedUpdate.buildId === environment.currentBuildId) {
      clearPreparedUpdate();
      publishUpToDate();
      return;
    }

    const update = preparedUpdate;
    publish({
      phase: 'applying',
      message: 'Die neue App-Version wird aktiviert und der App-Cache ersetzt …',
      updatePromptVisible: true
    });
    try {
      if (update.mode === 'waiting') {
        if (bridge.registration.waiting !== update.worker) {
          throw new Error('Der vorbereitete Service Worker ist nicht mehr im Wartestatus.');
        }
        await bridge.activateWaiting(update.worker, true);
      } else {
        bridge.reloadPage();
      }
    } catch (error) {
      preparedUpdate = update;
      publish({
        phase: 'update-available',
        preparedBuildId: update.buildId,
        message: `Die Aktualisierung konnte nicht aktiviert werden: ${technicalMessage(error)}`,
        updatePromptVisible: true
      });
    }
  }

  function dismissUpdate(): void {
    publish({ updatePromptVisible: false });
  }

  function markOfflineReady(): void {
    if (mutable.phase === 'update-available' || mutable.phase === 'applying') return;
    publish({ offlineReadyNoticeVisible: true });
  }

  function dismissOfflineReady(): void {
    publish({ offlineReadyNoticeVisible: false });
  }

  function markRegistrationError(error: unknown): void {
    publish({
      phase: 'error',
      message: `Der Offline- und Update-Dienst konnte nicht gestartet werden: ${technicalMessage(error)}`
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attachServiceWorker,
    checkForUpdates,
    applyUpdate,
    dismissUpdate,
    markUpdateAvailable,
    markOfflineReady,
    dismissOfflineReady,
    markRegistrationError
  };
}

let browserController: PwaUpdateController | null = null;

export function getPwaUpdateController(): PwaUpdateController {
  if (browserController) return browserController;
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const manifestUrl = typeof document === 'undefined'
    ? 'app-update.json'
    : new URL('app-update.json', document.baseURI).href;
  browserController = createPwaUpdateController({
    currentAppVersion: __APP_VERSION__,
    currentBuildId: __BUILD_ID__,
    manifestUrl,
    supported,
    fetch: (input, init) => globalThis.fetch(input, init),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
    now: () => Date.now()
  });
  return browserController;
}
