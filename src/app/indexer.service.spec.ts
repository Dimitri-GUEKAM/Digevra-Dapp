import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexerService, resolveIndexerApiBaseUrl } from './indexer.service';

describe('IndexerService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the dev proxy locally but never invents a production indexer URL', () => {
    expect(resolveIndexerApiBaseUrl(undefined, true)).toBe('/api');
    expect(resolveIndexerApiBaseUrl(
      'https://expired-tunnel.example.test/api',
      true
    )).toBe('/api');
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

  it('loads all history pages and removes duplicate transaction hashes', async () => {
    const address = '0x35b4336eF00eD099e030D29f925f2C69FD86b912';
    const transaction = {
      hash: `0x${'a'.repeat(64)}`,
      blockNumber: 10,
      transactionIndex: 0,
      from: '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75',
      to: address,
      valueWei: '1000000000000000000',
      valueDgv: '1.0',
      gasUsed: '21000',
      effectiveGasPriceWei: '1000000000',
      feeWei: '21000000000000',
      feeDgv: '0.000021',
      status: 1 as const,
      timestamp: 1767225600
    };
    const makePage = (offset: number) => ({
      items: [transaction],
      pagination: { limit: 1, offset, total: 2, hasMore: offset === 0 },
      indexer: {
        state: 'ready',
        startBlock: 0,
        lastIndexedBlock: 20,
        chainHead: 20,
        historyComplete: true
      }
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(0)
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(1)
      } as Response);

    const history = await new IndexerService().getCompleteAddressHistory(address);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(history.items).toHaveLength(1);
    expect(history.lastIndexedBlock).toBe(20);
    expect(history.historyComplete).toBe(true);
  });

  it('rejects transactions unrelated to the requested address', async () => {
    const unrelatedPage = {
      items: [{
        hash: `0x${'b'.repeat(64)}`,
        blockNumber: 10,
        transactionIndex: 0,
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        valueWei: '1',
        valueDgv: '0.000000000000000001',
        gasUsed: '21000',
        effectiveGasPriceWei: '1000000000',
        feeWei: '21000000000000',
        feeDgv: '0.000021',
        status: 1,
        timestamp: 1767225600
      }],
      pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      indexer: {
        state: 'ready',
        startBlock: 0,
        lastIndexedBlock: 20,
        chainHead: 20,
        historyComplete: true
      }
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => unrelatedPage
    } as Response);

    await expect(new IndexerService().getCompleteAddressHistory(
      '0x35b4336eF00eD099e030D29f925f2C69FD86b912'
    )).rejects.toThrow('L’indexeur a retourné une transaction d’une autre adresse.');
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
