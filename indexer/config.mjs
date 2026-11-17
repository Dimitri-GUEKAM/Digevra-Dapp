import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function readInteger(name, fallback, minimum = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be a safe integer >= ${minimum}.`);
  }

  return parsed;
}

export const config = Object.freeze({
  rpcUrl: process.env.DIGEVRA_RPC_URL ?? 'http://127.0.0.1:9545',
  chainId: 20261019,
  startBlock: readInteger('INDEXER_START_BLOCK', 0),
  pollIntervalMs: readInteger('INDEXER_POLL_INTERVAL_MS', 3000, 250),
  apiHost: process.env.INDEXER_API_HOST ?? '127.0.0.1',
  apiPort: readInteger('INDEXER_API_PORT', 3001, 1),
  databasePath: resolve(
    process.env.INDEXER_DB_PATH ??
      fileURLToPath(new URL('./data/digevra.sqlite', import.meta.url))
  )
});
