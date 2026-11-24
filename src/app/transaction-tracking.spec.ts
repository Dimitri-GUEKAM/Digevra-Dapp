import {
  readTrackedTransaction,
  saveTrackedTransaction,
  transactionTrackingKey,
  TrackedTransaction
} from './transaction-tracking';

describe('transaction tracking storage', () => {
  const sender = '0x1111111111111111111111111111111111111111';
  const transaction: TrackedTransaction = {
    schemaVersion: 1,
    chainId: 20261019,
    sender,
    recipient: '0x2222222222222222222222222222222222222222',
    amountDgv: '1.25',
    hash: `0x${'a'.repeat(64)}`,
    status: 'pending',
    updatedAt: '2026-11-20T09:00:00.000Z'
  };

  beforeEach(() => localStorage.clear());

  it('scopes saved transaction state to its chain and sender address', () => {
    saveTrackedTransaction(localStorage, transaction);

    expect(readTrackedTransaction(localStorage, 20261019, sender))
      .toEqual(transaction);
    expect(readTrackedTransaction(
      localStorage,
      20261019,
      '0x3333333333333333333333333333333333333333'
    )).toBeNull();
    expect(readTrackedTransaction(localStorage, 11155111, sender)).toBeNull();
  });

  it('uses a stable, normalized storage key', () => {
    expect(transactionTrackingKey(20261019, sender.toUpperCase().replace('0X', '0x')))
      .toBe(transactionTrackingKey(20261019, sender));
  });

  it('rejects malformed or mismatched persisted status instead of trusting it', () => {
    const key = transactionTrackingKey(20261019, sender);
    localStorage.setItem(key, '{');
    expect(() => readTrackedTransaction(localStorage, 20261019, sender))
      .toThrow(/illisible/);

    localStorage.setItem(key, JSON.stringify({
      ...transaction,
      sender: '0x3333333333333333333333333333333333333333'
    }));
    expect(() => readTrackedTransaction(localStorage, 20261019, sender))
      .toThrow(/invalide/);
  });

  it('does not persist private keys or signed transaction payloads', () => {
    saveTrackedTransaction(localStorage, transaction);
    const stored = localStorage.getItem(transactionTrackingKey(20261019, sender))!;
    expect(stored).not.toContain('privateKey');
    expect(stored).not.toContain('signedTransaction');
    expect(JSON.parse(stored)).toEqual(transaction);
  });
});
