import { Injectable } from '@angular/core';
import {
  Contract,
  formatEther,
  formatUnits,
   isAddress,
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
    const rpcUrlInput = config.rpcUrl.trim();

    if (!rpcUrlInput) {
      throw new Error(`L’URL RPC de ${config.name} n’est pas configurée.`);
    }

    let rpcUrl: URL;

    try {
      rpcUrl = new URL(rpcUrlInput);
    } catch {
      throw new Error('URL RPC invalide.');
    }

    if (!['http:', 'https:'].includes(rpcUrl.protocol)) {
      throw new Error('Le protocole RPC doit être HTTP ou HTTPS.');
    }

    if (
      rpcUrl.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(rpcUrl.hostname)
    ) {
      throw new Error('Une connexion RPC distante doit utiliser HTTPS.');
    }

    const provider = new JsonRpcProvider(rpcUrlInput);

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
    const normalizedTokenAddress = tokenAddress.trim();
    const normalizedAccountAddress = accountAddress.trim();

    if (!isAddress(normalizedTokenAddress)) {
      throw new Error('Adresse du contrat DGV invalide.');
    }

    if (!isAddress(normalizedAccountAddress)) {
      throw new Error('Adresse du portefeuille invalide.');
    }

    const code = await provider.getCode(normalizedTokenAddress);
    if (code === '0x') {
      throw new Error('Le contrat DGV configuré n’est pas déployé sur ce réseau.');
    }

    const contract = new Contract(normalizedTokenAddress, ERC20_ABI, provider);
    const [balance, decimalsRaw, symbol] = await Promise.all([
      contract['balanceOf'](normalizedAccountAddress) as Promise<bigint>,
      contract['decimals']() as Promise<bigint>,
      contract['symbol']() as Promise<string>
    ]);

    const decimals = Number(decimalsRaw);

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
