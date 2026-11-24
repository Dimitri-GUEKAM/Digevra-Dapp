export type MultiChainNetworkId =
  | 'bitcoin'
  | 'ethereum'
  | 'solana'
  | 'bnb-smart-chain'
  | 'digevra';

export type MultiChainAddressType = 'bitcoin' | 'solana' | 'evm';
export type MultiChainAdapterType = 'bitcoin-api' | 'solana-rpc' | 'evm-rpc';
export type MultiChainConnectionState =
  | 'idle'
  | 'loading'
  | 'connected'
  | 'error'
  | 'unavailable';

export interface TokenConfig {
  id: string;
  name: string;
  symbol: string;
  address: string;
  decimals: number;
  standard: 'erc20' | 'bep20' | 'spl';
  logoText: string;
}

export interface MultiChainNetworkConfig {
  id: MultiChainNetworkId;
  name: string;
  adapter: MultiChainAdapterType;
  addressType: MultiChainAddressType;
  chainId?: number;
  networkName: string;
  nativeAsset: {
    name: string;
    symbol: string;
    decimals: number;
    logoText: string;
    logoColor: string;
    logoUrl?: string;
  };
  rpcUrl: string;
  apiUrl?: string;
  explorerUrl: string;
  genesisHash?: string;
  tokens: readonly TokenConfig[];
}

export interface MultiChainAssetBalance {
  networkId: MultiChainNetworkId;
  assetName: string;
  symbol: string;
  amount: string | null;
  estimatedValue: string | null;
  address: string | null;
  state: MultiChainConnectionState;
  updatedAt: Date | null;
  error: string | null;
}

export type MultiChainAccountSource = 'mnemonic' | 'private-key' | 'watch';

export interface MultiChainWalletAccount {
  id: string;
  walletId: string;
  walletName: string;
  networkId: MultiChainNetworkId;
  networkName: string;
  address: string;
  source: MultiChainAccountSource;
  derivationPath: string | null;
  keyAvailable: boolean;
  canSign: boolean;
}
