import { Injectable } from '@angular/core';
import {
  Contract,
  formatEther,
  formatUnits,
  JsonRpcProvider
} from 'ethers';
import { NetworkConfig } from './network-config';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

export interface VerifiedNetworkConnection {
  provider: JsonRpcProvider;
  chainId: number;
  blockNumber: number;
  smartWalletDeployed: boolean;
}

export interface TokenBalance {
  amount: string;
  symbol: string;
}

export async function readNativeBalance(
  provider: JsonRpcProvider,
  address: string
): Promise<string> {
  return formatEther(await provider.getBalance(address));
}

export function assertExpectedChainId(
  expectedChainId: number,
  actualChainId: bigint
): void {
  if (actualChainId !== BigInt(expectedChainId)) {
    throw new Error(
      `Chain ID inattendu : reçu ${actualChainId}, attendu ${expectedChainId}.`
    );
  }
}

@Injectable({ providedIn: 'root' })
export class NetworkService {
  getNativeBalance(
    provider: JsonRpcProvider,
    address: string
  ): Promise<string> {
    return readNativeBalance(provider, address);
  }

  async connect(config: NetworkConfig): Promise<VerifiedNetworkConnection> {
    if (!config.rpcUrl.trim()) {
      throw new Error(`L’URL RPC de ${config.name} n’est pas configurée.`);
    }

    const provider = new JsonRpcProvider(config.rpcUrl);

    try {
      const network = await provider.getNetwork();
      assertExpectedChainId(config.chainId, network.chainId);
      const [blockNumber, smartWalletCode] = await Promise.all([
        provider.getBlockNumber(),
        config.smartWalletAddress
          ? provider.getCode(config.smartWalletAddress)
          : Promise.resolve('0x')
      ]);

      return {
        provider,
        chainId: Number(network.chainId),
        blockNumber,
        smartWalletDeployed: smartWalletCode !== '0x'
      };
    } catch (error) {
      provider.destroy();
      if (error instanceof Error && error.message.startsWith('Chain ID inattendu')) {
        throw error;
      }

      throw new Error(
        `Connexion RPC à ${config.name} impossible. Vérifiez le service et sa configuration.`
      );
    }
  }

  async getTokenBalance(
    provider: JsonRpcProvider,
    tokenAddress: string,
    accountAddress: string
  ): Promise<TokenBalance> {
    const code = await provider.getCode(tokenAddress);
    if (code === '0x') {
      throw new Error('Le contrat DGV configuré n’est pas déployé sur ce réseau.');
    }

    const contract = new Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, decimals, symbol] = await Promise.all([
      contract['balanceOf'](accountAddress) as Promise<bigint>,
      contract['decimals']() as Promise<number>,
      contract['symbol']() as Promise<string>
    ]);

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new Error('Le contrat DGV a retourné un nombre de décimales invalide.');
    }

    return {
      amount: formatUnits(balance, decimals),
      symbol
    };
  }

  destroy(provider: JsonRpcProvider): void {
    provider.destroy();
  }
}
