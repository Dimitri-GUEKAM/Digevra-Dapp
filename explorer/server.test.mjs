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

test('serves the Explorer and proxies indexer and read-only Besu requests', async (context) => {
  const apiServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ items: [], path: request.url }));
  });
  const rpcServer = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: JSON.parse(Buffer.concat(body).toString()).id,
      result: '0x135289b'
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
  assert.match(runtimeConfigText, /deploymentMode: 'demo'/);
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 })
  });
  assert.equal(chainId.status, 200);
  assert.equal((await chainId.json()).result, '0x135289b');

  const blockedMethod = await fetch(`${explorerUrl}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendRawTransaction',
      params: ['0x1234'],
      id: 2
    })
  });
  assert.equal(blockedMethod.status, 400);

  const blockedWrite = await fetch(`${explorerUrl}/api/stats`, { method: 'POST' });
  assert.equal(blockedWrite.status, 405);
});
