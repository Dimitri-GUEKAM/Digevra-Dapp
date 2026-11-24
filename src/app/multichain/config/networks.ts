import { isDevMode } from '@angular/core';
import { DIGEVRA_DEV_RPC_PROXY_PATH, NETWORKS } from '../../network-config';
import {
  MultiChainNetworkConfig,
  MultiChainNetworkId
} from '../models/network';

const noTokens = Object.freeze([]);

function digevraRpcUrl(): string {
  const configuredUrl = NETWORKS['digevra-local'].rpcUrl.trim();
  if (!isDevMode()) return configuredUrl;

  if (typeof window === 'undefined') return DIGEVRA_DEV_RPC_PROXY_PATH;
  return new URL(DIGEVRA_DEV_RPC_PROXY_PATH, window.location.origin).toString();
}

export const MULTICHAIN_NETWORKS: readonly MultiChainNetworkConfig[] = [
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    adapter: 'bitcoin-api',
    addressType: 'bitcoin',
    networkName: 'Bitcoin Mainnet',
    nativeAsset: {
      name: 'Bitcoin',
      symbol: 'BTC',
      decimals: 8,
      logoText: '₿',
      logoColor: '#f7931a'
    },
    rpcUrl: '',
    apiUrl: 'https://blockstream.info/api',
    explorerUrl: 'https://mempool.space/address/',
    tokens: noTokens
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    adapter: 'evm-rpc',
    addressType: 'evm',
    chainId: 1,
    networkName: 'Ethereum Mainnet',
    nativeAsset: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
      logoText: 'Ξ',
      logoColor: '#8295f5'
    },
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerUrl: 'https://etherscan.io/address/',
    tokens: noTokens
  },
  {
    id: 'solana',
    name: 'Solana',
    adapter: 'solana-rpc',
    addressType: 'solana',
    networkName: 'Solana Mainnet-beta',
    nativeAsset: {
      name: 'Solana',
      symbol: 'SOL',
      decimals: 9,
      logoText: '◎',
      logoColor: '#8b5cf6'
    },
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerUrl: 'https://explorer.solana.com/address/',
    tokens: noTokens
  },
  {
    id: 'bnb-smart-chain',
    name: 'BNB Smart Chain',
    adapter: 'evm-rpc',
    addressType: 'evm',
    chainId: 56,
    networkName: 'BNB Smart Chain Mainnet',
    nativeAsset: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
      logoText: 'BNB',
      logoColor: '#f0b90b'
    },
    rpcUrl: 'https://bsc-rpc.publicnode.com',
    explorerUrl: 'https://bscscan.com/address/',
    tokens: noTokens
  },
  {
    id: 'digevra',
    name: 'DIGEVRA',
    adapter: 'evm-rpc',
    addressType: 'evm',
    chainId: 20261019,
    networkName: 'DIGEVRA Chain',
    nativeAsset: {
      name: 'DIGEVRA',
      symbol: 'DGV',
      decimals: 18,
      logoText: 'DGV',
      logoColor: '#a76bea',
      logoUrl: 'digevra-mark.png'
    },
    rpcUrl: digevraRpcUrl(),
    explorerUrl: NETWORKS['digevra-local'].explorerUrl ?? '',
    genesisHash: NETWORKS['digevra-local'].genesisHash,
    tokens: noTokens
  }
];

export const MULTICHAIN_NETWORK_BY_ID: Readonly<
  Record<MultiChainNetworkId, MultiChainNetworkConfig>
> = Object.freeze(
  Object.fromEntries(
    MULTICHAIN_NETWORKS.map((network) => [network.id, network])
  ) as Record<MultiChainNetworkId, MultiChainNetworkConfig>
);
