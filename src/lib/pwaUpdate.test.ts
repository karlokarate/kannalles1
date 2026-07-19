import { describe, expect, it, vi } from 'vitest';
import {
  APP_UPDATE_MANIFEST_CONTRACT,
  APP_UPDATE_MANIFEST_VERSION,
  createPwaUpdateController,
  parseAppUpdateManifest,
  type PwaUpdateBridge,
  type PwaUpdateEnvironment
} from './pwaUpdate';

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
}

class FakeRegistration extends EventTarget {
  waiting: ServiceWorker | null = null;
  installing: ServiceWorker | null = null;
  active: ServiceWorker | null = null;
  update = vi.fn(async () => undefined);
}

function manifest(buildId = 'build-current') {
  return {
    contract: APP_UPDATE_MANIFEST_CONTRACT,
    schemaVersion: APP_UPDATE_MANIFEST_VERSION,
    appVersion: '2.4.2',
    buildId,
    catalogVersion: 'production-v1'
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function textResponse(value = 'service-worker', status = 200): Response {
  return new Response(value, { status });
}

function environment(overrides: Partial<PwaUpdateEnvironment> = {}) {
  let now = 1_700_000_000_000;
  const fetchMock = vi.fn<FetchFunction>(async (input) =>
    String(input).includes('app-update.json')
      ? jsonResponse(manifest())
      : textResponse()
  );
  const value: PwaUpdateEnvironment = {
    currentAppVersion: '2.4.2',
    currentBuildId: 'build-current',
    manifestUrl: 'https://example.test/app/app-update.json',
    supported: true,
    fetch: fetchMock,
    isOnline: () => true,
    now: () => now,
    ...overrides
  };
  return {
    value,
    fetch: fetchMock,
    advance(milliseconds: number) {
      now += milliseconds;
    }
  };
}

function attach(
  controller: ReturnType<typeof createPwaUpdateController>,
  registration = new FakeRegistration(),
  activateWaitingWorker = vi.fn(async (_reloadPage: boolean) => {
    registration.active = registration.waiting;
    registration.waiting = null;
  })
) {
  const bridge: PwaUpdateBridge = {
    swUrl: 'https://example.test/app/sw.js',
    registration: registration as unknown as ServiceWorkerRegistration,
    activateWaitingWorker
  };
  controller.attachServiceWorker(bridge);
  return { registration, activateWaitingWorker };
}

describe('parseAppUpdateManifest', () => {
  it('accepts the exact versioned deployment contract', () => {
    expect(parseAppUpdateManifest(manifest())).toEqual(manifest());
  });

  it.each([
    null,
    [],
    { ...manifest(), contract: 'other' },
    { ...manifest(), schemaVersion: 2 },
    { ...manifest(), appVersion: 'latest' },
    { ...manifest(), buildId: '../unsafe' },
    { ...manifest(), catalogVersion: '' }
  ])('rejects malformed deployment metadata: %j', (value) => {
    expect(() => parseAppUpdateManifest(value)).toThrow();
  });
});

describe('PWA deployment update controller', () => {
  it('checks manifest and service worker without cache on startup', async () => {
    const env = environment();
    const controller = createPwaUpdateController(env.value);
    const { registration } = attach(controller);

    await controller.checkForUpdates(true);

    expect(env.fetch).toHaveBeenCalledTimes(2);
    const [manifestUrl, manifestInit] = env.fetch.mock.calls[0];
    expect(String(manifestUrl)).toContain('app-update.json?kh-update-check=');
    expect(manifestInit).toMatchObject({
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    });
    expect(env.fetch.mock.calls[1][0]).toBe('https://example.test/app/sw.js');
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'up-to-date',
      remoteBuildId: 'build-current',
      checkedAt: 1_700_000_000_000,
      updatePromptVisible: false,
      canCheck: true,
      canApply: false
    });
  });

  it('never treats a waiting worker as an update before the deployed build is verified', () => {
    const env = environment();
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker() as unknown as ServiceWorker;

    attach(controller, registration);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'checking',
      remoteBuildId: null,
      updatePromptVisible: false,
      canApply: false
    });
  });

  it('silently synchronizes an old registration when the network-loaded page is already the deployed build', async () => {
    const env = environment();
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker() as unknown as ServiceWorker;
    const { activateWaitingWorker } = attach(controller, registration);

    await controller.checkForUpdates(true);

    expect(activateWaitingWorker).toHaveBeenCalledWith(false);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'up-to-date',
      currentBuildId: 'build-current',
      remoteBuildId: 'build-current',
      updatePromptVisible: false,
      canApply: false
    });
  });

  it('offers a user update only when the deployed build differs from the executing cached shell', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse(manifest('build-new'))
        : textResponse()
    );
    const env = environment({ fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker() as unknown as ServiceWorker;
    const { activateWaitingWorker } = attach(controller, registration);

    expect(controller.getSnapshot().updatePromptVisible).toBe(false);
    await controller.checkForUpdates(true);

    expect(activateWaitingWorker).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      currentBuildId: 'build-current',
      remoteBuildId: 'build-new',
      updatePromptVisible: true,
      canApply: true
    });

    await controller.applyUpdate();
    expect(activateWaitingWorker).toHaveBeenCalledWith(true);
    expect(controller.getSnapshot().phase).toBe('applying');
  });

  it('deduplicates concurrent checks and throttles foreground checks', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const fetchMock = vi.fn<FetchFunction>(async (input) => {
      if (String(input).includes('app-update.json')) await pending;
      return String(input).includes('app-update.json') ? jsonResponse(manifest()) : textResponse();
    });
    const env = environment({ fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    attach(controller);

    const first = controller.checkForUpdates(true);
    const second = controller.checkForUpdates(true);
    expect(first).toBe(second);
    release();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await controller.checkForUpdates(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the local app usable while offline and retries manually', async () => {
    let online = false;
    const env = environment({ isOnline: () => online });
    const controller = createPwaUpdateController(env.value);
    attach(controller);

    await controller.checkForUpdates(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'offline', canCheck: true });
    expect(env.fetch).not.toHaveBeenCalled();

    online = true;
    await controller.checkForUpdates(true);
    expect(controller.getSnapshot().phase).toBe('up-to-date');
  });

  it('keeps a previously verified downloaded update actionable offline without reopening a dismissed banner', async () => {
    let online = true;
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse(manifest('build-new'))
        : textResponse()
    );
    const env = environment({ fetch: fetchMock, isOnline: () => online });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker() as unknown as ServiceWorker;
    const { activateWaitingWorker } = attach(controller, registration);

    await controller.checkForUpdates(true);
    controller.dismissUpdate();
    online = false;
    await controller.checkForUpdates(true);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      updatePromptVisible: false,
      canApply: true
    });
    expect(controller.getSnapshot().message).toContain('offline aktiviert');

    await controller.applyUpdate();
    expect(activateWaitingWorker).toHaveBeenCalledWith(true);
  });

  it('does not claim an unverified offline waiting worker is a newer build', async () => {
    const env = environment({ isOnline: () => false });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker() as unknown as ServiceWorker;
    attach(controller, registration);

    await controller.checkForUpdates(true);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'offline',
      remoteBuildId: null,
      updatePromptVisible: false,
      canApply: false
    });
    expect(env.fetch).not.toHaveBeenCalled();
  });

  it('reconciles an installing worker according to the already verified build identity', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse(manifest('build-new'))
        : textResponse()
    );
    const env = environment({ fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    const worker = new FakeWorker();
    registration.update.mockImplementation(async () => {
      registration.installing = worker as unknown as ServiceWorker;
      registration.dispatchEvent(new Event('updatefound'));
    });
    attach(controller, registration);

    await controller.checkForUpdates(true);
    expect(controller.getSnapshot().phase).toBe('checking');

    registration.installing = null;
    registration.waiting = worker as unknown as ServiceWorker;
    worker.state = 'installed';
    worker.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      updatePromptVisible: true,
      canApply: true
    });
  });

  it('does not activate an older waiting worker while a newer verified build is still installing', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse(manifest('build-new'))
        : textResponse()
    );
    const env = environment({ fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    const oldWaiting = new FakeWorker();
    oldWaiting.state = 'installed';
    const newInstalling = new FakeWorker();
    registration.waiting = oldWaiting as unknown as ServiceWorker;
    registration.update.mockImplementation(async () => {
      registration.installing = newInstalling as unknown as ServiceWorker;
      registration.dispatchEvent(new Event('updatefound'));
    });
    const { activateWaitingWorker } = attach(controller, registration);

    await controller.checkForUpdates(true);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'checking',
      remoteBuildId: 'build-new',
      updatePromptVisible: false,
      canApply: false
    });
    expect(activateWaitingWorker).not.toHaveBeenCalled();

    registration.installing = null;
    registration.waiting = newInstalling as unknown as ServiceWorker;
    newInstalling.state = 'installed';
    newInstalling.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      remoteBuildId: 'build-new',
      updatePromptVisible: true,
      canApply: true
    });
  });

  it('reports a remote build that cannot yet be prepared and allows retry', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse(manifest('build-new'))
        : textResponse()
    );
    const env = environment({ fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    attach(controller);

    await controller.checkForUpdates(true);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      remoteBuildId: 'build-new',
      updatePromptVisible: false,
      canCheck: true
    });
  });

  it('keeps update activation recoverable when applying fails', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse(manifest('build-new'))
        : textResponse()
    );
    const env = environment({ fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker() as unknown as ServiceWorker;
    attach(controller, registration, vi.fn(async () => { throw new Error('activation failed'); }));

    await controller.checkForUpdates(true);
    await controller.applyUpdate();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      updatePromptVisible: true,
      canApply: true
    });
    expect(controller.getSnapshot().message).toContain('activation failed');
  });

  it('exposes offline-ready and registration diagnostics without losing verified update state', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse(manifest('build-new'))
        : textResponse()
    );
    const env = environment({ fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker() as unknown as ServiceWorker;
    attach(controller, registration);

    controller.markOfflineReady();
    expect(controller.getSnapshot().offlineReadyNoticeVisible).toBe(true);
    controller.dismissOfflineReady();
    expect(controller.getSnapshot().offlineReadyNoticeVisible).toBe(false);

    await controller.checkForUpdates(true);
    controller.markOfflineReady();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      offlineReadyNoticeVisible: false
    });

    controller.markRegistrationError(new Error('registration denied'));
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error' });
    expect(controller.getSnapshot().message).toContain('registration denied');
  });

  it('reports unsupported browsers without network calls', async () => {
    const env = environment({ supported: false });
    const controller = createPwaUpdateController(env.value);
    await controller.checkForUpdates(true);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'unsupported',
      canCheck: false,
      canApply: false
    });
    expect(env.fetch).not.toHaveBeenCalled();
  });
});
