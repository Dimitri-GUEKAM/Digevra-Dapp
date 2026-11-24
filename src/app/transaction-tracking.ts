import { getAddress, isAddress } from 'ethers';

const STORAGE_PREFIX = 'digevra_transaction_tracking_v1';
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export type TrackedTransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface TrackedTransaction {
  schemaVersion: 1;
  chainId: number;
  sender: string;
  recipient: string | null;
  amountDgv: string | null;
  hash: string;
  status: TrackedTransactionStatus;
  updatedAt: string;
  blockNumber?: number;
}

export function transactionTrackingKey(chainId: number, sender: string): string {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !isAddress(sender)) {
    throw new Error('Réseau ou adresse invalide pour le suivi de transaction.');
  }
  return `${STORAGE_PREFIX}:${chainId}:${sender.toLowerCase()}`;
}

export function readTrackedTransaction(
  storage: Storage,
  chainId: number,
  sender: string
): TrackedTransaction | null {
  const serialized = storage.getItem(transactionTrackingKey(chainId, sender));
  if (serialized === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Le statut local de la transaction est illisible.');
  }
  if (!isTrackedTransaction(value, chainId, sender)) {
    throw new Error('Le statut local de la transaction est invalide.');
  }
  return {
    ...value,
    sender: getAddress(value.sender),
    recipient: value.recipient ? getAddress(value.recipient) : null,
    hash: value.hash.toLowerCase()
  };
}

export function saveTrackedTransaction(
  storage: Storage,
  transaction: TrackedTransaction
): void {
  if (!isTrackedTransaction(transaction, transaction.chainId, transaction.sender)) {
    throw new Error('Refus d’enregistrer un statut de transaction invalide.');
  }
  try {
    storage.setItem(
      transactionTrackingKey(transaction.chainId, transaction.sender),
      JSON.stringify(transaction)
    );
  } catch (error) {
    throw new Error(
      `Impossible d’enregistrer le suivi local de la transaction : ${error instanceof Error ? error.message : 'stockage indisponible'}.`
    );
  }
}

function isTrackedTransaction(
  value: unknown,
  expectedChainId: number,
  expectedSender: string
): value is TrackedTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const transaction = value as Partial<TrackedTransaction>;
  const allowedKeys = new Set([
    'schemaVersion',
    'chainId',
    'sender',
    'recipient',
    'amountDgv',
    'hash',
    'status',
    'updatedAt',
    'blockNumber'
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;

  return transaction.schemaVersion === 1 &&
    transaction.chainId === expectedChainId &&
    typeof transaction.sender === 'string' &&
    isAddress(transaction.sender) &&
    transaction.sender.toLowerCase() === expectedSender.toLowerCase() &&
    (transaction.recipient === null ||
      typeof transaction.recipient === 'string' && isAddress(transaction.recipient)) &&
    (transaction.amountDgv === null ||
      typeof transaction.amountDgv === 'string' &&
        /^\d+(?:\.\d{1,18})?$/.test(transaction.amountDgv)) &&
    typeof transaction.hash === 'string' &&
    HASH_PATTERN.test(transaction.hash) &&
    ['pending', 'confirmed', 'failed'].includes(transaction.status ?? '') &&
    typeof transaction.updatedAt === 'string' &&
    Number.isFinite(Date.parse(transaction.updatedAt)) &&
    (transaction.blockNumber === undefined ||
      Number.isSafeInteger(transaction.blockNumber) && transaction.blockNumber >= 0);
}
