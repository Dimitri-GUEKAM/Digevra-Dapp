import { Injectable } from '@angular/core';
import { BitcoinApiAdapter } from '../adapters/bitcoin.adapter';
import { ChainAdapter } from '../adapters/chain-adapter';
import { EvmChainAdapter } from '../adapters/evm.adapter';
import { SolanaRpcAdapter } from '../adapters/solana.adapter';
import {
  MultiChainNetworkConfig,
  MultiChainNetworkId,
  TokenConfig
} from '../models/network';
import {
  MULTICHAIN_NETWORKS,
  MULTICHAIN_NETWORK_BY_ID
} from '../config/networks';

@Injectable({ providedIn: 'root' })
export class MultiChainService {
  readonly networks = MULTICHAIN_NETWORKS;
  private readonly adapters: Record<string, ChainAdapter> = {
    'bitcoin-api': new BitcoinApiAdapter(),
    'evm-rpc': new EvmChainAdapter(),
    'solana-rpc': new SolanaRpcAdapter()
  };

  getNetwork(id: MultiChainNetworkId): MultiChainNetworkConfig {
    return MULTICHAIN_NETWORK_BY_ID[id];
  }

  isValidAddress(id: MultiChainNetworkId, address: string): boolean {
    return this.adapterFor(this.getNetwork(id)).isValidAddress(address);
  }

  hasBalanceEndpoint(id: MultiChainNetworkId): boolean {
    const network = this.getNetwork(id);
    return !!(network.rpcUrl.trim() || network.apiUrl?.trim());
  }

  getNativeBalance(id: MultiChainNetworkId, address: string): Promise<string> {
    const network = this.getNetwork(id);
    return this.adapterFor(network).getNativeBalance(network, address);
  }

  getTokenBalance(
    id: MultiChainNetworkId,
    address: string,
    token: TokenConfig
  ): Promise<string> {
    const network = this.getNetwork(id);
    const adapter = this.adapterFor(network);
    if (!adapter.getTokenBalance) {
      throw new Error(`Les tokens ne sont pas pris en charge sur ${network.name}.`);
    }
    return adapter.getTokenBalance(network, address, token);
  }

  private adapterFor(network: MultiChainNetworkConfig): ChainAdapter {
    const adapter = this.adapters[network.adapter];
    if (!adapter) {
      throw new Error(`Adaptateur indisponible pour ${network.name}.`);
    }
    return adapter;
  }
}
