import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createExplorerServer } from './server.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('serves the Explorer and proxies indexer and approved Besu requests', async (context) => {
  const apiServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ items: [], path: request.url }));
  });
  const rpcServer = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    response.writeHead(200, { 'content-type': 'application/json' });
    const payload = JSON.parse(Buffer.concat(body).toString());
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: payload.method === 'eth_sendRawTransaction'
        ? `0x${'a'.repeat(64)}`
        : payload.method === 'eth_estimateGas'
          ? '0x5208'
          : '0x135289b'
    }));
  });
  const apiUrl = await listen(apiServer);
  const rpcUrl = await listen(rpcServer);
  const explorer = createExplorerServer({ apiBaseUrl: apiUrl, rpcUrl });
  const explorerUrl = await listen(explorer);
  context.after(async () => {
    await Promise.all([close(explorer), close(apiServer), close(rpcServer)]);
  });

  const home = await fetch(`${explorerUrl}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /DIGEVRA Explorer/);

  const runtimeConfig = await fetch(`${explorerUrl}/digevra-config.js`);
  assert.equal(runtimeConfig.status, 200);
  const runtimeConfigText = await runtimeConfig.text();
  assert.match(runtimeConfigText, /deploymentMode: 'live'/);
  assert.match(runtimeConfigText, /rpcUrl: 'https:\/\/[^']+\/rpc'/);
  assert.match(runtimeConfigText, /indexerApiUrl: 'https:\/\/[^']+\/api'/);
  assert.doesNotMatch(runtimeConfigText, /https?:\/\/(localhost|127\.0\.0\.1)/i);

  const history = await fetch(
    `${explorerUrl}/api/address/0x1111111111111111111111111111111111111111/transactions?limit=10&offset=0`
  );
  assert.equal(history.status, 200);
  const historyPayload = await history.json();
  assert.deepEqual(historyPayload.items, []);
  assert.match(historyPayload.path, /limit=10&offset=0/);

  const chainId = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://dimitri-guekam.github.io'
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 })
  });
  assert.equal(chainId.status, 200);
  assert.equal(
    chainId.headers.get('access-control-allow-origin'),
    'https://dimitri-guekam.github.io'
  );
  assert.equal((await chainId.json()).result, '0x135289b');

  const genesis = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBlockByNumber',
      params: ['0x0', false],
      id: 3
    })
  });
  assert.equal(genesis.status, 200);

  for (const [method, params] of [
    ['eth_getBalance', ['0x35b4336eF00eD099e030D29f925f2C69FD86b912', '0x7adb']],
    ['eth_getBlockByNumber', ['0x7adb', false]],
    ['eth_getTransactionCount', ['0x35b4336eF00eD099e030D29f925f2C69FD86b912', 'latest']],
    ['eth_getTransactionReceipt', [`0x${'b'.repeat(64)}`]],
    ['eth_gasPrice', []],
    ['eth_maxPriorityFeePerGas', []],
    ['eth_estimateGas', [{
      from: '0x35b4336eF00eD099e030D29f925f2C69FD86b912',
      to: '0x1111111111111111111111111111111111111111',
      value: '0x1'
    }]]
  ]) {
    const historicalRead = await fetch(`${explorerUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 4 })
    });
    assert.equal(historicalRead.status, 200);
  }

  const malformedBlockTag = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBlockByNumber',
      params: ['0x07adb', false],
      id: 5
    })
  });
  assert.equal(malformedBlockTag.status, 400);

  const preflight = await fetch(`${explorerUrl}/rpc`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://dimitri-guekam.github.io',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get('access-control-allow-methods'),
    'POST, OPTIONS'
  );

  const deniedOrigin = await fetch(`${explorerUrl}/api/stats`, {
    headers: { origin: 'https://attacker.example' }
  });
  assert.equal(deniedOrigin.status, 403);

  const signedBroadcast = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: [`0x${'12'.repeat(100)}`],
      id: 2
    })
  });
  assert.equal(signedBroadcast.status, 200);
  assert.equal((await signedBroadcast.json()).result, `0x${'a'.repeat(64)}`);

  const invalidSignedPayload = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: ['0xnot-a-signed-transaction'],
      id: 8
    })
  });
  assert.equal(invalidSignedPayload.status, 400);

  const invalidEstimate = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_estimateGas',
      params: [{ from: 'not-an-address', to: '0x1111111111111111111111111111111111111111' }],
      id: 9
    })
  });
  assert.equal(invalidEstimate.status, 400);

  const blockedAdminMethod = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'admin_nodeInfo',
      params: [],
      id: 6
    })
  });
  assert.equal(blockedAdminMethod.status, 400);

  const sameOriginRpc = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: explorerUrl
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 7
    })
  });
  assert.equal(sameOriginRpc.status, 200);

  const blockedWrite = await fetch(`${explorerUrl}/api/stats`, { method: 'POST' });
  assert.equal(blockedWrite.status, 405);
});

test('rate limits requests through a public tunnel', async (context) => {
  const apiServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const apiUrl = await listen(apiServer);
  const explorer = createExplorerServer({
    apiBaseUrl: apiUrl,
    corsOrigins: 'https://dimitri-guekam.github.io',
    rateLimitMax: 1,
    rateLimitWindowMs: 60_000
  });
  const explorerUrl = await listen(explorer);
  context.after(async () => {
    await Promise.all([close(explorer), close(apiServer)]);
  });

  const first = await fetch(`${explorerUrl}/api/health`);
  const second = await fetch(`${explorerUrl}/api/health`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('retry-after'), '60');
});

test('limits signed transaction broadcasts separately from normal RPC calls', async (context) => {
  let upstreamBroadcasts = 0;
  const rpcServer = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const payload = JSON.parse(Buffer.concat(body).toString());
    upstreamBroadcasts += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: `0x${'a'.repeat(64)}`
    }));
  });
  const rpcUrl = await listen(rpcServer);
  const explorer = createExplorerServer({
    rpcUrl,
    corsOrigins: 'https://dimitri-guekam.github.io',
    broadcastRateLimitMax: 6
  });
  const explorerUrl = await listen(explorer);
  context.after(async () => {
    await Promise.all([close(explorer), close(rpcServer)]);
  });

  const broadcast = async (id) => fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: [`0x${'12'.repeat(100)}`],
      id
    })
  });
  for (let id = 1; id <= 6; id += 1) {
    assert.equal((await broadcast(id)).status, 200);
  }
  const limited = await broadcast(7);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(upstreamBroadcasts, 6);
});
