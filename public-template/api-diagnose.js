(() => {
  const APP_VERSION = '__KH_APP_VERSION__';
  const GATEWAY_BASE = __KH_DATA_GATEWAY_URL_JSON__;
  const TIMEOUT_MS = 15_000;
  const controllers = new Map();
  const generations = new Map();
  const results = document.getElementById('results');
  const queryInput = document.getElementById('query');
  const barcodeInput = document.getElementById('barcode');

  document.getElementById('context').textContent = [
    `Seite: ${location.href}`,
    `Origin: ${location.origin}`,
    `Gateway: ${GATEWAY_BASE || 'nicht konfiguriert'}`,
    `Online: ${navigator.onLine ? 'ja' : 'nein'}`,
    `Secure Context: ${window.isSecureContext ? 'ja' : 'nein'}`,
    `Service Worker: ${'serviceWorker' in navigator ? 'verfügbar' : 'nicht verfügbar'}`,
    `User Agent: ${navigator.userAgent}`
  ].join('\n');

  function cleanQuery() {
    return String(queryInput.value || '').normalize('NFC').replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 120) || 'Müllermilch Schoko Zero';
  }

  function cleanBarcode() {
    const value = String(barcodeInput.value || '').replace(/\D/g, '').slice(0, 14);
    if (!/^\d{7,14}$/.test(value)) throw new Error('Barcode muss aus 7 bis 14 Ziffern bestehen.');
    return value;
  }

  function text(value) {
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  function createResult(id, name, url) {
    let card = document.getElementById(`result-${id}`);
    if (!card) {
      if (results.querySelector('.result:not([id])')) results.textContent = '';
      card = document.createElement('article');
      card.id = `result-${id}`;
      results.prepend(card);
    }
    card.className = 'result running';
    card.textContent = '';
    const head = document.createElement('div');
    head.className = 'result-head';
    const title = document.createElement('strong');
    title.textContent = name;
    const state = document.createElement('span');
    state.textContent = 'Anfrage läuft …';
    head.append(title, state);
    const endpoint = document.createElement('p');
    endpoint.className = 'small';
    endpoint.textContent = url;
    card.append(head, endpoint);
    return card;
  }

  function addRow(list, label, value, className = '') {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = text(value);
    if (className) dd.className = className;
    list.append(dt, dd);
  }

  function render(id, name, url, payload) {
    if (generations.get(id) !== payload.generation) return;
    const card = document.getElementById(`result-${id}`) || createResult(id, name, url);
    card.className = `result ${payload.ok ? 'ok' : 'failed'}`;
    card.textContent = '';
    const head = document.createElement('div');
    head.className = 'result-head';
    const title = document.createElement('strong');
    title.textContent = name;
    const state = document.createElement('span');
    state.textContent = payload.ok ? 'Erfolgreich' : 'Fehlgeschlagen';
    head.append(title, state);
    card.append(head);

    const list = document.createElement('dl');
    addRow(list, 'App-Version', APP_VERSION);
    addRow(list, 'Endpunkt', url);
    addRow(list, 'Beginn', payload.startedAt);
    addRow(list, 'Dauer', `${payload.durationMs} ms`);
    addRow(list, 'HTTP-Status', payload.httpStatus);
    addRow(list, 'Content-Type', payload.contentType);
    addRow(list, 'Payload', payload.payloadBytes === undefined ? undefined : `${payload.payloadBytes} Bytes`);
    addRow(list, 'Retry-After', payload.retryAfter);
    if (!payload.ok) addRow(list, 'Eigentlicher Fehler', `${payload.errorName}: ${payload.errorMessage}`, 'technical');
    addRow(list, 'Einordnung', payload.interpretation);
    card.append(list);

    if (payload.summary !== undefined || payload.bodyPreview) {
      const pre = document.createElement('pre');
      pre.textContent = payload.summary !== undefined
        ? JSON.stringify(payload.summary, null, 2)
        : payload.bodyPreview;
      card.append(pre);
    }
  }

  async function runTest(id, name, url, summarize) {
    controllers.get(id)?.abort('restarted');
    const generation = (generations.get(id) || 0) + 1;
    generations.set(id, generation);
    const controller = new AbortController();
    controllers.set(id, controller);
    createResult(id, name, url);

    const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
    const startedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      const body = await response.text();
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      let json;
      let parseError;
      try { json = JSON.parse(body); } catch (error) { parseError = error; }
      const payloadBytes = new TextEncoder().encode(body).length;
      const ok = response.ok && json !== undefined;
      render(id, name, url, {
        generation,
        ok,
        startedAt,
        durationMs,
        httpStatus: response.status,
        contentType: response.headers.get('content-type'),
        payloadBytes,
        retryAfter: response.headers.get('retry-after'),
        errorName: response.ok ? (parseError?.name || 'SyntaxError') : 'HTTPError',
        errorMessage: response.ok
          ? (parseError?.message || 'Antwort ist kein gültiges JSON.')
          : `HTTP ${response.status} ${response.statusText}`,
        interpretation: ok
          ? 'Antwort ist in dieser Browser-/PWA-Origin lesbar und enthält gültiges JSON.'
          : response.ok
            ? 'Der Endpunkt war erreichbar, die Antwort war jedoch kein lesbares JSON.'
            : 'Die Datenquelle hat mit einem HTTP-Fehler geantwortet.',
        summary: json === undefined ? undefined : summarize(json),
        bodyPreview: json === undefined ? body.slice(0, 1200) : undefined
      });
    } catch (error) {
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      const aborted = error?.name === 'AbortError';
      const reason = controller.signal.reason;
      render(id, name, url, {
        generation,
        ok: false,
        startedAt,
        durationMs,
        errorName: error?.name || 'Error',
        errorMessage: error?.message || String(error),
        interpretation: aborted && reason === 'timeout'
          ? `Zeitüberschreitung nach ${TIMEOUT_MS / 1000} Sekunden.`
          : aborted && reason === 'restarted'
            ? 'Vorheriger Test wurde durch einen sofortigen Neustart abgebrochen.'
            : 'Der Browser konnte den Endpunkt nicht erreichen oder dessen Antwort wegen CORS nicht lesen.'
      });
    } finally {
      clearTimeout(timer);
      if (controllers.get(id) === controller) controllers.delete(id);
    }
  }

  function gatewayUrl(pathname, params) {
    if (!GATEWAY_BASE) throw new Error('Gateway ist nicht konfiguriert.');
    const query = params ? `?${params}` : '';
    return `${GATEWAY_BASE.replace(/\/$/, '')}${pathname}${query}`;
  }

  function healthUrl() {
    return gatewayUrl('/api/v1/health');
  }

  function searchUrl(searchApi) {
    const params = new URLSearchParams({
      q: cleanQuery(),
      page_size: '10',
      search_api: searchApi
    });
    return gatewayUrl('/api/v1/search', params);
  }

  function productUrl(version) {
    if (!GATEWAY_BASE) throw new Error('Gateway ist nicht konfiguriert.');
    const params = new URLSearchParams({ known_carbs: '0', product_api: version });
    return gatewayUrl(`/api/v1/product/${cleanBarcode()}`, params);
  }

  function healthSummary(data) {
    return {
      ok: data.ok,
      service: data.service,
      apiVersion: data.apiVersion,
      appVersion: data.version,
      cacheBackend: data.cacheBackend,
      searchIndexConfigured: data.searchIndexConfigured,
      capabilities: data.capabilities,
      circuits: data.circuits
    };
  }

  function searchSummary(data) {
    const hits = Array.isArray(data.hits) ? data.hits : [];
    return {
      count: data.count,
      returned: hits.length,
      tookMs: data.took,
      timedOut: data.timed_out,
      first: hits[0] ? {
        code: hits[0].code,
        name: hits[0].product_name_de || hits[0].product_name,
        brand: hits[0].brands,
        quantity: hits[0].quantity,
        score: hits[0]._score,
        carbs100g: hits[0].nutriments?.carbohydrates_100g
      } : null
    };
  }

  function productSummary(data) {
    return {
      status: data.status,
      result: data.result?.id,
      product: data.product ? {
        code: data.product.code,
        name: data.product.product_name_de || data.product.product_name,
        brand: data.product.brands,
        quantity: data.product.quantity,
        productQuantity: data.product.product_quantity,
        servingSize: data.product.serving_size,
        servingQuantity: data.product.serving_quantity,
        carbs100g: data.product.nutriments?.carbohydrates_100g
      } : null
    };
  }

  function bindGet(buttonId, id, label, buildUrl, summarize) {
    document.getElementById(buttonId).addEventListener('click', () => {
      try {
        void runTest(id, label, buildUrl(), summarize);
      } catch (error) {
        const generation = (generations.get(id) || 0) + 1;
        generations.set(id, generation);
        createResult(id, label, 'Kein gültiger Endpunkt');
        render(id, label, 'Kein gültiger Endpunkt', {
          generation,
          ok: false,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          errorName: error?.name || 'Error',
          errorMessage: error?.message || String(error),
          interpretation: 'Eingabe lokal abgelehnt; es wurde keine API-Anfrage ausgeführt.'
        });
      }
    });
  }

  bindGet('healthBtn', 'health', 'Gateway /api/v1/health', healthUrl, healthSummary);
  bindGet('searchBtn', 'search-index', 'Eigener Suchindex', () => searchUrl('search-index'), searchSummary);
  bindGet('searchPublicBtn', 'search-public', 'Search-a-licious (explizite Reserve)', () => searchUrl('search-a-licious'), searchSummary);
  bindGet('legacyBtn', 'legacy', 'OFF Legacy (explizite Reserve)', () => searchUrl('legacy'), searchSummary);

  for (const [buttonId, version, id, label] of [
    ['productV3Btn', 'v3', 'product-v3', 'Gateway /api/v1/product (v3.6)'],
    ['productV2Btn', 'v2', 'product-v2', 'Gateway /api/v1/product (v2)']
  ]) {
    document.getElementById(buttonId).addEventListener('click', () => {
      try {
        const url = productUrl(version);
        void runTest(id, label, url, productSummary);
      } catch (error) {
        const generation = (generations.get(id) || 0) + 1;
        generations.set(id, generation);
        createResult(id, label, 'Kein gültiger Endpunkt');
        render(id, label, 'Kein gültiger Endpunkt', {
          generation,
          ok: false,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          errorName: error?.name || 'Error',
          errorMessage: error?.message || String(error),
          interpretation: 'Eingabe lokal abgelehnt; es wurde keine API-Anfrage ausgeführt.'
        });
      }
    });
  }

  document.getElementById('clearBtn').addEventListener('click', () => {
    for (const controller of controllers.values()) controller.abort('cleared');
    controllers.clear();
    generations.clear();
    results.textContent = '';
    const card = document.createElement('article');
    card.className = 'result';
    const title = document.createElement('strong');
    title.textContent = 'Ausgabe geleert.';
    card.append(title);
    results.append(card);
  });
})();
