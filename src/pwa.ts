import { registerSW } from 'virtual:pwa-register';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  getPwaUpdateController
} from './lib/pwaUpdate';

let started = false;

async function activateWaitingServiceWorker(
  registration: ServiceWorkerRegistration,
  reloadPage: boolean
): Promise<void> {
  const waiting = registration.waiting;

  // The worker can activate between the user's click and this callback. A
  // reload is then sufficient for a verified newer deployment; silent cache
  // reconciliation needs no further action.
  if (!waiting) {
    if (reloadPage) window.location.reload();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      waiting.removeEventListener('statechange', onStateChange);
      if (error) reject(error);
      else resolve();
    };
    const activateAndOptionallyReload = () => {
      finish();
      if (reloadPage) window.location.reload();
    };
    const onControllerChange = () => {
      activateAndOptionallyReload();
    };
    const onStateChange = () => {
      if (waiting.state === 'activated') {
        // controllerchange is not guaranteed for a first controller. The
        // worker is nevertheless active and its precache is complete.
        activateAndOptionallyReload();
      } else if (waiting.state === 'redundant') {
        finish(new Error('Der vorbereitete Service Worker wurde verworfen. Bitte erneut nach Updates suchen.'));
      }
    };
    const timeout = window.setTimeout(() => {
      finish(new Error('Die neue App-Version wurde nicht rechtzeitig aktiviert. Bitte erneut versuchen.'));
    }, 20_000);

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    waiting.addEventListener('statechange', onStateChange);
    // Workbox generateSW in prompt mode exposes this explicit activation
    // protocol. The caller decides whether a reload is required: a stale
    // cached shell reloads after consent, while a network-fresh shell silently
    // synchronizes only its older service-worker/cache state.
    waiting.postMessage({ type: 'SKIP_WAITING' });
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
        activateWaitingWorker: (reloadPage) => activateWaitingServiceWorker(registration, reloadPage)
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

      // Every launch verifies app-update.json before any waiting worker is
      // presented as an update. This distinguishes a genuinely stale cached
      // shell from a current network shell paired with an older registration.
      void controller.checkForUpdates(true);
    },
    onNeedRefresh() {
      // Workbox only reports lifecycle state here. Build identity is verified
      // separately against app-update.json before the UI may offer an update.
      controller.markWorkerWaiting();
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
