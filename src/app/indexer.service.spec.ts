import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexerService, resolveIndexerApiBaseUrl } from './indexer.service';

describe('IndexerService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the dev proxy locally but never invents a production indexer URL', () => {
    expect(resolveIndexerApiBaseUrl(undefined, true)).toBe('/api');
    expect(resolveIndexerApiBaseUrl(' https://indexer.example.test/api/ ', false))
      .toBe('https://indexer.example.test/api');
    expect(resolveIndexerApiBaseUrl(undefined, false)).toBe('');
  });

  it('requests a validated, paginated address history from the same-origin API', async () => {
    const response = {
      items: [],
      pagination: { limit: 5, offset: 10, total: 15, hasMore: false },
      indexer: {
        state: 'ready',
        startBlock: 0,
        lastIndexedBlock: 200,
        chainHead: 200,
        historyComplete: true
      }
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => response
    } as Response);

    const result = await new IndexerService().getAddressTransactions(
      '0x1111111111111111111111111111111111111111',
      5,
      10
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/address/0x1111111111111111111111111111111111111111/transactions?limit=5&offset=10',
      { headers: { accept: 'application/json' } }
    );
    expect(result.pagination.total).toBe(15);
  });

  it('uses the address history endpoint for the first 10 transactions', async () => {
    const response = {
      items: [],
      pagination: { limit: 10, offset: 0, total: 0, hasMore: false },
      indexer: {
        state: 'ready',
        startBlock: 0,
        lastIndexedBlock: 200,
        chainHead: 200,
        historyComplete: true
      }
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => response
    } as Response);

    const result = await new IndexerService().getAddressTransactions(
      '0x35b4336eF00eD099e030D29f925f2C69FD86b912',
      10,
      0
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/address/0x35b4336eF00eD099e030D29f925f2C69FD86b912/transactions?limit=10&offset=0',
      { headers: { accept: 'application/json' } }
    );
    expect(result).toHaveProperty('items');
    expect(result.items).toEqual([]);
  });

  it('rejects malformed EVM addresses before making a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(new IndexerService().getAddressTransactions('0x123', 10, 0))
      .rejects.toThrow('Adresse EVM invalide');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces indexer and network errors instead of showing an empty history', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Indexer is syncing.' })
    } as Response);
    await expect(new IndexerService().getStats()).rejects.toThrow('Indexer is syncing.');

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(new IndexerService().getStats()).rejects.toThrow('Indexeur indisponible');
  });
});
