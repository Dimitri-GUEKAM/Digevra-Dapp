import { Contract, formatUnits, isAddress, JsonRpcProvider } from 'ethers';
import { ChainAdapter } from './chain-adapter';
import {
  MultiChainNetworkConfig,
  TokenConfig
} from '../models/network';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)'
];

export class EvmChainAdapter implements ChainAdapter {
  isValidAddress(address: string): boolean {
    return isAddress(address.trim());
  }

  async getNativeBalance(
    network: MultiChainNetworkConfig,
    address: string
  ): Promise<string> {
    this.assertAddress(address);
    this.assertRpc(network);

    const provider = new JsonRpcProvider(network.rpcUrl);
    try {
      const actualNetwork = await provider.getNetwork();
      if (actualNetwork.chainId !== BigInt(network.chainId ?? -1)) {
        throw new Error(
          `Chain ID inattendu : reçu ${actualNetwork.chainId}, attendu ${network.chainId}.`
        );
      }

      if (network.genesisHash) {
        const genesis = await provider.getBlock(0);
        if (
          !genesis?.hash ||
          genesis.hash.toLowerCase() !== network.genesisHash.toLowerCase()
        ) {
          throw new Error('Hash genesis DIGEVRA inattendu.');
        }
      }

      const balance = await provider.getBalance(address.trim());
      return formatUnits(balance, network.nativeAsset.decimals);
    } finally {
      provider.destroy();
    }
  }

  async getTokenBalance(
    network: MultiChainNetworkConfig,
    address: string,
    token: TokenConfig
  ): Promise<string> {
    this.assertAddress(address);
    if (!isAddress(token.address)) {
      throw new Error(`Adresse du contrat ${token.symbol} invalide.`);
    }
    this.assertRpc(network);

    const provider = new JsonRpcProvider(network.rpcUrl);
    try {
      const actualNetwork = await provider.getNetwork();
      if (actualNetwork.chainId !== BigInt(network.chainId ?? -1)) {
        throw new Error(
          `Chain ID inattendu : reçu ${actualNetwork.chainId}, attendu ${network.chainId}.`
        );
      }
      const contract = new Contract(token.address, ERC20_ABI, provider);
      const amount = await contract['balanceOf'](address.trim()) as bigint;
      return formatUnits(amount, token.decimals);
    } finally {
      provider.destroy();
    }
  }

  private assertAddress(address: string): void {
    if (!isAddress(address.trim())) {
      throw new Error('Adresse EVM invalide.');
    }
  }

  private assertRpc(network: MultiChainNetworkConfig): void {
    if (!network.rpcUrl.trim()) {
      throw new Error(`RPC non configuré pour ${network.name}.`);
    }
  }
}
