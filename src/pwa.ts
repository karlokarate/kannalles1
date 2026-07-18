import { registerSW } from 'virtual:pwa-register';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  getPwaUpdateController
} from './lib/pwaUpdate';

let started = false;

async function activateWaitingServiceWorker(registration: ServiceWorkerRegistration): Promise<void> {
  if (!registration.waiting) {
    await registration.update();
  }
  const waiting = registration.waiting;
  if (!waiting) {
    throw new Error('Die vorbereitete App-Version ist noch nicht aktivierbar. Bitte erneut nach Updates suchen.');
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (error) reject(error);
      else resolve();
    };
    const onControllerChange = () => {
      finish();
      window.location.reload();
    };
    const timeout = window.setTimeout(() => {
      finish(new Error('Die neue App-Version wurde nicht rechtzeitig aktiviert. Bitte erneut versuchen.'));
    }, 20_000);

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    // Workbox generateSW in prompt mode exposes this explicit activation
    // protocol. Address the registration's actual waiting worker directly so
    // externally triggered registration.update() checks cannot desynchronise
    // the virtual module's internal Workbox instance.
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
        applyUpdate: () => activateWaitingServiceWorker(registration)
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

      // Every launch checks the currently deployed manifest and service worker
      // with no-store semantics. The app remains usable if that network check fails.
      void controller.checkForUpdates(true);
    },
    onNeedRefresh() {
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
