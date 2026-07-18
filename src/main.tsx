import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { startPwaUpdateRuntime } from './pwa';
import './styles.css';
import './pwa-update.css';

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

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Das Root-Element der App fehlt.');
  document.getElementById('compatibility-fallback')?.remove();

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );

  if (!isAndroidLocalFileViewer) startPwaUpdateRuntime();
}

void bootstrap().catch((error: unknown) => {
  const root = document.getElementById('root');
  if (!root) return;
  root.textContent = '';
  const main = document.createElement('main');
  main.className = 'fatal-error';
  main.setAttribute('role', 'alert');
  const heading = document.createElement('h1');
  heading.textContent = 'Die App konnte nicht gestartet werden';
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : 'Unbekannter Startfehler';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Neu laden';
  reload.addEventListener('click', () => window.location.reload());
  main.append(heading, message, reload);
  root.append(main);
});
