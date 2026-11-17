import { Injectable, isDevMode } from '@angular/core';

export interface IndexedTransaction {
  hash: string;
  blockNumber: number;
  transactionIndex: number;
  from: string;
  to: string;
  valueWei: string;
  valueDgv: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  feeWei: string;
  feeDgv: string;
  status: 0 | 1;
  timestamp: number;
}

export interface IndexedPage<T> {
  items: T[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  indexer: {
    state: 'starting' | 'syncing' | 'ready' | 'degraded';
    startBlock: number;
    lastIndexedBlock: number | null;
    chainHead: number | null;
    historyComplete: boolean;
  };
}

export function resolveIndexerApiBaseUrl(
  configuredUrl: string | undefined,
  developmentMode: boolean
): string {
  const configured = configuredUrl?.trim().replace(/\/+$/, '');
  return configured || (developmentMode ? '/api' : '');
}

const INDEXER_API_BASE_URL = resolveIndexerApiBaseUrl(
  globalThis.DIGEVRA_CONFIG?.indexerApiUrl,
  isDevMode()
);

@Injectable({ providedIn: 'root' })
export class IndexerService {
  async getAddressTransactions(
    address: string,
    limit: number,
    offset: number
  ): Promise<IndexedPage<IndexedTransaction>> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error('Adresse EVM invalide pour la recherche d’historique.');
    }

    return this.getJson(
      `${INDEXER_API_BASE_URL}/address/${encodeURIComponent(address)}/transactions` +
        `?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`
    );
  }

  async getStats<T = Record<string, unknown>>(): Promise<T> {
    return this.getJson(`${INDEXER_API_BASE_URL}/stats`);
  }

  async getBlocks<T = Record<string, unknown>>(
    limit = 25,
    offset = 0
  ): Promise<T> {
    return this.getJson(
      `${INDEXER_API_BASE_URL}/blocks?limit=${encodeURIComponent(String(limit))}` +
        `&offset=${encodeURIComponent(String(offset))}`
    );
  }

  async getTransactions<T = Record<string, unknown>>(
    limit = 25,
    offset = 0,
    address?: string
  ): Promise<T> {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    if (address) query.set('address', address);
    return this.getJson(`${INDEXER_API_BASE_URL}/transactions?${query}`);
  }

  async getBlock<T = Record<string, unknown>>(number: number): Promise<T> {
    return this.getJson(`${INDEXER_API_BASE_URL}/blocks/${encodeURIComponent(String(number))}`);
  }

  async getTransaction<T = Record<string, unknown>>(hash: string): Promise<T> {
    return this.getJson(`${INDEXER_API_BASE_URL}/transactions/${encodeURIComponent(hash)}`);
  }

  async getAddressSummary<T = Record<string, unknown>>(address: string): Promise<T> {
    return this.getJson(`${INDEXER_API_BASE_URL}/address/${encodeURIComponent(address)}`);
  }

  private async getJson<T>(url: string): Promise<T> {
    if (!INDEXER_API_BASE_URL) {
      throw new Error(
        'Indexeur indisponible : aucune API HTTPS n’est configurée pour ce déploiement de démonstration.'
      );
    }

    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: 'application/json' } });
    } catch {
      throw new Error('Indexeur indisponible. Vérifiez le service d’historique.');
    }

    const payload = await response.json().catch(() => null) as
      { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? `Indexeur indisponible (HTTP ${response.status}).`);
    }
    if (payload === null) {
      throw new Error('Réponse invalide du service d’historique.');
    }
    return payload as T;
  }
}
