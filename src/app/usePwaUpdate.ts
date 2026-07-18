import { useMemo, useSyncExternalStore } from 'react';
import {
  getPwaUpdateController,
  type PwaUpdateSnapshot
} from '../lib/pwaUpdate';

export interface PwaUpdateViewModel extends PwaUpdateSnapshot {
  checkForUpdates: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  dismissOfflineReady: () => void;
}

export function usePwaUpdate(): PwaUpdateViewModel {
  const controller = getPwaUpdateController();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  return useMemo(() => ({
    ...snapshot,
    checkForUpdates: () => controller.checkForUpdates(true),
    applyUpdate: controller.applyUpdate,
    dismissUpdate: controller.dismissUpdate,
    dismissOfflineReady: controller.dismissOfflineReady
  }), [controller, snapshot]);
}
