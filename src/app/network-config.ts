export type NetworkKey = 'digevra-local' | 'ethereum-sepolia';

export interface NetworkConfig {
  key: NetworkKey;
  name: string;
  chainId: number;
  rpcUrl: string;
  rpcRequiresConfiguration: boolean;
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
    name: 'DIGEVRA Local',
    chainId: 20261019,
    rpcUrl: 'http://127.0.0.1:9545',
    rpcRequiresConfiguration: false,
    nativeCurrency: {
      name: 'DGV',
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
    rpcRequiresConfiguration: true,
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