import { formatUnits } from 'ethers';
import { ChainAdapter } from './chain-adapter';
import {
  MultiChainNetworkConfig,
  TokenConfig
} from '../models/network';

const BASE58_ADDRESS = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BECH32_ADDRESS = /^bc1[ac-hj-np-z02-9]{11,71}$/i;

export function isBitcoinMainnetAddress(address: string): boolean {
  const value = address.trim();
  if (!value) return false;
  if (BASE58_ADDRESS.test(value)) return true;
  if (
    value !== value.toLowerCase() &&
    value !== value.toUpperCase()
  ) {
    return false;
  }
  return BECH32_ADDRESS.test(value);
}

export class BitcoinApiAdapter implements ChainAdapter {
  constructor(private readonly request: typeof fetch = fetch) {}

  isValidAddress(address: string): boolean {
    return isBitcoinMainnetAddress(address);
  }

  async getNativeBalance(
    network: MultiChainNetworkConfig,
    address: string
  ): Promise<string> {
    if (!this.isValidAddress(address)) {
      throw new Error('Adresse Bitcoin Mainnet invalide.');
    }
    if (!network.apiUrl) {
      throw new Error('API Bitcoin non configurée.');
    }

    const response = await this.request(
      `${network.apiUrl.replace(/\/$/, '')}/address/${encodeURIComponent(address.trim())}`
    );
    if (!response.ok) {
      throw new Error(`API Bitcoin indisponible (HTTP ${response.status}).`);
    }

    const body: unknown = await response.json();
    if (!isAddressSummary(body)) {
      throw new Error('Réponse de solde Bitcoin invalide.');
    }
    const confirmed =
      BigInt(body.chain_stats.funded_txo_sum) -
      BigInt(body.chain_stats.spent_txo_sum);
    const pending =
      BigInt(body.mempool_stats.funded_txo_sum) -
      BigInt(body.mempool_stats.spent_txo_sum);
    return formatUnits(confirmed + pending, network.nativeAsset.decimals);
  }

  async getTokenBalance(
    _network: MultiChainNetworkConfig,
    _address: string,
    token: TokenConfig
  ): Promise<string> {
    throw new Error(
      `Le solde de l’actif ${token.symbol} n’est pas pris en charge par l’API Bitcoin configurée.`
    );
  }
}

function isAddressSummary(value: unknown): value is {
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
  mempool_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return hasStats(candidate['chain_stats']) && hasStats(candidate['mempool_stats']);
}

function hasStats(value: unknown): value is {
  funded_txo_sum: number;
  spent_txo_sum: number;
} {
  if (!value || typeof value !== 'object') return false;
  const stats = value as Record<string, unknown>;
  return Number.isSafeInteger(stats['funded_txo_sum']) &&
    Number.isSafeInteger(stats['spent_txo_sum']);
}
