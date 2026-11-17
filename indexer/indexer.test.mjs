import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BlockchainIndexer } from './indexer.mjs';
import { IndexStore, formatWei } from './store.mjs';

const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';

function block(number, hash, parentHash, transactions = []) {
  return {
    number: `0x${number.toString(16)}`,
    hash,
    parentHash,
    timestamp: `0x${(1_700_000_000 + number).toString(16)}`,
    transactions
  };
}

function transfer(hash, transactionIndex = 0, value = '0x16345785d8a0000') {
  return {
    hash,
    transactionIndex: `0x${transactionIndex.toString(16)}`,
    from: sender,
    to: recipient,
    value,
    gasPrice: '0x3e8'
  };
}

function makeTempStore() {
  const directory = mkdtempSync(join(tmpdir(), 'digevra-indexer-'));
  const store = new IndexStore(join(directory, 'index.sqlite'));
  return {
    store,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function makeRpc(blocks, receipts = new Map()) {
  return {
    getChainId: async () => 20261019,
    getBlockNumber: async () => Math.max(...blocks.keys()),
    getBlock: async (number) => blocks.get(number) ?? null,
    getTransactionReceipt: async (hash) => receipts.get(hash) ?? null
  };
}

test('indexes blocks, native transfers, status, and exact receipt fees', async () => {
  const temp = makeTempStore();
  try {
    const tx = transfer(`0x${'a'.repeat(64)}`);
    const blocks = new Map([
      [0, block(0, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`)],
      [1, block(1, `0x${'1'.repeat(64)}`, `0x${'0'.repeat(64)}`, [tx])]
    ]);
    const receipts = new Map([[tx.hash, {
      blockHash: blocks.get(1).hash,
      gasUsed: '0x5208',
      effectiveGasPrice: '0x3e8',
      status: '0x1'
    }]]);
    const indexer = new BlockchainIndexer({
      rpc: makeRpc(blocks, receipts),
      store: temp.store,
      chainId: 20261019
    });

    await indexer.syncOnce();

    assert.deepEqual(temp.store.getCounts(), {
      indexedBlocks: 2,
      indexedTransactions: 1
    });
    const indexed = temp.store.getTransaction(tx.hash);
    assert.equal(indexed.from, sender);
    assert.equal(indexed.to, recipient);
    assert.equal(indexed.valueWei, '100000000000000000');
    assert.equal(indexed.valueDgv, '0.1');
    assert.equal(indexed.gasUsed, '21000');
    assert.equal(indexed.feeWei, '21000000');
    assert.equal(indexed.status, 1);
    assert.equal(indexer.status.historyComplete, true);
  } finally {
    temp.close();
  }
});

test('resume is idempotent and does not create duplicates', async () => {
  const temp = makeTempStore();
  try {
    const tx = transfer(`0x${'b'.repeat(64)}`);
    const head = block(0, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`, [tx]);
    const blocks = new Map([[0, head]]);
    const receipts = new Map([[tx.hash, {
      blockHash: head.hash,
      gasUsed: '0x5208',
      effectiveGasPrice: '0x3e8',
      status: '0x1'
    }]]);
    const rpc = makeRpc(blocks, receipts);
    await new BlockchainIndexer({ rpc, store: temp.store, chainId: 20261019 }).syncOnce();
    await new BlockchainIndexer({ rpc, store: temp.store, chainId: 20261019 }).syncOnce();

    assert.deepEqual(temp.store.getCounts(), {
      indexedBlocks: 1,
      indexedTransactions: 1
    });
  } finally {
    temp.close();
  }
});

test('rolls back a reorganized suffix before indexing its canonical replacement', async () => {
  const temp = makeTempStore();
  try {
    const oldTx = transfer(`0x${'c'.repeat(64)}`);
    const replacementTx = transfer(`0x${'d'.repeat(64)}`, 1, '0x2386f26fc10000');
    const genesis = block(0, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`);
    const common = block(1, `0x${'1'.repeat(64)}`, genesis.hash);
    const oldBlock = block(2, `0x${'2'.repeat(64)}`, common.hash, [oldTx]);
    const blocks = new Map([[0, genesis], [1, common], [2, oldBlock]]);
    const receipts = new Map([
      [oldTx.hash, {
        blockHash: oldBlock.hash,
        gasUsed: '0x5208',
        effectiveGasPrice: '0x3e8',
        status: '0x1'
      }],
      [replacementTx.hash, {
        blockHash: `0x${'e'.repeat(64)}`,
        gasUsed: '0x5208',
        effectiveGasPrice: '0x3e8',
        status: '0x1'
      }]
    ]);
    const rpc = makeRpc(blocks, receipts);
    const indexer = new BlockchainIndexer({ rpc, store: temp.store, chainId: 20261019 });
    await indexer.syncOnce();

    const replacementBlock = block(2, `0x${'e'.repeat(64)}`, common.hash, [replacementTx]);
    blocks.set(2, replacementBlock);
    await indexer.syncOnce();

    assert.equal(temp.store.getTransaction(oldTx.hash), null);
    assert.equal(temp.store.getTransaction(replacementTx.hash)?.valueDgv, '0.01');
    assert.equal(temp.store.getBlock(2)?.hash, replacementBlock.hash);
  } finally {
    temp.close();
  }
});

test('does not persist partial block data when the RPC fails to return a receipt', async () => {
  const temp = makeTempStore();
  try {
    const tx = transfer(`0x${'f'.repeat(64)}`);
    const head = block(0, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`, [tx]);
    const indexer = new BlockchainIndexer({
      rpc: makeRpc(new Map([[0, head]])),
      store: temp.store,
      chainId: 20261019
    });

    await assert.rejects(indexer.syncOnce(), /Receipt .* missing/);
    assert.deepEqual(temp.store.getCounts(), {
      indexedBlocks: 0,
      indexedTransactions: 0
    });
    assert.equal(indexer.status.state, 'degraded');
  } finally {
    temp.close();
  }
});

test('refuses to index a different chain ID', async () => {
  const temp = makeTempStore();
  try {
    const indexer = new BlockchainIndexer({
      rpc: { getChainId: async () => 1 },
      store: temp.store,
      chainId: 20261019
    });
    await assert.rejects(indexer.syncOnce(), /Unexpected Chain ID/);
    assert.equal(temp.store.getCounts().indexedBlocks, 0);
    assert.equal(indexer.status.rpcConnected, false);
  } finally {
    temp.close();
  }
});

test('formats wei exactly without floating-point conversion', () => {
  assert.equal(formatWei('100000000000000000000'), '100');
  assert.equal(formatWei('10000000000000000'), '0.01');
  assert.equal(formatWei('1'), '0.000000000000000001');
});
