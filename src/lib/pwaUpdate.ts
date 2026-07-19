export const APP_UPDATE_MANIFEST_CONTRACT = 'kh-checker-app-update';
export const APP_UPDATE_MANIFEST_VERSION = 1;
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

export interface PwaUpdateSnapshot {
  phase: PwaUpdatePhase;
  currentAppVersion: string;
  currentBuildId: string;
  remoteAppVersion: string | null;
  remoteBuildId: string | null;
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
  activateWaitingWorker: (reloadPage: boolean) => Promise<void>;
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
  markWorkerWaiting: () => void;
  markOfflineReady: () => void;
  dismissOfflineReady: () => void;
  markRegistrationError: (error: unknown) => void;
}

type MutableUpdateState = Omit<PwaUpdateSnapshot, 'canCheck' | 'canApply'>;

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
  let bridge: PwaUpdateBridge | null = null;
  let inFlight: Promise<void> | null = null;
  let silentActivation: Promise<void> | null = null;
  let lastAttemptAt: number | null = null;
  const observedWorkers = new WeakSet<ServiceWorker>();
  let mutable: MutableUpdateState = {
    phase: environment.supported ? 'registering' : 'unsupported',
    currentAppVersion: environment.currentAppVersion,
    currentBuildId: environment.currentBuildId,
    remoteAppVersion: null,
    remoteBuildId: null,
    checkedAt: null,
    message: environment.supported
      ? 'Die automatische Updateprüfung wird vorbereitet.'
      : 'Automatische App-Updates werden in diesem Browser nicht unterstützt.',
    updatePromptVisible: false,
    offlineReadyNoticeVisible: false
  };
  let snapshot: PwaUpdateSnapshot = decorate(mutable);

  function remoteDiffersFromCurrentBuild(state: MutableUpdateState): boolean {
    return state.remoteBuildId !== null && state.remoteBuildId !== state.currentBuildId;
  }

  function decorate(state: MutableUpdateState): PwaUpdateSnapshot {
    return Object.freeze({
      ...state,
      canCheck: environment.supported
        && bridge !== null
        && state.phase !== 'checking'
        && state.phase !== 'applying',
      canApply: bridge !== null
        && state.phase === 'update-available'
        && remoteDiffersFromCurrentBuild(state)
    });
  }

  function publish(patch: Partial<MutableUpdateState>): void {
    mutable = { ...mutable, ...patch };
    snapshot = decorate(mutable);
    for (const listener of listeners) listener();
  }

  function publishCurrentBuild(checkedAt = mutable.checkedAt ?? environment.now()): void {
    publish({
      phase: 'up-to-date',
      checkedAt,
      message: `FishIT KH Checker ${environment.currentAppVersion} ist aktuell.`,
      updatePromptVisible: false
    });
  }

  function publishVerifiedUpdate(message = 'Eine neue App-Version ist verfügbar.'): void {
    const showPrompt = mutable.phase === 'update-available'
      ? mutable.updatePromptVisible
      : true;
    publish({
      phase: 'update-available',
      message,
      updatePromptVisible: showPrompt,
      offlineReadyNoticeVisible: false
    });
  }

  async function reconcileWaitingWorker(checkedAt = mutable.checkedAt ?? environment.now()): Promise<boolean> {
    if (!bridge?.registration.waiting) return false;

    // A waiting worker alone is not proof of a newer app. It can also be the
    // worker for the exact build already loaded from the network after Cache
    // Storage was cleared while an older registration remained active.
    if (mutable.remoteBuildId === null) {
      publish({
        phase: environment.isOnline() ? 'checking' : 'offline',
        message: environment.isOnline()
          ? 'Der lokale Service Worker wird mit dem bereitgestellten Build abgeglichen …'
          : 'Ein vorbereiteter Service Worker wurde gefunden, kann offline aber noch keinem Build sicher zugeordnet werden.',
        updatePromptVisible: false
      });
      return true;
    }

    if (remoteDiffersFromCurrentBuild(mutable)) {
      publish({ checkedAt });
      publishVerifiedUpdate(environment.isOnline()
        ? undefined
        : 'Eine verifizierte neue App-Version ist bereits lokal vorbereitet und kann offline aktiviert werden.');
      return true;
    }

    if (silentActivation) {
      await silentActivation;
      return true;
    }

    publish({
      phase: 'checking',
      message: 'Der Offline-Cache wird mit der bereits geladenen aktuellen App-Version synchronisiert …',
      updatePromptVisible: false
    });
    silentActivation = bridge.activateWaitingWorker(false)
      .then(() => {
        publishCurrentBuild(checkedAt);
      })
      .catch((error) => {
        publish({
          phase: 'error',
          checkedAt,
          message: `Die App ist aktuell, aber der Offline-Cache konnte nicht synchronisiert werden: ${technicalMessage(error)}`,
          updatePromptVisible: false
        });
      })
      .finally(() => {
        silentActivation = null;
      });
    await silentActivation;
    return true;
  }

  function observeInstallingWorker(worker: ServiceWorker | null): void {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && bridge?.registration.waiting) {
        markWorkerWaiting();
      } else if (worker.state === 'activated'
        && mutable.remoteBuildId === mutable.currentBuildId
        && !bridge?.registration.waiting) {
        publishCurrentBuild();
      } else if (worker.state === 'redundant' && mutable.phase === 'checking') {
        publish({
          phase: 'error',
          message: 'Die neue App-Version konnte nicht vorbereitet werden. Bitte erneut prüfen.',
          updatePromptVisible: false
        });
      }
    });
  }

  function markWorkerWaiting(): void {
    if (!bridge?.registration.waiting) return;
    void reconcileWaitingWorker();
  }

  function attachServiceWorker(nextBridge: PwaUpdateBridge): void {
    bridge = nextBridge;
    nextBridge.registration.addEventListener('updatefound', () => {
      observeInstallingWorker(nextBridge.registration.installing);
    });
    observeInstallingWorker(nextBridge.registration.installing);

    // Do not announce an update before app-update.json has proven that the
    // deployed build differs from the JavaScript bundle currently executing.
    if (nextBridge.registration.waiting) {
      markWorkerWaiting();
      return;
    }
    publish({
      phase: 'idle',
      message: 'Die Updateprüfung ist bereit.'
    });
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
        await reconcileWaitingWorker(startedAt);
        return;
      }
      publish({
        phase: 'offline',
        message: 'Keine Verbindung zur Bereitstellungsseite. Die lokal gespeicherte App bleibt nutzbar.',
        updatePromptVisible: false
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

      await bridge.registration.update();
      const checkedAt = environment.now();

      if (bridge.registration.waiting) {
        await reconcileWaitingWorker(checkedAt);
        return;
      }

      const installing = bridge.registration.installing;
      if (installing) {
        observeInstallingWorker(installing);
        publish({
          phase: 'checking',
          checkedAt,
          message: remote.buildId === environment.currentBuildId
            ? 'Der Offline-Cache wird für die bereits aktuelle App-Version vorbereitet …'
            : 'Eine neue Version wurde gefunden und wird für die Aktualisierung vorbereitet …',
          updatePromptVisible: false
        });
        return;
      }

      if (remote.buildId === environment.currentBuildId) {
        publishCurrentBuild(checkedAt);
        return;
      }

      publish({
        phase: 'error',
        checkedAt,
        message: 'Eine neue Version wurde gefunden, konnte aber noch nicht vorbereitet werden. Bitte erneut prüfen.',
        updatePromptVisible: false
      });
    } catch (error) {
      if (bridge.registration.waiting) {
        await reconcileWaitingWorker();
        return;
      }
      publish({
        phase: environment.isOnline() ? 'error' : 'offline',
        message: environment.isOnline()
          ? `Updateprüfung fehlgeschlagen: ${technicalMessage(error)}`
          : 'Die Verbindung wurde während der Updateprüfung unterbrochen. Die lokale App bleibt nutzbar.',
        updatePromptVisible: false
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
    if (!bridge || mutable.phase !== 'update-available' || !remoteDiffersFromCurrentBuild(mutable)) return;
    publish({
      phase: 'applying',
      message: 'Die neue App-Version wird aktiviert und der alte App-Cache ersetzt …',
      updatePromptVisible: true
    });
    try {
      await bridge.activateWaitingWorker(true);
    } catch (error) {
      publish({
        phase: 'update-available',
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
      message: `Der Offline- und Update-Dienst konnte nicht gestartet werden: ${technicalMessage(error)}`,
      updatePromptVisible: false
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
    markWorkerWaiting,
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
