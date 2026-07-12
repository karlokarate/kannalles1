import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

const isAndroidLocalFileViewer =
  ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  && /\/storage\/emulated\//i.test(window.location.pathname);

async function cleanLocalViewerState(): Promise<void> {
  if (!isAndroidLocalFileViewer) return;
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('kh-') || /workbox|precache/i.test(name))
          .map((name) => caches.delete(name))
      );
    }
  } catch {
    // The local viewer remains usable even when it does not expose these APIs.
  }
}

async function bootstrap() {
  await cleanLocalViewerState();

  if (!isAndroidLocalFileViewer) {
    registerSW({ immediate: true });
  }

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Das Root-Element der App fehlt.');

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
