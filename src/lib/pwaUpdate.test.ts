import { describe, expect, it, vi } from 'vitest';
import {
  APP_UPDATE_MANIFEST_CONTRACT,
  APP_UPDATE_MANIFEST_VERSION,
  createPwaUpdateController,
  parseAppUpdateManifest,
  parseServiceWorkerBuildMetadata,
  SERVICE_WORKER_BUILD_CONTRACT,
  SERVICE_WORKER_BUILD_VERSION,
  type PwaUpdateBridge,
  type PwaUpdateEnvironment,
  type ServiceWorkerBuildMetadata
} from './pwaUpdate';

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

class FakeWorker extends EventTarget {
  state: ServiceWorkerState;
  readonly metadata: ServiceWorkerBuildMetadata | null;

  constructor(buildId: string | null, state: ServiceWorkerState = 'installed', appVersion = '2.4.2') {
    super();
    this.state = state;
    this.metadata = buildId === null
      ? null
      : {
          contract: SERVICE_WORKER_BUILD_CONTRACT,
          schemaVersion: SERVICE_WORKER_BUILD_VERSION,
          appVersion,
          buildId
        };
  }
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
  overrides: Partial<PwaUpdateBridge> = {}
) {
  const readWorkerMetadata = vi.fn(async (worker: ServiceWorker) =>
    (worker as unknown as FakeWorker).metadata
  );
  const activateWaiting = vi.fn(async (worker: ServiceWorker, _reloadPage: boolean) => {
    if (registration.waiting !== worker) throw new Error('worker no longer waiting');
    registration.waiting = null;
    registration.installing = null;
    registration.active = worker;
    const fake = worker as unknown as FakeWorker;
    fake.state = 'activated';
    fake.dispatchEvent(new Event('statechange'));
  });
  const reloadPage = vi.fn();
  const bridge: PwaUpdateBridge = {
    swUrl: 'https://example.test/app/sw.js',
    registration: registration as unknown as ServiceWorkerRegistration,
    readWorkerMetadata,
    activateWaiting,
    reloadPage,
    ...overrides
  };
  controller.attachServiceWorker(bridge);
  return { registration, readWorkerMetadata, activateWaiting, reloadPage };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('deployment metadata contracts', () => {
  it('accepts the exact app deployment contract', () => {
    expect(parseAppUpdateManifest(manifest())).toEqual(manifest());
  });

  it('accepts the exact service worker build contract', () => {
    const metadata = new FakeWorker('build-current').metadata;
    expect(parseServiceWorkerBuildMetadata(metadata)).toEqual(metadata);
  });

  it.each([
    null,
    [],
    { ...manifest(), contract: 'other' },
    { ...manifest(), schemaVersion: 2 },
    { ...manifest(), appVersion: 'latest' },
    { ...manifest(), buildId: '../unsafe' },
    { ...manifest(), catalogVersion: '' }
  ])('rejects malformed app deployment metadata: %j', (value) => {
    expect(() => parseAppUpdateManifest(value)).toThrow();
  });

  it.each([
    null,
    [],
    { contract: 'other', schemaVersion: 1, appVersion: '2.4.2', buildId: 'x' },
    { contract: SERVICE_WORKER_BUILD_CONTRACT, schemaVersion: 2, appVersion: '2.4.2', buildId: 'x' },
    { contract: SERVICE_WORKER_BUILD_CONTRACT, schemaVersion: 1, appVersion: 'latest', buildId: 'x' },
    { contract: SERVICE_WORKER_BUILD_CONTRACT, schemaVersion: 1, appVersion: '2.4.2', buildId: '../x' }
  ])('rejects malformed worker metadata: %j', (value) => {
    expect(() => parseServiceWorkerBuildMetadata(value)).toThrow();
  });
});

describe('PWA deployment update controller', () => {
  it('checks deployment metadata and sw.js without cache', async () => {
    const env = environment();
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.active = new FakeWorker('build-current', 'activated') as unknown as ServiceWorker;
    attach(controller, registration);

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
      currentBuildId: 'build-current',
      remoteBuildId: 'build-current',
      preparedBuildId: null,
      updatePromptVisible: false,
      canApply: false
    });
  });

  it('never offers the first installation as an update', async () => {
    const env = environment();
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('build-current') as unknown as ServiceWorker;
    const { activateWaiting } = attach(controller, registration);

    await controller.checkForUpdates(true);
    await flushAsync();

    expect(activateWaiting).toHaveBeenCalledWith(expect.any(FakeWorker), false);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'up-to-date',
      remoteBuildId: 'build-current',
      preparedBuildId: null,
      updatePromptVisible: false,
      canApply: false
    });
  });

  it('repairs a deleted cache silently when the network page is already the deployed build', async () => {
    const env = environment();
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.active = new FakeWorker('build-old', 'activated', '2.4.1') as unknown as ServiceWorker;
    registration.update.mockImplementation(async () => {
      registration.waiting = new FakeWorker('build-current') as unknown as ServiceWorker;
    });
    const { activateWaiting } = attach(controller, registration);

    await controller.checkForUpdates(true);
    await flushAsync();

    expect(activateWaiting).toHaveBeenCalledWith(expect.any(FakeWorker), false);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'up-to-date',
      currentBuildId: 'build-current',
      remoteBuildId: 'build-current',
      preparedBuildId: null,
      updatePromptVisible: false,
      canApply: false
    });
  });

  it('offers only the metadata-verified remote worker to a cached older app', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse({ ...manifest('build-new'), appVersion: '2.4.3' })
        : textResponse()
    );
    const env = environment({
      currentAppVersion: '2.4.2',
      currentBuildId: 'build-old',
      fetch: fetchMock
    });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.active = new FakeWorker('build-old', 'activated') as unknown as ServiceWorker;
    registration.update.mockImplementation(async () => {
      registration.waiting = new FakeWorker('build-new', 'installed', '2.4.3') as unknown as ServiceWorker;
    });
    const { activateWaiting } = attach(controller, registration);

    await controller.checkForUpdates(true);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      currentBuildId: 'build-old',
      remoteBuildId: 'build-new',
      preparedBuildId: 'build-new',
      updatePromptVisible: true,
      canApply: true
    });

    await controller.applyUpdate();
    expect(activateWaiting).toHaveBeenCalledWith(expect.any(FakeWorker), true);
  });

  it('does not offer a stale intermediate waiting worker', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse({ ...manifest('build-new'), appVersion: '2.4.3' })
        : textResponse()
    );
    const env = environment({ currentBuildId: 'build-old', fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('build-old') as unknown as ServiceWorker;
    registration.update.mockImplementation(async () => {
      registration.waiting = new FakeWorker('build-new', 'installed', '2.4.3') as unknown as ServiceWorker;
    });
    attach(controller, registration);

    await controller.checkForUpdates(true);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      preparedBuildId: 'build-new'
    });
  });

  it('never exposes an unidentified legacy worker as a clickable update', async () => {
    const env = environment();
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker(null) as unknown as ServiceWorker;
    attach(controller, registration);

    await controller.checkForUpdates(true);

    expect(controller.getSnapshot()).toMatchObject({
      updatePromptVisible: false,
      canApply: false,
      preparedBuildId: null
    });
  });

  it('supports reload-only activation when the remote worker is already active', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse({ ...manifest('build-new'), appVersion: '2.4.3' })
        : textResponse()
    );
    const env = environment({ currentBuildId: 'build-old', fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.active = new FakeWorker('build-new', 'activated', '2.4.3') as unknown as ServiceWorker;
    const { reloadPage } = attach(controller, registration);

    await controller.checkForUpdates(true);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      preparedBuildId: 'build-new',
      canApply: true
    });

    await controller.applyUpdate();
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('keeps a prepared newer worker actionable offline', async () => {
    const env = environment({ currentBuildId: 'build-old', isOnline: () => false });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('build-new', 'installed', '2.4.3') as unknown as ServiceWorker;
    const { activateWaiting } = attach(controller, registration);

    await controller.checkForUpdates(true);

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      preparedBuildId: 'build-new',
      canApply: true
    });
    expect(env.fetch).not.toHaveBeenCalled();

    await controller.applyUpdate();
    expect(activateWaiting).toHaveBeenCalledWith(expect.any(FakeWorker), true);
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
    const registration = new FakeRegistration();
    registration.active = new FakeWorker('build-current', 'activated') as unknown as ServiceWorker;
    attach(controller, registration);

    const first = controller.checkForUpdates(true);
    const second = controller.checkForUpdates(true);
    expect(first).toBe(second);
    release();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await controller.checkForUpdates(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps update activation recoverable when applying fails', async () => {
    const fetchMock = vi.fn<FetchFunction>(async (input) =>
      String(input).includes('app-update.json')
        ? jsonResponse({ ...manifest('build-new'), appVersion: '2.4.3' })
        : textResponse()
    );
    const env = environment({ currentBuildId: 'build-old', fetch: fetchMock });
    const controller = createPwaUpdateController(env.value);
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('build-new', 'installed', '2.4.3') as unknown as ServiceWorker;
    attach(controller, registration, {
      activateWaiting: vi.fn(async () => { throw new Error('activation failed'); })
    });

    await controller.checkForUpdates(true);
    await controller.applyUpdate();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'update-available',
      preparedBuildId: 'build-new',
      updatePromptVisible: true,
      canApply: true
    });
    expect(controller.getSnapshot().message).toContain('activation failed');
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
