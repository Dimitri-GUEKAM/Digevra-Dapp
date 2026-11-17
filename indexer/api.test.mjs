import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApiServer } from './api.mjs';
import { IndexStore } from './store.mjs';

const addressA = '0x1111111111111111111111111111111111111111';
const addressB = '0x2222222222222222222222222222222222222222';

test('serves parameterized transaction/address queries with bounded pagination', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'digevra-api-'));
  const store = new IndexStore(join(directory, 'api.sqlite'));
  const blockHash = `0x${'1'.repeat(64)}`;
  const hashes = [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`];
  for (let number = 1; number <= 2; number += 1) {
    store.saveBlock({
      number,
      hash: `0x${number.toString(16).repeat(64)}`,
      parentHash: blockHash,
      timestamp: 1_700_000_000 + number,
      transactions: []
    }, [{
      hash: hashes[number - 1],
      transactionIndex: 0,
      from: addressA,
      to: addressB,
      valueWei: '10000000000000000',
      gasUsed: '21000',
      effectiveGasPriceWei: '1000',
      feeWei: '21000000',
      status: 1
    }]);
  }

  const status = {
    state: 'ready',
    rpcConnected: true,
    indexedFrom: 0,
    lastIndexedBlock: 2,
    chainHead: 2,
    historyComplete: true
  };
  const server = createApiServer({
    store,
    chainId: 20261019,
    getStatus: () => status
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  context.after(() => {
    server.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).chainId, 20261019);

  const page = await fetch(`${baseUrl}/api/address/${addressA}/transactions?limit=1&offset=0`);
  const payload = await page.json();
  assert.equal(payload.pagination.total, 2);
  assert.equal(payload.pagination.hasMore, true);
  assert.equal(payload.items[0].hash, hashes[1]);
  assert.equal(payload.items[0].valueDgv, '0.01');

  const firstTen = await fetch(
    `${baseUrl}/api/address/${addressA}/transactions?limit=10&offset=0`
  );
  assert.equal(firstTen.status, 200);
  const firstTenPayload = await firstTen.json();
  assert.equal(firstTenPayload.pagination.limit, 10);
  assert.equal(firstTenPayload.pagination.offset, 0);
  assert.equal(firstTenPayload.items.length, 2);

  const lookup = await fetch(`${baseUrl}/api/transactions/${hashes[0]}`);
  assert.equal((await lookup.json()).blockNumber, 1);

  const blockHashLookup = await fetch(
    `${baseUrl}/api/blocks/hash/0x${'2'.repeat(64)}`
  );
  const indexedBlock = await blockHashLookup.json();
  assert.equal(blockHashLookup.status, 200);
  assert.equal(indexedBlock.number, 2);
  assert.equal(indexedBlock.hash, `0x${'2'.repeat(64)}`);
  assert.equal(indexedBlock.transactions[0].hash, hashes[1]);

  const missingBlockHash = await fetch(
    `${baseUrl}/api/blocks/hash/0x${'f'.repeat(64)}`
  );
  assert.equal(missingBlockHash.status, 404);

  const badAddress = await fetch(`${baseUrl}/api/address/not-an-address/transactions`);
  assert.equal(badAddress.status, 400);
  const oversized = await fetch(`${baseUrl}/api/transactions?limit=101`);
  assert.equal(oversized.status, 400);
  const methodNotAllowed = await fetch(`${baseUrl}/api/stats`, { method: 'POST' });
  assert.equal(methodNotAllowed.status, 405);
});
