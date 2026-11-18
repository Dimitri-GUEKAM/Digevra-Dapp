import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatEther, getAddress, isAddress } from 'ethers';

const CHAIN_ID = 20261019;
const GENESIS_HASH =
  '0xb6448c0fac400f410a13813a9757faec163bb41d9a75e454466ba2c3116ed04e';
const MAX_TRANSACTIONS = 5000;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const ROOT = resolve(import.meta.dirname, '..');
const SNAPSHOT_DIRECTORY = resolve(ROOT, 'public', 'snapshots', 'digevra');

function quantity(value, field) {
  if (typeof value !== 'string' ||
      !/^(?:0x[0-9a-f]+|\d+)$/i.test(value)) {
    throw new Error(`Besu returned an invalid ${field}.`);
  }
  return BigInt(value);
}

export function verifyAndSerializeTransaction(item, chain, address) {
  const { transaction, receipt, block } = chain;
  if (
    !transaction ||
    !receipt ||
    !block ||
    typeof item.hash !== 'string' ||
    !HASH_PATTERN.test(item.hash)
  ) {
    throw new Error('Indexer transaction could not be verified against Besu.');
  }
  const hash = item.hash.toLowerCase();
  const txHash = transaction.hash?.toLowerCase();
  const receiptHash = receipt.transactionHash?.toLowerCase();
  const blockNumber = Number(quantity(transaction.blockNumber, 'transaction block number'));
  const receiptBlockNumber = Number(quantity(receipt.blockNumber, 'receipt block number'));
  const transactionIndex = Number(quantity(transaction.transactionIndex, 'transaction index'));
  const receiptTransactionIndex = Number(
    quantity(receipt.transactionIndex, 'receipt transaction index')
  );
  const valueWei = quantity(transaction.value, 'transaction value');
  const gasUsed = quantity(receipt.gasUsed, 'receipt gas used');
  const status = Number(quantity(receipt.status, 'receipt status'));
  const blockTimestamp = Number(quantity(block.timestamp, 'block timestamp'));
  const from = transaction.from;
  const to = transaction.to ?? null;
  const expectedAddress = address.toLowerCase();

  if (
    txHash !== hash ||
    receiptHash !== hash ||
    blockNumber !== item.blockNumber ||
    receiptBlockNumber !== item.blockNumber ||
    transactionIndex !== item.transactionIndex ||
    receiptTransactionIndex !== item.transactionIndex ||
    Number(quantity(block.number, 'block number')) !== item.blockNumber ||
    !Number.isSafeInteger(blockTimestamp) ||
    status !== item.status ||
    valueWei.toString() !== item.valueWei ||
    gasUsed.toString() !== item.gasUsed ||
    !Number.isSafeInteger(item.timestamp) ||
    item.timestamp !== blockTimestamp ||
    typeof from !== 'string' ||
    !isAddress(from) ||
    to !== null && (typeof to !== 'string' || !isAddress(to)) ||
    from.toLowerCase() !== expectedAddress &&
      (typeof to !== 'string' || to.toLowerCase() !== expectedAddress)
  ) {
    throw new Error(`Indexer fields do not match Besu transaction ${hash}.`);
  }
  const chainId = transaction.chainId === undefined
    ? undefined
    : Number(quantity(transaction.chainId, 'transaction Chain ID'));
  if (chainId !== undefined && chainId !== CHAIN_ID) {
    throw new Error(`Transaction ${hash} belongs to Chain ID ${chainId}.`);
  }
  const effectiveGasPrice = receipt.effectiveGasPrice === undefined
    ? quantity(item.effectiveGasPriceWei, 'indexer effective gas price')
    : quantity(receipt.effectiveGasPrice, 'receipt effective gas price');
  if (
    !/^\d+$/.test(item.effectiveGasPriceWei) ||
    effectiveGasPrice.toString() !== item.effectiveGasPriceWei
  ) {
    throw new Error(`Indexer gas price does not match Besu receipt ${hash}.`);
  }
  const feeWei = gasUsed * effectiveGasPrice;
  if (feeWei.toString() !== item.feeWei) {
    throw new Error(`Indexer fee does not match Besu receipt ${hash}.`);
  }

  return {
    hash,
    from: getAddress(from),
    to: to === null ? null : getAddress(to),
    ...(chainId !== undefined ? { chainId } : {}),
    blockNumber,
    transactionIndex,
    direction: from.toLowerCase() === expectedAddress ? 'outgoing' : 'incoming',
    valueWei: valueWei.toString(),
    valueDgv: formatEther(valueWei),
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    feeWei: feeWei.toString(),
    feeDgv: formatEther(feeWei),
    status,
    timestamp: blockTimestamp
  };
}

function parseAddressArgument(argv) {
  if (argv.length !== 2 || argv[0] !== '--address' || !isAddress(argv[1])) {
    throw new Error('Usage: node scripts/update-digevra-snapshot.mjs --address <public-address>');
  }
  return getAddress(argv[1]);
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`${label} is unavailable.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`RPC ${method} failed: ${payload.error.message ?? 'unknown error'}`);
  }
  if (!Object.hasOwn(payload, 'result')) {
    throw new Error(`RPC ${method} returned no result.`);
  }
  return payload.result;
}

async function getIndexerHistory(indexerUrl, address) {
  const items = [];
  let offset = 0;
  let expectedTotal = null;
  let indexerStatus = null;

  while (expectedTotal === null || offset < expectedTotal) {
    const url = new URL(
      `/api/address/${encodeURIComponent(address)}/transactions?limit=100&offset=${offset}`,
      indexerUrl
    );
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`Indexer returned HTTP ${response.status}.`);
    }
    const page = await response.json();
    if (
      !Array.isArray(page.items) ||
      !Number.isSafeInteger(page.pagination?.total) ||
      !Number.isSafeInteger(page.pagination?.limit) ||
      !Number.isSafeInteger(page.pagination?.offset) ||
      !page.indexer
    ) {
      throw new Error('Indexer returned an invalid transaction page.');
    }
    if (expectedTotal === null) {
      expectedTotal = page.pagination.total;
      indexerStatus = page.indexer;
      if (expectedTotal > MAX_TRANSACTIONS) {
        throw new Error(`Snapshot refused: history exceeds ${MAX_TRANSACTIONS} transactions.`);
      }
    } else if (
      page.pagination.total !== expectedTotal ||
      page.indexer.lastIndexedBlock !== indexerStatus.lastIndexedBlock
    ) {
      throw new Error('Indexer history changed while the snapshot was being generated.');
    }
    if (page.pagination.offset !== offset || page.items.length === 0 && offset < expectedTotal) {
      throw new Error('Indexer returned a missing or inconsistent history page.');
    }
    items.push(...page.items);
    offset += page.items.length;
  }

  if (
    indexerStatus?.state !== 'ready' ||
    indexerStatus.historyComplete !== true ||
    indexerStatus.lastIndexedBlock === null ||
    indexerStatus.lastIndexedBlock === undefined
  ) {
    throw new Error('Indexer is not ready with complete history; no snapshot was written.');
  }

  return { items, indexerStatus };
}

async function getIndexerHealth(indexerUrl) {
  const response = await fetch(new URL('/api/health', indexerUrl), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`Indexer health returned HTTP ${response.status}.`);
  }
  const health = await response.json();
  if (
    health.chainId !== CHAIN_ID ||
    health.rpcConnected !== true ||
    health.state !== 'ready' ||
    health.historyComplete !== true ||
    !Number.isSafeInteger(health.lastIndexedBlock) ||
    health.lastIndexedBlock < 0
  ) {
    throw new Error('Indexer health does not confirm a ready DIGEVRA RPC and complete history.');
  }
  return health;
}

async function createSnapshot(address) {
  const rpcUrl = process.env.DIGEVRA_RPC_URL ?? 'http://127.0.0.1:9545';
  const indexerUrl = process.env.INDEXER_API_URL ?? 'http://127.0.0.1:3001';
  const manifest = await readJson(
    resolve(SNAPSHOT_DIRECTORY, 'manifest.json'),
    'Public snapshot allowlist'
  );
  if (
    Object.keys(manifest).some((key) =>
      !['schemaVersion', 'chainId', 'genesisHash', 'addresses'].includes(key)
    ) ||
    manifest.schemaVersion !== 1 ||
    manifest.chainId !== CHAIN_ID ||
    manifest.genesisHash?.toLowerCase() !== GENESIS_HASH ||
    !Array.isArray(manifest.addresses) ||
    !manifest.addresses.some((entry) =>
      typeof entry === 'string' && isAddress(entry) &&
      entry.toLowerCase() === address.toLowerCase()
    )
  ) {
    throw new Error('The address is not explicitly authorized in the public snapshot allowlist.');
  }
  const authorizedAddresses = manifest.addresses.map((entry) => entry.toLowerCase());
  if (new Set(authorizedAddresses).size !== authorizedAddresses.length) {
    throw new Error('The public snapshot allowlist contains duplicate addresses.');
  }

  const observedChainId = Number(BigInt(await rpc(rpcUrl, 'eth_chainId')));
  if (observedChainId !== CHAIN_ID) {
    throw new Error(`Unexpected Chain ID ${observedChainId}; expected ${CHAIN_ID}.`);
  }
  const genesis = await rpc(rpcUrl, 'eth_getBlockByNumber', ['0x0', false]);
  if (genesis?.hash?.toLowerCase() !== GENESIS_HASH) {
    throw new Error('RPC genesis hash does not match the DIGEVRA snapshot allowlist.');
  }

  const healthBefore = await getIndexerHealth(indexerUrl);
  const { items, indexerStatus } = await getIndexerHistory(indexerUrl, address);
  const healthAfter = await getIndexerHealth(indexerUrl);
  if (
    healthBefore.lastIndexedBlock !== healthAfter.lastIndexedBlock ||
    indexerStatus.lastIndexedBlock !== healthAfter.lastIndexedBlock
  ) {
    throw new Error('Indexer advanced or changed during snapshot generation; retry after it settles.');
  }
  const lastBlockNumber = indexerStatus.lastIndexedBlock;
  const [lastBlock, balanceWei] = await Promise.all([
    rpc(rpcUrl, 'eth_getBlockByNumber', [`0x${lastBlockNumber.toString(16)}`, false]),
    rpc(rpcUrl, 'eth_getBalance', [
      address,
      `0x${lastBlockNumber.toString(16)}`
    ])
  ]);
  if (
    !lastBlock ||
    Number(BigInt(lastBlock.number)) !== lastBlockNumber ||
    typeof lastBlock.hash !== 'string'
  ) {
    throw new Error('RPC could not verify the indexer’s last indexed block.');
  }

  const seenHashes = new Set();
  const blocksByNumber = new Map();
  const transactions = [];
  for (const item of items) {
    if (
      typeof item.hash !== 'string' ||
      !HASH_PATTERN.test(item.hash) ||
      item.status !== 0 && item.status !== 1 ||
      !Number.isSafeInteger(item.blockNumber) ||
      item.blockNumber < 0 ||
      item.blockNumber > lastBlockNumber ||
      !Number.isSafeInteger(item.transactionIndex) ||
      item.transactionIndex < 0 ||
      !Number.isSafeInteger(item.timestamp) ||
      !/^\d+$/.test(item.valueWei) ||
      !/^\d+$/.test(item.gasUsed) ||
      !/^\d+$/.test(item.effectiveGasPriceWei) ||
      !/^\d+$/.test(item.feeWei)
    ) {
      throw new Error('Indexer returned an invalid transaction record.');
    }
    const hash = item.hash.toLowerCase();
    if (seenHashes.has(hash)) {
      throw new Error('Indexer returned duplicate transactions; no snapshot was written.');
    }
    seenHashes.add(hash);

    const [transaction, receipt] = await Promise.all([
      rpc(rpcUrl, 'eth_getTransactionByHash', [hash]),
      rpc(rpcUrl, 'eth_getTransactionReceipt', [hash])
    ]);
    let transactionBlock = blocksByNumber.get(item.blockNumber);
    if (!transactionBlock) {
      transactionBlock = await rpc(rpcUrl, 'eth_getBlockByNumber', [
        `0x${item.blockNumber.toString(16)}`,
        false
      ]);
      blocksByNumber.set(item.blockNumber, transactionBlock);
    }
    if (
      !receipt ||
      receipt.transactionHash?.toLowerCase() !== hash ||
      Number(BigInt(receipt.blockNumber)) !== item.blockNumber ||
      Number(BigInt(receipt.status)) !== item.status
    ) {
      throw new Error(`Receipt verification failed for transaction ${hash}.`);
    }

    transactions.push(verifyAndSerializeTransaction(item, {
      transaction,
      receipt,
      block: transactionBlock
    }, address));
  }
  transactions.sort((left, right) =>
    right.blockNumber - left.blockNumber ||
    right.transactionIndex - left.transactionIndex
  );

  return {
    schemaVersion: 1,
    chainId: CHAIN_ID,
    genesisHash: GENESIS_HASH,
    lastBlockNumber,
    lastBlockHash: lastBlock.hash.toLowerCase(),
    syncedAt: new Date().toISOString(),
    address,
    balanceWei: BigInt(balanceWei).toString(),
    balanceDgv: formatEther(BigInt(balanceWei)),
    historyComplete: true,
    transactions
  };
}

async function main(argv) {
  const address = parseAddressArgument(argv);
  await mkdir(SNAPSHOT_DIRECTORY, { recursive: true });
  const destination = resolve(SNAPSHOT_DIRECTORY, `${address.toLowerCase()}.json`);
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    const snapshot = await createSnapshot(address);
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
    await rename(temporary, destination);
    process.stdout.write(
      `Snapshot verified: Chain ID ${snapshot.chainId}, block ${snapshot.lastBlockNumber}, ` +
      `${snapshot.balanceDgv} DGV, ${snapshot.transactions.length} confirmed transactions.\n` +
      `Address: ${snapshot.address}\nFile: ${destination}\n`
    );
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `Snapshot update stopped: ${error instanceof Error ? error.message : 'unknown error'}\n`
    );
    process.exitCode = 1;
  });
}
