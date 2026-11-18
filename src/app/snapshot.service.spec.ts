import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIGEVRA_GENESIS_HASH,
  SnapshotService,
  toIndexedTransactions,
  validateDigevraSnapshot,
  validateSnapshotManifest
} from './snapshot.service';

const ADDRESS = '0x35b4336eF00eD099e030D29f925f2C69FD86b912';
const OTHER_ADDRESS = '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function makeSnapshot(address = ADDRESS) {
  return {
    schemaVersion: 1 as const,
    chainId: 20261019 as const,
    genesisHash: DIGEVRA_GENESIS_HASH,
    lastBlockNumber: 30698,
    lastBlockHash: `0x${'a'.repeat(64)}`,
    syncedAt: '2026-01-01T00:00:00.000Z',
    address,
    balanceWei: '5000000000000000000000',
    balanceDgv: '5000.0',
    historyComplete: true,
    transactions: [{
      hash: `0x${'b'.repeat(64)}`,
      blockNumber: 30698,
      transactionIndex: 0,
      direction: 'incoming' as const,
      valueWei: '1000000000000000000',
      valueDgv: '1.0',
      gasUsed: '21000',
      effectiveGasPriceWei: '1000000000',
      feeWei: '21000000000000',
      feeDgv: '0.000021',
      status: 1 as const,
      timestamp: 1767225600
    }]
  };
}

describe('SnapshotService', () => {
  it('accepts only a strict allowlist for this chain and genesis', () => {
    const manifest = {
      schemaVersion: 1,
      chainId: 20261019,
      genesisHash: DIGEVRA_GENESIS_HASH,
      addresses: [ADDRESS]
    };
    expect(validateSnapshotManifest(manifest).addresses).toEqual([ADDRESS]);
    expect(() => validateSnapshotManifest({
      ...manifest,
      addresses: [ADDRESS, ADDRESS]
    })).toThrow(/en double/);
    expect(() => validateSnapshotManifest({
      ...manifest,
      privateKey: 'must never be included'
    })).toThrow(/unsupported field/);
  });

  it('validates the network, address, balance and transaction fields', () => {
    expect(validateDigevraSnapshot(makeSnapshot(), ADDRESS).balanceDgv)
      .toBe('5000.0');
    expect(() => validateDigevraSnapshot(makeSnapshot(OTHER_ADDRESS), ADDRESS))
      .toThrow(/portefeuille attendu/);
    expect(() => validateDigevraSnapshot({
      ...makeSnapshot(),
      privateKey: 'must never be included'
    }, ADDRESS)).toThrow(/unsupported field/);
  });

  it('accepts the checked-in public snapshot and preserves its confirmed transfer', () => {
    const snapshot = JSON.parse(readFileSync(resolve(
      process.cwd(),
      'public',
      'snapshots',
      'digevra',
      '0x35b4336ef00ed099e030d29f925f2c69fd86b912.json'
    ), 'utf8')) as unknown;
    const validated = validateDigevraSnapshot(snapshot, ADDRESS);
    expect(validated.balanceDgv).toBe('5000.0');
    expect(validated.transactions[0]).toMatchObject({
      hash: '0x954847f6c00699f1c5231c29d3027f1583e4c97da01917591681b435b316bde3',
      from: OTHER_ADDRESS.toLowerCase(),
      to: ADDRESS.toLowerCase(),
      chainId: 20261019,
      blockNumber: 30698,
      direction: 'incoming',
      valueDgv: '5000.0',
      status: 1
    });
  });

  it('preserves verified counterparty addresses when supplied by a snapshot', () => {
    const transactions = toIndexedTransactions(
      validateDigevraSnapshot({
        ...makeSnapshot(),
        transactions: [{
          ...makeSnapshot().transactions[0],
          from: OTHER_ADDRESS,
          to: ADDRESS
        }]
      }, ADDRESS)
    );
    expect(transactions[0].to?.toLowerCase()).toBe(ADDRESS.toLowerCase());
    expect(transactions[0].from?.toLowerCase()).toBe(OTHER_ADDRESS.toLowerCase());
  });

  it('normalizes a compatible legacy transaction with RPC quantity and timestamp formats', () => {
    const snapshot = makeSnapshot();
    const tx = snapshot.transactions[0];
    const legacy = validateDigevraSnapshot({
      ...snapshot,
      transactions: [{
        hash: tx.hash.toUpperCase().replace('0X', '0x'),
        from: OTHER_ADDRESS,
        to: ADDRESS,
        blockNumber: '0x77ea',
        value: '0xde0b6b3a7640000',
        valueDgv: '1.000',
        gasUsed: '0x5208',
        gasPrice: '0x3b9aca00',
        status: '0x1',
        timestamp: '2026-01-01T00:00:00.000Z',
        chainId: '0x' + (20261019).toString(16)
      }]
    }, ADDRESS);

    expect(legacy.transactions[0]).toMatchObject({
      blockNumber: 30698,
      transactionIndex: 0,
      direction: 'incoming',
      valueWei: '1000000000000000000',
      valueDgv: '1.0',
      gasUsed: '21000',
      effectiveGasPriceWei: '1000000000',
      feeWei: '21000000000000',
      feeDgv: '0.000021',
      status: 1,
      timestamp: 1767225600
    });
  });

  it('accepts whole-token decimal strings emitted by the indexer', () => {
    const snapshot = makeSnapshot();
    const transaction = snapshot.transactions[0];
    const normalized = validateDigevraSnapshot({
      ...snapshot,
      balanceDgv: '5000',
      transactions: [{
        ...transaction,
        valueWei: '5000000000000000000000',
        valueDgv: '5000'
      }]
    }, ADDRESS);

    expect(normalized.balanceDgv).toBe('5000.0');
    expect(normalized.transactions[0].valueDgv).toBe('5000.0');
  });

  it.each([
    ['hash', (tx: Record<string, unknown>) => ({ ...tx, hash: '0x1234' }), /hash/],
    ['address', (tx: Record<string, unknown>) => ({ ...tx, from: 'not-an-address' }), /from/],
    ['block', (tx: Record<string, unknown>) => ({ ...tx, blockNumber: '0xzz' }), /blockNumber/],
    ['status', (tx: Record<string, unknown>) => ({ ...tx, status: 2 }), /status/]
  ])('rejects an invalid transaction %s with a field-specific error', (_name, update, error) => {
    const snapshot = makeSnapshot();
    expect(() => validateDigevraSnapshot({
      ...snapshot,
      transactions: [update(snapshot.transactions[0])]
    }, ADDRESS)).toThrow(error);
  });

  it('rejects mismatched fee fields instead of accepting an inconsistent transaction', () => {
    const snapshot = makeSnapshot();
    expect(() => validateDigevraSnapshot({
      ...snapshot,
      transactions: [{
        ...snapshot.transactions[0],
        feeWei: '1'
      }]
    }, ADDRESS)).toThrow(/frais incohérents/);
  });

  it('restores a cached snapshot when the public snapshot endpoint is offline', async () => {
    localStorage.clear();
    const service = new SnapshotService();
    const snapshot = makeSnapshot();
    service.saveLocal(snapshot);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const result = await service.load(ADDRESS);
    expect(result.snapshot?.balanceDgv).toBe('5000.0');
    expect(result.warning).toContain('local');
    expect(service.readLocal(OTHER_ADDRESS)).toBeNull();

    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('loads and caches only the manifest-authorized public snapshot', async () => {
    localStorage.clear();
    const service = new SnapshotService();
    const snapshot = makeSnapshot();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          chainId: 20261019,
          genesisHash: DIGEVRA_GENESIS_HASH,
          addresses: [ADDRESS]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => snapshot
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.load(ADDRESS);
    expect(result.snapshot?.lastBlockNumber).toBe(30698);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.readLocal(ADDRESS)?.address).toBe(ADDRESS);
    expect(service.readLocal(OTHER_ADDRESS)).toBeNull();

    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('prefers the verified snapshot at the greater block height over a newer timestamp', async () => {
    localStorage.clear();
    const service = new SnapshotService();
    const local = {
      ...makeSnapshot(),
      lastBlockNumber: 31462,
      syncedAt: '2026-01-01T00:00:00.000Z'
    };
    const remote = {
      ...makeSnapshot(),
      lastBlockNumber: 30000,
      syncedAt: '2027-01-01T00:00:00.000Z'
    };
    service.saveLocal(local);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          schemaVersion: 1,
          chainId: 20261019,
          genesisHash: DIGEVRA_GENESIS_HASH,
          addresses: [ADDRESS]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => remote
      }));

    const result = await service.load(ADDRESS);
    expect(result.snapshot?.lastBlockNumber).toBe(31462);

    vi.unstubAllGlobals();
    localStorage.clear();
  });
});
