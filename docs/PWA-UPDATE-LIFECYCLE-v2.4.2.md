# PWA update lifecycle v2.4.2

The loaded application bundle, the deployment manifest and the exact service-worker build are three separate identities.

A user-facing update is valid only when all of the following are true:

1. `app-update.json` identifies a build different from the currently loaded application.
2. A service worker is fully installed and waiting, or already active and ready for reload.
3. The worker responds with build metadata matching the remote deployment build exactly.

A first service-worker installation, a cache repair after Cache Storage was cleared, and a stale intermediate worker must never produce an update button.

When the user accepts a genuine update, the app sends `SKIP_WAITING` only to the metadata-verified worker, waits for activation/controller handover, reloads the page and lets Workbox remove obsolete precache entries. LocalStorage, IndexedDB, OPFS catalog slots and user calibration data are not cleared.
