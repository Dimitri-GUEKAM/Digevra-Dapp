import { Injectable, isDevMode } from '@angular/core';
import {
  Contract,
  formatEther,
  formatUnits,
   isAddress,
  JsonRpcProvider
} from 'ethers';
import {
  DIGEVRA_DEV_RPC_PROXY_PATH,
  NetworkConfig
} from './network-config';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

export interface VerifiedNetworkConnection {
  provider: JsonRpcProvider;
  chainId: number;
  blockNumber: number;
  genesisHash: string | null;
  smartWalletDeployed: boolean;
}

export interface TokenBalance {
  amount: string;
  symbol: string;
}

export function resolveRpcUrl(
  config: NetworkConfig,
  useDevelopmentProxy = isDevMode(),
  browserOrigin?: string
): string {
  if (useDevelopmentProxy && config.key === 'digevra-local') {
    const origin = browserOrigin ??
      (typeof window !== 'undefined' ? window.location.origin : undefined);
    return origin
      ? new URL(DIGEVRA_DEV_RPC_PROXY_PATH, origin).toString()
      : DIGEVRA_DEV_RPC_PROXY_PATH;
  }

  return config.rpcUrl.trim();
}

export async function readNativeBalance(
  provider: JsonRpcProvider,
  address: string,
  blockTag?: number | string
): Promise<string> {
  if (!isAddress(address)) {
    throw new Error('Adresse du portefeuille invalide.');
  }

  return formatEther(await provider.getBalance(address, blockTag));
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

export function assertExpectedGenesisHash(
  expectedGenesisHash: string,
  actualGenesisHash: string | null | undefined
): void {
  if (
    !actualGenesisHash ||
    actualGenesisHash.toLowerCase() !== expectedGenesisHash.toLowerCase()
  ) {
    throw new Error('Hash genesis inattendu pour le réseau DIGEVRA.');
  }
}

export async function verifyProviderConnection(
  config: NetworkConfig,
  provider: JsonRpcProvider
): Promise<VerifiedNetworkConnection> {
  const network = await provider.getNetwork();
  assertExpectedChainId(config.chainId, network.chainId);
  const [blockNumber, genesisBlock, smartWalletCode] = await Promise.all([
    provider.getBlockNumber(),
    config.genesisHash ? provider.getBlock(0) : Promise.resolve(null),
    config.smartWalletAddress
      ? provider.getCode(config.smartWalletAddress)
      : Promise.resolve('0x')
  ]);
  if (config.genesisHash) {
    assertExpectedGenesisHash(config.genesisHash, genesisBlock?.hash);
  }

  return {
    provider,
    chainId: Number(network.chainId),
    blockNumber,
    genesisHash: genesisBlock?.hash ?? null,
    smartWalletDeployed: smartWalletCode !== '0x'
  };
}

@Injectable({ providedIn: 'root' })
export class NetworkService {
  getNativeBalance(
    provider: JsonRpcProvider,
    address: string,
    blockTag?: number | string
  ): Promise<string> {
    return readNativeBalance(provider, address, blockTag);
  }

  async connect(config: NetworkConfig): Promise<VerifiedNetworkConnection> {
    const rpcUrlInput = resolveRpcUrl(config, isDevMode());

    if (!rpcUrlInput) {
      throw new Error(
        `RPC indisponible : aucun endpoint HTTPS n’est configuré pour ${config.name}.`
      );
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

    const sameOriginDevelopmentProxy = isDevMode() &&
      config.key === 'digevra-local' &&
      typeof window !== 'undefined' &&
      rpcUrl.origin === window.location.origin;
    if (rpcUrl.protocol !== 'https:' && !sameOriginDevelopmentProxy) {
      throw new Error('Une connexion RPC distante doit utiliser HTTPS.');
    }

    const provider = new JsonRpcProvider(rpcUrl.toString());

    try {
      return await verifyProviderConnection(config, provider);
    } catch (error) {
      provider.destroy();
      if (
        error instanceof Error &&
        (error.message.startsWith('Chain ID inattendu') ||
          error.message.startsWith('Hash genesis inattendu'))
      ) {
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
