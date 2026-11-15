export type NetworkKey = 'digevra-local' | 'ethereum-sepolia';

export interface NetworkConfig {
  key: NetworkKey;
  name: string;
  chainId: number;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    verified: boolean;
  };
  explorerUrl: string | null;
  backendUrl: string | null;
  walletUrl: string | null;
  consensus: string;
  dgvTokenAddress: string | null;
  smartWalletAddress: string | null;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  'digevra-local': {
    key: 'digevra-local',
    name: 'DIGEVRA local',
    chainId: 20261019,
    rpcUrl: 'http://127.0.0.1:9545',
    nativeCurrency: {
      name: 'DGV (nature à confirmer)',
      symbol: 'DGV',
      decimals: 18,
      verified: false
    },
    explorerUrl: 'http://localhost:4201',
    backendUrl: 'http://localhost:3000',
    walletUrl: 'http://localhost:4200',
    consensus: 'QBFT déclaré (non vérifié)',
    dgvTokenAddress: null,
    smartWalletAddress: '0xf0571df1FB4a56b83aD3962D4167C2cAE32F25d1'
  },
  'ethereum-sepolia': {
    key: 'ethereum-sepolia',
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpcUrl: '',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
      verified: true
    },
    explorerUrl: 'https://sepolia.etherscan.io',
    backendUrl: null,
    walletUrl: null,
    consensus: 'Proof of Stake',
    dgvTokenAddress: null,
    smartWalletAddress: null
  }
};

export function isNetworkKey(value: string): value is NetworkKey {
  return value in NETWORKS;
}

export function displayRpcEndpoint(rpcUrl: string): string {
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
