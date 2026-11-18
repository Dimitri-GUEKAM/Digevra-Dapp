import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const SHARED_CONFIG = resolve(ROOT, '..', 'public', 'digevra-config.js');
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const BLOCK_TAG_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/;
const ALLOWED_RPC_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_estimateGas',
  'eth_sendRawTransaction'
]);
const DEFAULT_CORS_ORIGINS = [
  'https://dimitri-guekam.github.io',
  'http://localhost:4201',
  'http://127.0.0.1:4201'
];
const RAW_TRANSACTION_PATTERN = /^0x(?:[a-fA-F0-9]{2}){1,8190}$/;
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

function parseCorsOrigins(value) {
  const origins = (value ?? DEFAULT_CORS_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.includes('*') || origins.some((origin) => {
    try {
      return new URL(origin).origin !== origin;
    } catch {
      return true;
    }
  })) {
    throw new Error('DIGEVRA_CORS_ORIGINS must contain exact origins and cannot use "*".');
  }
  return new Set(origins);
}

function createRateLimiter(limit, windowMs, now = Date.now) {
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1000) {
    throw new Error('Rate-limit settings must be positive safe integers.');
  }
  const buckets = new Map();
  return (request) => {
    const key = request.headers['cf-connecting-ip'] ??
      request.socket.remoteAddress ??
      'unknown';
    const currentTime = now();
    let bucket = buckets.get(key);
    if (!bucket || currentTime - bucket.startedAt >= windowMs) {
      bucket = { startedAt: currentTime, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
}

function setCorsHeaders(request, response, allowedOrigins, path) {
  const origin = request.headers.origin;
  const protocol = (request.headers['x-forwarded-proto'] ?? 'http')
    .toString()
    .split(',')[0]
    .trim();
  const sameOrigin = origin === `${protocol}://${request.headers.host}`;
  if (origin && !allowedOrigins.has(origin) && !sameOrigin) return false;
  if (origin) {
    if (allowedOrigins.has(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
      response.setHeader('access-control-allow-methods',
        path === '/rpc' ? 'POST, OPTIONS' : 'GET, OPTIONS');
      response.setHeader('access-control-allow-headers', 'Accept, Content-Type');
      response.setHeader('access-control-max-age', '600');
    }
  }
  return true;
}

export function createExplorerServer({
  staticRoot = ROOT,
  apiBaseUrl = 'http://127.0.0.1:3001',
  rpcUrl = 'http://127.0.0.1:9545',
  corsOrigins = process.env.DIGEVRA_CORS_ORIGINS,
  rateLimitMax = 120,
  rateLimitWindowMs = 60_000,
  broadcastRateLimitMax = 6
} = {}) {
  const resolvedRoot = resolve(staticRoot);
  const allowedOrigins = parseCorsOrigins(corsOrigins);
  const allowRequest = createRateLimiter(rateLimitMax, rateLimitWindowMs);
  const allowBroadcast = createRateLimiter(broadcastRateLimitMax, rateLimitWindowMs);
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!setCorsHeaders(request, response, allowedOrigins, '/api')) {
        sendJson(response, 403, { error: 'Origin is not allowed.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (!allowRequest(request)) {
        response.setHeader('retry-after', String(Math.ceil(rateLimitWindowMs / 1000)));
        sendJson(response, 429, { error: 'Request rate limit exceeded.' });
        return;
      }
      await proxyIndexer(request, response, apiBaseUrl);
      return;
    }
    if (url.pathname === '/rpc') {
      if (!setCorsHeaders(request, response, allowedOrigins, '/rpc')) {
        sendJson(response, 403, { error: 'Origin is not allowed.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (!allowRequest(request)) {
        response.setHeader('retry-after', String(Math.ceil(rateLimitWindowMs / 1000)));
        sendJson(response, 429, { error: 'Request rate limit exceeded.' });
        return;
      }
      await proxyRpc(request, response, rpcUrl, allowBroadcast, rateLimitWindowMs);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Only GET and HEAD are supported.' });
      return;
    }

    if (url.pathname === '/digevra-config.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache'
      });
      if (request.method === 'HEAD') {
        response.end();
      } else {
        createReadStream(SHARED_CONFIG).pipe(response);
      }
      return;
    }

    const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const filePath = resolve(resolvedRoot, `.${requestedPath}`);
    if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${sep}`)) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    try {
      if (!statSync(filePath).isFile()) {
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      response.writeHead(200, {
        'content-type': MIME_TYPES.get(extname(filePath)) ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache'
      });
      if (request.method === 'HEAD') {
        response.end();
      } else {
        createReadStream(filePath).pipe(response);
      }
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      sendJson(response, 500, { error: 'Explorer could not read this resource.' });
    }
  });
}

async function proxyIndexer(request, response, apiBaseUrl) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'The indexer proxy is read-only.' });
    return;
  }
  try {
    const target = new URL(request.url, apiBaseUrl);
    const upstream = await fetch(target, { headers: { accept: 'application/json' } });
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    if (response.headersSent) {
      response.destroy();
    } else if (!response.destroyed) {
      sendJson(response, 502, { error: 'Indexer API is unavailable.' });
    }
  }
}

async function proxyRpc(request, response, rpcUrl, allowBroadcast, rateLimitWindowMs) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'RPC proxy accepts POST only.' });
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16_384) {
        sendJson(response, 413, { error: 'RPC request is too large.' });
        return;
      }
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const requests = Array.isArray(payload) ? payload : [payload];
    if (
      requests.length === 0 ||
      requests.length > 20 ||
      requests.some((rpcRequest) => !validRpcRequest(rpcRequest))
    ) {
      sendJson(response, 400, { error: 'Unsupported or invalid RPC request.' });
      return;
    }
    for (const rpcRequest of requests) {
      if (rpcRequest.method === 'eth_sendRawTransaction' && !allowBroadcast(request)) {
        response.setHeader('retry-after', String(Math.ceil(rateLimitWindowMs / 1000)));
        sendJson(response, 429, { error: 'Transaction broadcast rate limit exceeded.' });
        return;
      }
    }
    const upstream = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
    } else if (!response.destroyed) {
      sendJson(response, 502, {
        error: error instanceof SyntaxError
          ? 'Invalid JSON-RPC request.'
          : 'Besu RPC is unavailable.'
      });
    }
  }
}

function validRpcRequest(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    payload.jsonrpc === '2.0' &&
    (payload.id === null ||
      typeof payload.id === 'string' ||
      Number.isSafeInteger(payload.id)) &&
    ALLOWED_RPC_METHODS.has(payload.method) &&
    validRpcParams(payload.method, payload.params)
  );
}

function validRpcParams(method, params) {
  if (!Array.isArray(params)) return false;
  if (method === 'eth_chainId' || method === 'eth_blockNumber') {
    return params.length === 0;
  }
  if (method === 'eth_getBalance') {
    return params.length === 2 &&
      typeof params[0] === 'string' &&
      ADDRESS_PATTERN.test(params[0]) &&
      (params[1] === 'latest' ||
        typeof params[1] === 'string' && BLOCK_TAG_PATTERN.test(params[1]));
  }
  if (method === 'eth_getCode') {
    return params.length === 2 &&
      typeof params[0] === 'string' &&
      ADDRESS_PATTERN.test(params[0]) &&
      params[1] === 'latest';
  }
  if (method === 'eth_getBlockByNumber') {
    return params.length === 2 &&
      (params[0] === 'latest' ||
        typeof params[0] === 'string' && BLOCK_TAG_PATTERN.test(params[0])) &&
      params[1] === false;
  }
  if (method === 'eth_getTransactionByHash' ||
      method === 'eth_getTransactionReceipt') {
    return params.length === 1 &&
      typeof params[0] === 'string' &&
      TRANSACTION_HASH_PATTERN.test(params[0]);
  }
  if (method === 'eth_getTransactionCount') {
    return params.length === 2 &&
      typeof params[0] === 'string' &&
      ADDRESS_PATTERN.test(params[0]) &&
      (params[1] === 'latest' ||
        typeof params[1] === 'string' && BLOCK_TAG_PATTERN.test(params[1]));
  }
  if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') {
    return params.length === 0;
  }
  if (method === 'eth_estimateGas') {
    if (params.length < 1 || params.length > 2 || !params[0] ||
        typeof params[0] !== 'object' || Array.isArray(params[0])) {
      return false;
    }
    const transaction = params[0];
    const allowedKeys = new Set([
      'from', 'to', 'value', 'data', 'input', 'gas', 'gasPrice',
      'maxFeePerGas', 'maxPriorityFeePerGas', 'nonce', 'type'
    ]);
    if (Object.keys(transaction).some((key) => !allowedKeys.has(key))) return false;
    if (transaction.from !== undefined &&
        (typeof transaction.from !== 'string' || !ADDRESS_PATTERN.test(transaction.from))) {
      return false;
    }
    if (transaction.to !== undefined &&
        (typeof transaction.to !== 'string' || !ADDRESS_PATTERN.test(transaction.to))) {
      return false;
    }
    for (const key of [
      'value', 'gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas',
      'nonce', 'type'
    ]) {
      if (transaction[key] !== undefined &&
          (typeof transaction[key] !== 'string' || !QUANTITY_PATTERN.test(transaction[key]))) {
        return false;
      }
    }
    for (const key of ['data', 'input']) {
      if (transaction[key] !== undefined &&
          (typeof transaction[key] !== 'string' ||
            !/^0x(?:[a-fA-F0-9]{2})*$/.test(transaction[key]))) {
        return false;
      }
    }
    if (params.length === 2 &&
        params[1] !== 'latest' &&
        (typeof params[1] !== 'string' || !BLOCK_TAG_PATTERN.test(params[1]))) {
      return false;
    }
    return true;
  }
  return method === 'eth_sendRawTransaction' &&
    params.length === 1 &&
    typeof params[0] === 'string' &&
    RAW_TRANSACTION_PATTERN.test(params[0]);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.EXPLORER_PORT ?? 4201);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('EXPLORER_PORT must be a valid TCP port.');
  }
  const server = createExplorerServer({
    apiBaseUrl: process.env.INDEXER_API_URL ?? 'http://127.0.0.1:3001',
    rpcUrl: process.env.DIGEVRA_RPC_URL ?? 'http://127.0.0.1:9545',
    corsOrigins: process.env.DIGEVRA_CORS_ORIGINS
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`DIGEVRA Explorer listening on http://localhost:${port}`);
  });
  process.on('SIGINT', () => server.close(() => process.exit(0)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
