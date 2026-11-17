import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExplorerUrl,
  explorerHash,
  explorerRoutePath,
  getExplorerBaseUrl
} from './routes.js';

test('builds hash routes for direct browser navigation and refresh', () => {
  const hash = `0x${'a'.repeat(64)}`;
  assert.equal(explorerHash('transaction', hash), `#/transaction/${hash}`);
  assert.equal(explorerHash('block', 27640), '#/block/27640');
  assert.equal(explorerHash('address', '0x1111111111111111111111111111111111111111'),
    '#/address/0x1111111111111111111111111111111111111111');
  assert.equal(explorerHash('home'), '#/');
  assert.equal(
    buildExplorerUrl('http://localhost:4201', 'transaction', hash),
    `http://localhost:4201/#/transaction/${hash}`
  );
  assert.equal(
    buildExplorerUrl('https://example.github.io/digevra/', 'transaction', hash),
    `https://example.github.io/digevra/#/transaction/${hash}`
  );
});

test('keeps path-based external explorers and encodes route identifiers', () => {
  assert.equal(
    buildExplorerUrl('https://sepolia.etherscan.io', 'transaction', '0xabc', 'path'),
    'https://sepolia.etherscan.io/tx/0xabc'
  );
  assert.equal(
    explorerRoutePath('address', '0xabc/def'),
    '/address/0xabc%2Fdef'
  );
  assert.equal(getExplorerBaseUrl('http://localhost:4201'), 'http://localhost:4201');
});

test('rejects unknown route names and a missing path-mode identifier', () => {
  assert.throws(() => explorerRoutePath('invalid'), /Unknown Explorer route/);
  assert.throws(() => buildExplorerUrl('https://example.test', 'block', undefined, 'path'),
    /requires an identifier/);
});
