import { registerSW } from 'virtual:pwa-register';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  getPwaUpdateController
} from './lib/pwaUpdate';

let started = false;

export function startPwaUpdateRuntime(): void {
  if (started) return;
  started = true;

  const controller = getPwaUpdateController();
  if (!('serviceWorker' in navigator)) return;

  let updateServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => undefined;
  let lifecycleBound = false;

  updateServiceWorker = registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration) {
        controller.markRegistrationError(new Error('Der Browser hat keine Service-Worker-Registrierung zurückgegeben.'));
        return;
      }

      controller.attachServiceWorker({
        swUrl,
        registration,
        applyUpdate: () => updateServiceWorker(true)
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
