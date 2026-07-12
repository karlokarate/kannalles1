import 'dotenv/config';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { contentSecurityPolicy } from './security-policy.mjs';
import { closeGateway, sendHttpError, setCors } from '../api/_lib/gateway.js';
import { aiParseHandler } from '../api/_lib/ai-handler.js';
import {
  healthHandler,
  productHandler,
  searchHandler
} from '../api/_lib/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const APP_VERSION = String(packageJson.version);
const DEFAULT_PORT = 8787;

function safePort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : DEFAULT_PORT;
}

function traceId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const port = safePort(process.env.PORT || DEFAULT_PORT);
const host = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const app = express();

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((_, res, next) => {
  const production = process.env.NODE_ENV === 'production';
  const apiRequest = String(res.req?.path || '').startsWith('/api/');
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    // Cross-origin API use is still gated by the explicit CORS allowlist;
    // static assets remain same-origin only.
    'Cross-Origin-Resource-Policy': apiRequest ? 'cross-origin' : 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': contentSecurityPolicy({ production })
  });
  next();
});
app.use('/api', (req, res, next) => {
  if (!setCors(res, req)) {
    sendHttpError(res, 403, 'Dieser Request-Origin ist nicht freigegeben.');
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
app.use(express.json({ limit: '16kb', strict: true }));

// Canonical, versioned API backed by runtime-neutral shared HTTP handlers.
app.all('/api/v1/health', healthHandler);
app.all('/api/v1/search', searchHandler);
app.all('/api/v1/product/:code', productHandler);
app.all('/api/v1/ai/parse', aiParseHandler);

// Compatibility aliases contain no business logic and advertise their
// successor using RFC-compatible response headers.
app.all('/api/health', (req, res) => healthHandler(req, res, {
  deprecated: true,
  successorPath: '/api/v1/health'
}));
app.all('/api/search', (req, res) => searchHandler(req, res, {
  deprecated: true,
  successorPath: '/api/v1/search'
}));
app.all('/api/product/:code', (req, res) => productHandler(req, res, {
  deprecated: true,
  successorPath: `/api/v1/product/${encodeURIComponent(String(req.params.code || ''))}`
}));
app.all('/api/ai/parse', (req, res) => aiParseHandler(req, res, { deprecated: true }));

app.all('/api', (_req, res) => {
  res.status(404).json({ error: 'Unbekannter API-Endpunkt.', code: 'NOT_FOUND', traceId: traceId() });
});
app.all('/api/{*splat}', (_req, res) => {
  res.status(404).json({ error: 'Unbekannter API-Endpunkt.', code: 'NOT_FOUND', traceId: traceId() });
});

const distDir = path.join(rootDir, 'dist');
try {
  await fs.access(distDir);
  app.use(express.static(distDir, {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      const relativePath = path.relative(distDir, filePath).split(path.sep).join('/');
      if (name === 'sw.js' || name === 'manifest.webmanifest' || name === 'index.html' || name === 'registerSW.js') {
        res.set('Cache-Control', 'no-cache');
      } else if (relativePath.startsWith('assets/')) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.set('Cache-Control', 'public, max-age=86400');
      }
    }
  }));
  app.get('/{*splat}', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} catch {
  app.get('/', (_req, res) => {
    res.type('text').send(`KH Checker API v${APP_VERSION} läuft. Frontend mit npm run dev starten.`);
  });
}

app.use((error, _req, res, _next) => {
  const id = traceId();
  console.error('Express request failed', {
    traceId: id,
    name: error instanceof Error ? error.name : typeof error,
    code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR'
  });
  if (error?.type === 'entity.too.large') {
    return sendHttpError(res, 413, 'Der JSON-Request überschreitet das erlaubte Größenlimit.', { traceId: id });
  }
  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError && 'body' in error) {
    return sendHttpError(res, 400, 'Ungültiger JSON-Request.', { traceId: id });
  }
  return sendHttpError(res, 500, 'Interner Serverfehler.', { traceId: id });
});

const server = app.listen(port, host, () => {
  console.log(`KH Checker v${APP_VERSION} server listening on http://${host}:${port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing HTTP and gateway resources.`);
  const forced = setTimeout(() => {
    server.closeAllConnections?.();
    process.exitCode = 1;
  }, 10_000);
  forced.unref();
  server.close(async () => {
    try {
      await closeGateway();
    } finally {
      clearTimeout(forced);
      process.exitCode = 0;
    }
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
