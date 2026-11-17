import { config } from './config.mjs';
import { createApiServer } from './api.mjs';
import { BlockchainIndexer } from './indexer.mjs';
import { JsonRpcClient } from './rpc-client.mjs';
import { IndexStore } from './store.mjs';

const store = new IndexStore(config.databasePath);
const indexer = new BlockchainIndexer({
  rpc: new JsonRpcClient(config.rpcUrl),
  store,
  chainId: config.chainId,
  startBlock: config.startBlock
});
const server = createApiServer({
  store,
  chainId: config.chainId,
  getStatus: () => indexer.status
});

server.listen(config.apiPort, config.apiHost, () => {
  console.log(`DIGEVRA Indexer API listening on http://${config.apiHost}:${config.apiPort}`);
  console.log(`RPC: ${config.rpcUrl}; expected Chain ID: ${config.chainId}; start block: ${config.startBlock}`);
});

indexer.start(config.pollIntervalMs, (error) => {
  console.error(`Indexer sync failed: ${error instanceof Error ? error.message : 'unknown error'}`);
});

function shutdown() {
  indexer.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
