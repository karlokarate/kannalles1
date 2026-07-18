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
  applyUpdate: () => Promise<void>;
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

  function decorate(state: MutableUpdateState): PwaUpdateSnapshot {
    return Object.freeze({
      ...state,
      canCheck: environment.supported
        && bridge !== null
        && state.phase !== 'checking'
        && state.phase !== 'applying',
      canApply: bridge !== null && state.phase === 'update-available'
    });
  }

  function publish(patch: Partial<MutableUpdateState>): void {
    mutable = { ...mutable, ...patch };
    snapshot = decorate(mutable);
    for (const listener of listeners) listener();
  }

  function publishWaitingUpdate(showPrompt: boolean, message = 'Eine neue App-Version ist verfügbar.'): void {
    publish({
      phase: 'update-available',
      message,
      updatePromptVisible: showPrompt,
      offlineReadyNoticeVisible: false
    });
  }

  function preserveWaitingUpdate(message?: string): void {
    const showPrompt = mutable.phase === 'update-available'
      ? mutable.updatePromptVisible
      : true;
    publishWaitingUpdate(showPrompt, message);
  }

  function observeInstallingWorker(worker: ServiceWorker | null): void {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && bridge?.registration.waiting) {
        markUpdateAvailable();
      } else if (worker.state === 'redundant' && mutable.phase === 'checking') {
        publish({
          phase: 'error',
          message: 'Die neue App-Version konnte nicht vorbereitet werden. Bitte erneut prüfen.'
        });
      }
    });
  }

  function markUpdateAvailable(): void {
    publishWaitingUpdate(true);
  }

  function attachServiceWorker(nextBridge: PwaUpdateBridge): void {
    bridge = nextBridge;
    nextBridge.registration.addEventListener('updatefound', () => {
      observeInstallingWorker(nextBridge.registration.installing);
    });
    observeInstallingWorker(nextBridge.registration.installing);
    if (nextBridge.registration.waiting) {
      markUpdateAvailable();
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

    // A worker that is already waiting is a complete, locally downloaded
    // update. It remains actionable without a network connection and a
    // dismissed banner must not reappear on every focus event.
    if (bridge.registration.waiting) {
      preserveWaitingUpdate(environment.isOnline()
        ? undefined
        : 'Eine neue App-Version ist bereits lokal vorbereitet und kann auch offline aktiviert werden.');
      return;
    }

    if (!environment.isOnline()) {
      publish({
        phase: 'offline',
        message: 'Keine Verbindung zur Bereitstellungsseite. Die lokal gespeicherte App bleibt nutzbar.'
      });
      return;
    }

    publish({
      phase: 'checking',
      message: 'Die bereitgestellte App-Version wird ohne Cache geprüft …'
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
      if (mutable.phase === 'update-available') {
        publish({ checkedAt });
        return;
      }
      if (bridge.registration.waiting) {
        publish({ checkedAt });
        markUpdateAvailable();
        return;
      }

      if (remote.buildId === environment.currentBuildId) {
        publish({
          phase: 'up-to-date',
          checkedAt,
          message: `FishIT KH Checker ${environment.currentAppVersion} ist aktuell.`
        });
        return;
      }

      const installing = bridge.registration.installing;
      if (installing) {
        observeInstallingWorker(installing);
        publish({
          phase: 'checking',
          checkedAt,
          message: 'Eine neue Version wurde gefunden und wird für die Aktualisierung vorbereitet …'
        });
        return;
      }

      publish({
        phase: 'error',
        checkedAt,
        message: 'Eine neue Version wurde gefunden, konnte aber noch nicht vorbereitet werden. Bitte erneut prüfen.'
      });
    } catch (error) {
      if (bridge.registration.waiting) {
        preserveWaitingUpdate('Eine neue App-Version ist bereits lokal vorbereitet und kann trotz fehlgeschlagener Onlineprüfung aktiviert werden.');
        return;
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
    if (!bridge || mutable.phase !== 'update-available') return;
    publish({
      phase: 'applying',
      message: 'Die neue App-Version wird aktiviert …',
      updatePromptVisible: true
    });
    try {
      await bridge.applyUpdate();
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
