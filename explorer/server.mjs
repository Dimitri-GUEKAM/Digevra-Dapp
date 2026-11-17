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
const READ_ONLY_RPC_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance'
]);

export function createExplorerServer({
  staticRoot = ROOT,
  apiBaseUrl = 'http://127.0.0.1:3001',
  rpcUrl = 'http://127.0.0.1:9545'
} = {}) {
  const resolvedRoot = resolve(staticRoot);
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await proxyIndexer(request, response, apiBaseUrl);
      return;
    }
    if (url.pathname === '/rpc') {
      await proxyReadOnlyRpc(request, response, rpcUrl);
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

async function proxyReadOnlyRpc(request, response, rpcUrl) {
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
    if (
      !payload ||
      typeof payload !== 'object' ||
      !READ_ONLY_RPC_METHODS.has(payload.method) ||
      !validRpcParams(payload.method, payload.params)
    ) {
      sendJson(response, 400, { error: 'Unsupported or invalid read-only RPC request.' });
      return;
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

function validRpcParams(method, params) {
  if (!Array.isArray(params)) return false;
  if (method === 'eth_chainId' || method === 'eth_blockNumber') {
    return params.length === 0;
  }
  return params.length === 2 &&
    typeof params[0] === 'string' &&
    ADDRESS_PATTERN.test(params[0]) &&
    params[1] === 'latest';
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
    rpcUrl: process.env.DIGEVRA_RPC_URL ?? 'http://127.0.0.1:9545'
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`DIGEVRA Explorer listening on http://localhost:${port}`);
  });
  process.on('SIGINT', () => server.close(() => process.exit(0)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
