import { createServer } from 'node:http';

const MAX_LIMIT = 100;
const MAX_OFFSET = 1_000_000_000;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

function pageParameters(searchParams) {
  const rawLimit = searchParams.get('limit') ?? '25';
  const rawOffset = searchParams.get('offset') ?? '0';
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)) {
    throw new Error('limit and offset must be non-negative integers.');
  }
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (limit < 1 || limit > MAX_LIMIT || offset > MAX_OFFSET) {
    throw new Error(`limit must be 1-${MAX_LIMIT}; offset must be <= ${MAX_OFFSET}.`);
  }
  return { limit, offset };
}

function paged(result, limit, offset, status) {
  return {
    items: result.items,
    pagination: {
      limit,
      offset,
      total: result.total,
      hasMore: offset + result.items.length < result.total
    },
    indexer: {
      state: status.state,
      startBlock: status.indexedFrom,
      lastIndexedBlock: status.lastIndexedBlock,
      chainHead: status.chainHead,
      historyComplete: status.historyComplete
    }
  };
}

export function createApiServer({ store, getStatus, chainId }) {
  return createServer((request, response) => {
    if (request.method !== 'GET') {
      json(response, 405, { error: 'Only GET requests are supported.' });
      return;
    }

    void handleRequest(request, response, { store, getStatus, chainId });
  });
}

async function handleRequest(request, response, { store, getStatus, chainId }) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const status = getStatus();
    const counts = store.getCounts();
    const state = {
      ...status,
      ...counts,
      chainId,
      historyComplete: Boolean(status.historyComplete)
    };

    if (url.pathname === '/api/health') {
      json(response, status.state === 'degraded' ? 503 : 200, state);
      return;
    }
    if (url.pathname === '/api/stats') {
      json(response, 200, state);
      return;
    }

    if (parts[0] !== 'api') {
      json(response, 404, { error: 'Route not found.' });
      return;
    }

    if (parts[1] === 'blocks' && parts.length === 2) {
      const { limit, offset } = pageParameters(url.searchParams);
      json(response, 200, paged(store.listBlocks(limit, offset), limit, offset, status));
      return;
    }
    if (parts[1] === 'blocks' && parts.length === 4 && parts[2] === 'hash') {
      if (!HASH_PATTERN.test(parts[3])) {
        json(response, 400, { error: 'Invalid block hash.' });
        return;
      }
      const block = store.getBlockByHash(parts[3]);
      json(response, block ? 200 : 404, block ?? { error: 'Block not indexed.' });
      return;
    }
    if (parts[1] === 'blocks' && parts.length === 3) {
      if (!/^\d+$/.test(parts[2]) || !Number.isSafeInteger(Number(parts[2]))) {
        json(response, 400, { error: 'Block number must be a non-negative integer.' });
        return;
      }
      const block = store.getBlock(Number(parts[2]));
      json(response, block ? 200 : 404, block ?? { error: 'Block not indexed.' });
      return;
    }

    if (parts[1] === 'transactions' && parts.length === 2) {
      const { limit, offset } = pageParameters(url.searchParams);
      const address = url.searchParams.get('address');
      if (address && !ADDRESS_PATTERN.test(address)) {
        json(response, 400, { error: 'Invalid EVM address.' });
        return;
      }
      const blockNumberRaw = url.searchParams.get('blockNumber');
      let blockNumber;
      if (blockNumberRaw !== null) {
        if (!/^\d+$/.test(blockNumberRaw) || !Number.isSafeInteger(Number(blockNumberRaw))) {
          json(response, 400, { error: 'blockNumber must be a non-negative integer.' });
          return;
        }
        blockNumber = Number(blockNumberRaw);
      }
      json(response, 200, paged(
        store.listTransactions({ limit, offset, address, blockNumber }),
        limit,
        offset,
        status
      ));
      return;
    }
    if (parts[1] === 'transactions' && parts.length === 3) {
      if (!HASH_PATTERN.test(parts[2])) {
        json(response, 400, { error: 'Invalid transaction hash.' });
        return;
      }
      const transaction = store.getTransaction(parts[2]);
      json(response, transaction ? 200 : 404, transaction ?? { error: 'Transaction not indexed.' });
      return;
    }

    if (parts[1] === 'address' && parts.length === 3) {
      if (!ADDRESS_PATTERN.test(parts[2])) {
        json(response, 400, { error: 'Invalid EVM address.' });
        return;
      }
      json(response, 200, store.getAddressSummary(parts[2]));
      return;
    }
    if (parts[1] === 'address' && parts.length === 4 && parts[3] === 'transactions') {
      if (!ADDRESS_PATTERN.test(parts[2])) {
        json(response, 400, { error: 'Invalid EVM address.' });
        return;
      }
      const { limit, offset } = pageParameters(url.searchParams);
      json(response, 200, paged(
        store.listTransactions({ limit, offset, address: parts[2] }),
        limit,
        offset,
        status
      ));
      return;
    }

    json(response, 404, { error: 'Route not found.' });
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : 'Invalid request.'
    });
  }
}
