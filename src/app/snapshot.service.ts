import { Injectable } from '@angular/core';
import { formatEther, isAddress } from 'ethers';
import type { IndexedTransaction } from './indexer.service';

export const DIGEVRA_CHAIN_ID = 20261019;
export const DIGEVRA_GENESIS_HASH =
  '0xb6448c0fac400f410a13813a9757faec163bb41d9a75e454466ba2c3116ed04e';
const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_TRANSACTIONS = 5000;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const INTEGER_PATTERN = /^\d+$/;
const SNAPSHOT_KEYS = new Set([
  'schemaVersion',
  'chainId',
  'genesisHash',
  'lastBlockNumber',
  'lastBlockHash',
  'syncedAt',
  'address',
  'balanceWei',
  'balanceDgv',
  'historyComplete',
  'transactions'
]);
const TRANSACTION_KEYS = new Set([
  'hash',
  'from',
  'to',
  'blockNumber',
  'transactionIndex',
  'direction',
  'value',
  'valueWei',
  'valueDgv',
  'gasUsed',
  'gasPrice',
  'effectiveGasPriceWei',
  'feeWei',
  'feeDgv',
  'status',
  'timestamp',
  'chainId'
]);

function assertOnlyKeys(value: object, allowed: Set<string>, label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new Error(`${label} contains an unsupported field: ${unexpected}.`);
  }
}

export interface SnapshotTransaction {
  hash: string;
  from?: string | null;
  to?: string | null;
  blockNumber: number;
  transactionIndex: number;
  direction: 'incoming' | 'outgoing';
  valueWei: string;
  valueDgv: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  feeWei: string;
  feeDgv: string;
  status: 0 | 1;
  timestamp: number;
  chainId?: number;
}

export interface DigevraSnapshot {
  schemaVersion: 1;
  chainId: 20261019;
  genesisHash: string;
  lastBlockNumber: number;
  lastBlockHash: string;
  syncedAt: string;
  address: string;
  balanceWei: string;
  balanceDgv: string;
  historyComplete: boolean;
  transactions: SnapshotTransaction[];
}

export interface SnapshotManifest {
  schemaVersion: 1;
  chainId: 20261019;
  genesisHash: string;
  addresses: string[];
}

export interface SnapshotLoadResult {
  snapshot: DigevraSnapshot | null;
  warning: string;
}

interface SnapshotTransactionInput extends Record<string, unknown> {
  hash?: unknown;
  from?: unknown;
  to?: unknown;
  blockNumber?: unknown;
  transactionIndex?: unknown;
  direction?: unknown;
  value?: unknown;
  valueWei?: unknown;
  valueDgv?: unknown;
  gasUsed?: unknown;
  gasPrice?: unknown;
  effectiveGasPriceWei?: unknown;
  feeWei?: unknown;
  feeDgv?: unknown;
  status?: unknown;
  timestamp?: unknown;
  chainId?: unknown;
}

interface SnapshotInput extends Record<string, unknown> {
  schemaVersion?: unknown;
  chainId?: unknown;
  genesisHash?: unknown;
  lastBlockNumber?: unknown;
  lastBlockHash?: unknown;
  syncedAt?: unknown;
  address?: unknown;
  balanceWei?: unknown;
  balanceDgv?: unknown;
  historyComplete?: unknown;
  transactions?: unknown;
}

function isCanonicalIsoDate(value: unknown): value is string {
  return typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function normalizeInteger(
  value: unknown,
  field: string,
  options: { allowHex?: boolean; allowNumber?: boolean } = {}
): string {
  let normalized: bigint;
  if (typeof value === 'string') {
    if (INTEGER_PATTERN.test(value)) {
      normalized = BigInt(value);
    } else if (options.allowHex && /^0x[0-9a-f]+$/i.test(value)) {
      normalized = BigInt(value);
    } else {
      throw new Error(`Champ de transaction invalide : ${field}.`);
    }
  } else if (
    options.allowNumber &&
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    normalized = BigInt(value);
  } else {
    throw new Error(`Champ de transaction invalide : ${field}.`);
  }
  return normalized.toString();
}

function normalizeSafeNumber(value: unknown, field: string): number {
  const normalized = normalizeInteger(value, field, {
    allowHex: true,
    allowNumber: true
  });
  const number = Number(normalized);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Champ de transaction hors limites : ${field}.`);
  }
  return number;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'string' && !/^(?:0x[0-9a-f]+|\d+)$/i.test(value)) {
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) {
      throw new Error('Champ de transaction invalide : timestamp.');
    }
    return Math.floor(milliseconds / 1000);
  }
  const timestamp = normalizeSafeNumber(value, 'timestamp');
  return timestamp >= 1_000_000_000_000
    ? Math.floor(timestamp / 1000)
    : timestamp;
}

function normalizeDgv(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,18})?$/.test(value)) {
    throw new Error(`Champ de transaction invalide : ${field}.`);
  }
  try {
    const [whole, fraction = ''] = value.split('.');
    return formatEther(BigInt(`${whole}${fraction.padEnd(18, '0')}`));
  } catch {
    throw new Error(`Champ de transaction invalide : ${field}.`);
  }
}

function validateSnapshotTransaction(
  value: unknown,
  lastBlockNumber: number,
  address: string
): SnapshotTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transaction du snapshot invalide.');
  }
  assertOnlyKeys(value, TRANSACTION_KEYS, 'Snapshot transaction');
  const transaction = value as SnapshotTransactionInput;
  if (typeof transaction.hash !== 'string' || !HASH_PATTERN.test(transaction.hash)) {
    throw new Error('Champ de transaction invalide : hash.');
  }
  const blockNumber = normalizeSafeNumber(transaction.blockNumber, 'blockNumber');
  if (blockNumber > lastBlockNumber) {
    throw new Error('Champ de transaction hors limites : blockNumber.');
  }
  const transactionIndex = transaction.transactionIndex === undefined
    ? 0
    : normalizeSafeNumber(transaction.transactionIndex, 'transactionIndex');
  const valueWei = normalizeInteger(
    transaction.valueWei ?? transaction.value,
    'valueWei',
    { allowHex: true, allowNumber: true }
  );
  const valueDgv = formatEther(BigInt(valueWei));
  if (transaction.valueDgv !== undefined &&
      normalizeDgv(transaction.valueDgv, 'valueDgv') !== valueDgv) {
    throw new Error('Champ de transaction incohérent : valueDgv.');
  }
  const gasUsedValue = transaction.gasUsed === undefined
    ? null
    : normalizeInteger(transaction.gasUsed, 'gasUsed', {
      allowHex: true,
      allowNumber: true
    });
  const gasPriceValue = transaction.effectiveGasPriceWei ?? transaction.gasPrice;
  const effectiveGasPriceValue = gasPriceValue === undefined
    ? null
    : normalizeInteger(gasPriceValue, 'effectiveGasPriceWei', {
      allowHex: true,
      allowNumber: true
    });
  const providedFee = transaction.feeWei === undefined
    ? null
    : normalizeInteger(transaction.feeWei, 'feeWei', {
      allowHex: true,
      allowNumber: true
    });
  let gasUsed = gasUsedValue;
  let effectiveGasPriceWei = effectiveGasPriceValue;
  let feeWei = providedFee;
  if (feeWei === null && gasUsed !== null && effectiveGasPriceWei !== null) {
    feeWei = (BigInt(gasUsed) * BigInt(effectiveGasPriceWei)).toString();
  }
  if (effectiveGasPriceWei === null && feeWei !== null && gasUsed !== null) {
    const gas = BigInt(gasUsed);
    if (gas > 0n && BigInt(feeWei) % gas === 0n) {
      effectiveGasPriceWei = (BigInt(feeWei) / gas).toString();
    }
  }
  if (gasUsed === null && feeWei !== null && effectiveGasPriceWei !== null) {
    const price = BigInt(effectiveGasPriceWei);
    if (price > 0n && BigInt(feeWei) % price === 0n) {
      gasUsed = (BigInt(feeWei) / price).toString();
    }
  }
  if (gasUsed === null || effectiveGasPriceWei === null || feeWei === null) {
    throw new Error('Champs de frais insuffisants dans la transaction du snapshot.');
  }
  if (BigInt(gasUsed) * BigInt(effectiveGasPriceWei) !== BigInt(feeWei)) {
    throw new Error('Champs de frais incohérents dans la transaction du snapshot.');
  }
  const feeDgv = formatEther(BigInt(feeWei));
  if (transaction.feeDgv !== undefined &&
      normalizeDgv(transaction.feeDgv, 'feeDgv') !== feeDgv) {
    throw new Error('Champ de transaction incohérent : feeDgv.');
  }
  const statusValue = transaction.status;
  const statusText = normalizeSafeNumber(statusValue, 'status');
  if (statusText !== 0 && statusText !== 1) {
    throw new Error('Champ de transaction invalide : status.');
  }
  const timestamp = normalizeTimestamp(transaction.timestamp);
  const from = transaction.from === undefined
    ? undefined
    : transaction.from === null
      ? null
      : typeof transaction.from === 'string' && isAddress(transaction.from)
        ? transaction.from.toLowerCase()
        : undefined;
  const to = transaction.to === undefined
    ? undefined
    : transaction.to === null
      ? null
      : typeof transaction.to === 'string' && isAddress(transaction.to)
        ? transaction.to.toLowerCase()
        : undefined;
  for (const [field, candidate] of [['from', from], ['to', to]] as const) {
    if (candidate === undefined && transaction[field] !== undefined &&
        transaction[field] !== null) {
      throw new Error(`Champ d’adresse invalide dans la transaction : ${field}.`);
    }
  }
  const chainId = transaction.chainId === undefined
    ? undefined
    : normalizeSafeNumber(transaction.chainId, 'chainId');
  if (chainId !== undefined && chainId !== DIGEVRA_CHAIN_ID) {
    throw new Error('Champ de transaction incompatible : chainId.');
  }
  let direction = transaction.direction;
  if (direction === undefined && (from !== undefined || to !== undefined)) {
    if (typeof from === 'string' && from.toLowerCase() === address.toLowerCase()) {
      direction = 'outgoing';
    } else if (typeof to === 'string' && to.toLowerCase() === address.toLowerCase()) {
      direction = 'incoming';
    }
  }
  if (direction !== 'incoming' && direction !== 'outgoing') {
    throw new Error('Champ de transaction invalide : direction.');
  }
  const senderIsWallet = typeof from === 'string' &&
    from.toLowerCase() === address.toLowerCase();
  const recipientIsWallet = typeof to === 'string' &&
    to.toLowerCase() === address.toLowerCase();
  if (
    from !== undefined && from !== null &&
    to !== undefined && to !== null &&
    from.toLowerCase() !== address.toLowerCase() &&
    to.toLowerCase() !== address.toLowerCase()
  ) {
    throw new Error('Transaction non liée au portefeuille autorisé dans le snapshot.');
  }
  if (
    senderIsWallet && !recipientIsWallet && direction !== 'outgoing' ||
    recipientIsWallet && !senderIsWallet && direction !== 'incoming'
  ) {
    throw new Error('Direction incohérente avec l’expéditeur et le destinataire.');
  }
  return {
    hash: transaction.hash.toLowerCase(),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    blockNumber,
    transactionIndex,
    direction,
    valueWei,
    valueDgv,
    gasUsed,
    effectiveGasPriceWei,
    feeWei,
    feeDgv,
    status: statusText,
    timestamp,
    ...(chainId !== undefined ? { chainId } : {})
  };
}

export function validateDigevraSnapshot(
  value: unknown,
  expectedAddress: string
): DigevraSnapshot {
  if (!isAddress(expectedAddress) || !value || typeof value !== 'object' ||
      Array.isArray(value)) {
    throw new Error('Adresse ou snapshot DIGEVRA invalide.');
  }
  assertOnlyKeys(value, SNAPSHOT_KEYS, 'DIGEVRA snapshot');
  const snapshot = value as SnapshotInput;
  const address = expectedAddress.toLowerCase();
  const chainId = normalizeSafeNumber(snapshot.chainId, 'chainId');
  if (
    snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    chainId !== DIGEVRA_CHAIN_ID ||
    typeof snapshot.genesisHash !== 'string' ||
    snapshot.genesisHash.toLowerCase() !== DIGEVRA_GENESIS_HASH ||
    typeof snapshot.address !== 'string' ||
    !isAddress(snapshot.address) ||
    snapshot.address.toLowerCase() !== address
  ) {
    throw new Error('Le snapshot ne correspond pas au réseau, au genesis ou au portefeuille attendu.');
  }
  const lastBlockNumber = normalizeSafeNumber(snapshot.lastBlockNumber, 'lastBlockNumber');
  if (
    typeof snapshot.lastBlockHash !== 'string' ||
    !HASH_PATTERN.test(snapshot.lastBlockHash) ||
    !isCanonicalIsoDate(snapshot.syncedAt) ||
    snapshot.historyComplete !== true ||
    !Array.isArray(snapshot.transactions) ||
    snapshot.transactions.length > MAX_SNAPSHOT_TRANSACTIONS
  ) {
    throw new Error('Le snapshot contient des métadonnées invalides.');
  }
  const balanceWei = normalizeInteger(snapshot.balanceWei, 'balanceWei', {
    allowHex: true,
    allowNumber: true
  });
  const balanceDgv = formatEther(BigInt(balanceWei));
  if (snapshot.balanceDgv !== undefined &&
      normalizeDgv(snapshot.balanceDgv, 'balanceDgv') !== balanceDgv) {
    throw new Error('Champ de snapshot incohérent : balanceDgv.');
  }

  const seenHashes = new Set<string>();
  const transactions = snapshot.transactions.map((transaction) =>
    validateSnapshotTransaction(
      transaction,
      lastBlockNumber,
      address
    )
  );
  for (const transaction of transactions) {
    if (seenHashes.has(transaction.hash)) {
      throw new Error('Le snapshot contient des transactions en double.');
    }
    seenHashes.add(transaction.hash);
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    chainId: DIGEVRA_CHAIN_ID,
    genesisHash: DIGEVRA_GENESIS_HASH,
    lastBlockNumber,
    lastBlockHash: snapshot.lastBlockHash.toLowerCase(),
    syncedAt: snapshot.syncedAt,
    address: snapshot.address,
    balanceWei,
    balanceDgv,
    historyComplete: true,
    transactions
  };
}

export function validateSnapshotManifest(value: unknown): SnapshotManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Manifeste public des snapshots absent ou invalide.');
  }
  assertOnlyKeys(value, new Set([
    'schemaVersion',
    'chainId',
    'genesisHash',
    'addresses'
  ]), 'Snapshot manifest');
  const manifest = value as Partial<SnapshotManifest>;
  if (
    manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    manifest.chainId !== DIGEVRA_CHAIN_ID ||
    manifest.genesisHash?.toLowerCase() !== DIGEVRA_GENESIS_HASH ||
    !Array.isArray(manifest.addresses) ||
    manifest.addresses.some((address) => typeof address !== 'string' || !isAddress(address))
  ) {
    throw new Error('Le manifeste public ne correspond pas au réseau DIGEVRA attendu.');
  }
  const normalized = manifest.addresses.map((address) => address.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Le manifeste public contient des adresses en double.');
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    chainId: DIGEVRA_CHAIN_ID,
    genesisHash: DIGEVRA_GENESIS_HASH,
    addresses: [...manifest.addresses]
  };
}

export function toIndexedTransactions(
  snapshot: DigevraSnapshot
): IndexedTransaction[] {
  return snapshot.transactions.map((transaction) => ({
    hash: transaction.hash,
    blockNumber: transaction.blockNumber,
    transactionIndex: transaction.transactionIndex,
    from: transaction.from ??
      (transaction.direction === 'outgoing' ? snapshot.address : null),
    to: transaction.to ??
      (transaction.direction === 'incoming' ? snapshot.address : null),
    valueWei: transaction.valueWei,
    valueDgv: transaction.valueDgv,
    gasUsed: transaction.gasUsed,
    effectiveGasPriceWei: transaction.effectiveGasPriceWei,
    feeWei: transaction.feeWei,
    feeDgv: transaction.feeDgv,
    status: transaction.status,
    timestamp: transaction.timestamp
  }));
}

@Injectable({ providedIn: 'root' })
export class SnapshotService {
  private storageKey(address: string): string {
    if (!isAddress(address)) {
      throw new Error('Adresse invalide pour le cache du snapshot.');
    }
    return `digevra:snapshot:v1:${DIGEVRA_CHAIN_ID}:${address.toLowerCase()}`;
  }

  saveLocal(value: DigevraSnapshot): void {
    const snapshot = validateDigevraSnapshot(value, value.address);
    try {
      localStorage.setItem(this.storageKey(snapshot.address), JSON.stringify(snapshot));
    } catch (error) {
      throw new Error(
        `Impossible d’enregistrer le snapshot local : ${error instanceof Error ? error.message : 'stockage indisponible'}.`
      );
    }
  }

  readLocal(address: string): DigevraSnapshot | null {
    const serialized = localStorage.getItem(this.storageKey(address));
    if (serialized === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error('Le cache local du snapshot est illisible.');
    }
    return validateDigevraSnapshot(value, address);
  }

  async load(address: string): Promise<SnapshotLoadResult> {
    let local: DigevraSnapshot | null = null;
    let localWarning = '';
    try {
      local = this.readLocal(address);
    } catch (error) {
      localWarning = error instanceof Error
        ? `Cache local refusé : ${error.message}`
        : 'Cache local refusé : format de snapshot invalide.';
    }
    try {
      const base = new URL('snapshots/digevra/', document.baseURI);
      const manifestResponse = await fetch(new URL('manifest.json', base), {
        headers: { accept: 'application/json' },
        cache: 'no-cache'
      });
      if (manifestResponse.status === 404) {
        return { snapshot: local, warning: localWarning };
      }
      if (!manifestResponse.ok) {
        throw new Error(`Manifeste snapshot indisponible (HTTP ${manifestResponse.status}).`);
      }
      const manifest = validateSnapshotManifest(await manifestResponse.json());
      if (!manifest.addresses.some((item) => item.toLowerCase() === address.toLowerCase())) {
        return { snapshot: local, warning: localWarning };
      }

      const snapshotResponse = await fetch(
        new URL(`${address.toLowerCase()}.json`, base),
        { headers: { accept: 'application/json' }, cache: 'no-cache' }
      );
      if (snapshotResponse.status === 404) {
        return {
          snapshot: local,
          warning: [localWarning, 'Le snapshot public autorisé est introuvable.']
            .filter(Boolean).join(' ')
        };
      }
      if (!snapshotResponse.ok) {
        throw new Error(`Snapshot public indisponible (HTTP ${snapshotResponse.status}).`);
      }
      const remote = validateDigevraSnapshot(await snapshotResponse.json(), address);
      const localIsNewer = local && (
        local.lastBlockNumber > remote.lastBlockNumber ||
        local.lastBlockNumber === remote.lastBlockNumber &&
          Date.parse(local.syncedAt) > Date.parse(remote.syncedAt)
      );
      const newest = localIsNewer ? local : remote;
      if (newest === remote) this.saveLocal(remote);
      return { snapshot: newest, warning: localIsNewer ? localWarning : '' };
    } catch (error) {
      if (error instanceof TypeError) {
        return {
          snapshot: local,
          warning: [localWarning, local
            ? 'Snapshot local utilisé; la copie publique est hors ligne.'
            : 'Aucun snapshot valide n’est disponible hors ligne.']
            .filter(Boolean).join(' ')
        };
      }
      return {
        snapshot: local,
        warning: [
          localWarning,
          error instanceof Error ? error.message : 'Échec de lecture du snapshot public.'
        ].filter(Boolean).join(' ')
      };
    }
  }
}
