import { registerSW } from 'virtual:pwa-register';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  getPwaUpdateController,
  parseServiceWorkerBuildMetadata,
  SERVICE_WORKER_BUILD_QUERY,
  type ServiceWorkerBuildMetadata
} from './lib/pwaUpdate';

let started = false;
const WORKER_METADATA_TIMEOUT_MS = 2_500;
const WORKER_ACTIVATION_TIMEOUT_MS = 20_000;

async function readServiceWorkerMetadata(
  worker: ServiceWorker
): Promise<ServiceWorkerBuildMetadata | null> {
  if (worker.state === 'redundant') return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value: ServiceWorkerBuildMetadata | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.onmessage = null;
      channel.port1.close();
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), WORKER_METADATA_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      try {
        finish(parseServiceWorkerBuildMetadata(event.data));
      } catch {
        finish(null);
      }
    };
    try {
      worker.postMessage({ type: SERVICE_WORKER_BUILD_QUERY }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function activateWaitingServiceWorker(
  registration: ServiceWorkerRegistration,
  expectedWorker: ServiceWorker,
  reloadPage: boolean
): Promise<void> {
  if (registration.waiting !== expectedWorker) {
    if (registration.active === expectedWorker) {
      if (reloadPage) window.location.reload();
      return;
    }
    throw new Error('Der eindeutig geprüfte Service Worker wartet nicht mehr auf Aktivierung.');
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let reloadScheduled = false;
    const scheduleReload = () => {
      if (!reloadPage || reloadScheduled) return;
      reloadScheduled = true;
      window.location.reload();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      expectedWorker.removeEventListener('statechange', onStateChange);
      if (error) {
        reject(error);
        return;
      }
      resolve();
      scheduleReload();
    };
    const onControllerChange = () => finish();
    const onStateChange = () => {
      if (expectedWorker.state === 'activated') finish();
      else if (expectedWorker.state === 'redundant') {
        finish(new Error('Der vorbereitete Service Worker wurde verworfen. Bitte erneut prüfen.'));
      }
    };
    const timeout = window.setTimeout(() => {
      finish(new Error('Die neue App-Version wurde nicht rechtzeitig aktiviert. Bitte erneut versuchen.'));
    }, WORKER_ACTIVATION_TIMEOUT_MS);

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    expectedWorker.addEventListener('statechange', onStateChange);
    try {
      // Workbox generateSW with skipWaiting=false installs this message handler.
      // The exact metadata-verified worker is addressed directly; no first-install
      // or stale intermediate worker can accidentally receive the action.
      expectedWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Der Service Worker konnte nicht aktiviert werden.'));
    }
  });
}

export function startPwaUpdateRuntime(): void {
  if (started) return;
  started = true;

  const controller = getPwaUpdateController();
  if (!('serviceWorker' in navigator)) return;

  let lifecycleBound = false;

  registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration) {
        controller.markRegistrationError(new Error('Der Browser hat keine Service-Worker-Registrierung zurückgegeben.'));
        return;
      }

      controller.attachServiceWorker({
        swUrl,
        registration,
        readWorkerMetadata: readServiceWorkerMetadata,
        activateWaiting: (worker, reloadPage) =>
          activateWaitingServiceWorker(registration, worker, reloadPage),
        reloadPage: () => window.location.reload()
      });

      if (!lifecycleBound) {
        lifecycleBound = true;
        const checkWhenActive = () => {
          if (document.visibilityState === 'visible') void controller.checkForUpdates(false);
        };
        const checkWhenOnline = () => {
          void controller.checkForUpdates(true);
        };
        document.addEventListener('visibilitychange', checkWhenActive);
        window.addEventListener('focus', checkWhenActive);
        window.addEventListener('pageshow', checkWhenActive);
        window.addEventListener('online', checkWhenOnline);
        window.setInterval(checkWhenActive, APP_UPDATE_CHECK_INTERVAL_MS);
      }

      // Every launch checks manifest and sw.js with no-store semantics. A waiting
      // worker is offered only after its embedded build ID matches a genuinely
      // newer deployment; first installs and cache repairs stay silent.
      void controller.checkForUpdates(true);
    },
    onNeedRefresh() {
      // This callback can fire on lifecycle edges that are not real app updates.
      // The controller therefore classifies the exact waiting worker before UI.
      controller.markUpdateAvailable();
    },
    onOfflineReady() {
      controller.markOfflineReady();
    },
    onRegisterError(error) {
      console.warn('Service Worker registration failed', error);
      controller.markRegistrationError(error);
    }
  });
}
