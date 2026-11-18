import type { ExplorerRouteMode } from '../../explorer/routes.js';
import { isDevMode } from '@angular/core';

export interface DigevraRuntimeConfig {
  deploymentMode: 'demo' | 'live';
  chainId: number;
  rpcUrl: string;
  indexerApiUrl: string;
  publicSnapshotAddresses?: string[];
  dgvUsdIndicativeRate?: number | null;
  walletUrl: string | null;
  explorerUrl: string | null;
}

declare global {
  var DIGEVRA_CONFIG: DigevraRuntimeConfig | undefined;
}

export type NetworkKey = 'digevra-local' | 'ethereum-sepolia';

const runtimeConfig = globalThis.DIGEVRA_CONFIG;
const developmentMode = isDevMode();

function developmentServiceUrl(port: number): string | null {
  if (!developmentMode || typeof window === 'undefined') return null;
  const url = new URL(window.location.origin);
  url.port = String(port);
  url.pathname = '/';
  return url.toString();
}

export function isDemoDeployment(
  config: DigevraRuntimeConfig | undefined,
  isDevelopment: boolean
): boolean {
  return !isDevelopment && (
    config?.deploymentMode !== 'live' ||
    !config?.rpcUrl?.trim() ||
    !config?.indexerApiUrl?.trim()
  );
}

export const DIGEVRA_DEV_RPC_PROXY_PATH = '/besu-rpc';

export interface NetworkConfig {
  key: NetworkKey;
  name: string;
  chainId: number;
  rpcUrl: string;
  genesisHash?: string;
  rpcRequiresConfiguration: boolean;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    verified: boolean;
  };
  explorerUrl: string | null;
  explorerRouteMode: ExplorerRouteMode;
  walletUrl: string | null;
  consensus: string;
  dgvTokenAddress: string | null;
  smartWalletAddress: string | null;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  'digevra-local': {
    key: 'digevra-local',
    name: 'DIGEVRA Local',
    chainId: 20261019,
    genesisHash: '0xb6448c0fac400f410a13813a9757faec163bb41d9a75e454466ba2c3116ed04e',
    rpcUrl: developmentMode
      ? ''
      : runtimeConfig?.rpcUrl?.trim() ?? '',
    rpcRequiresConfiguration: !developmentMode && !runtimeConfig?.rpcUrl?.trim(),
    nativeCurrency: {
      name: 'DGV',
      symbol: 'DGV',
      decimals: 18,
      verified: false
    },
    explorerUrl: developmentMode
      ? developmentServiceUrl(4201)
      : runtimeConfig?.explorerUrl ?? null,
    explorerRouteMode: 'hash',
    walletUrl: developmentMode
      ? developmentServiceUrl(4200)
      : runtimeConfig?.walletUrl ?? null,
    consensus: 'QBFT déclaré (non vérifié)',
    dgvTokenAddress: null,
    smartWalletAddress: '0xf0571df1FB4a56b83aD3962D4167C2cAE32F25d1'
  },

  'ethereum-sepolia': {
    key: 'ethereum-sepolia',
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpcUrl: '',
    rpcRequiresConfiguration: true,
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
      verified: true
    },
    explorerUrl: 'https://sepolia.etherscan.io',
    explorerRouteMode: 'path',
    walletUrl: null,
    consensus: 'Proof of Stake',
    dgvTokenAddress: null,
    smartWalletAddress: null
  }
};


export function setRpcUrl(
  key: NetworkKey,
  rpcUrl: string
): void {
  const config = NETWORKS[key];

  if (!config) {
    throw new Error(`Réseau inconnu : ${key}`);
  }

  config.rpcUrl = rpcUrl.trim();
  config.rpcRequiresConfiguration = !config.rpcUrl;
}

export function isNetworkKey(
  value: string
): value is NetworkKey {
  return Object.prototype.hasOwnProperty.call(NETWORKS, value);
}

export function displayRpcEndpoint(
  rpcUrl: string
): string {
  if (!rpcUrl.trim()) {
    return 'Non configuré';
  }

  try {
    const url = new URL(rpcUrl);

    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return 'URL RPC configurée (format invalide)';
  }
}