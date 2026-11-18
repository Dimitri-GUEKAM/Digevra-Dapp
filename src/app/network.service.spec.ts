import { JsonRpcProvider } from 'ethers';
import { isDemoDeployment, NETWORKS } from './network-config';
import {
  readNativeBalance,
  resolveRpcUrl,
  verifyProviderConnection
} from './network.service';
import { vi } from 'vitest';

describe('NetworkService RPC helpers', () => {
  it('keeps sending disabled unless both live HTTPS services are configured', () => {
    expect(isDemoDeployment(undefined, false)).toBe(true);
    expect(isDemoDeployment({
      deploymentMode: 'demo',
      chainId: 20261019,
      rpcUrl: '',
      indexerApiUrl: '',
      walletUrl: null,
      explorerUrl: null
    }, false)).toBe(true);
    expect(isDemoDeployment({
      deploymentMode: 'live',
      chainId: 20261019,
      rpcUrl: 'https://rpc.example.test',
      indexerApiUrl: '',
      walletUrl: null,
      explorerUrl: null
    }, false)).toBe(true);
    expect(isDemoDeployment({
      deploymentMode: 'live',
      chainId: 20261019,
      rpcUrl: 'https://rpc.example.test',
      indexerApiUrl: 'https://indexer.example.test/api',
      walletUrl: null,
      explorerUrl: null
    }, false)).toBe(false);
    expect(isDemoDeployment(undefined, true)).toBe(false);
  });

  it('uses the Angular development proxy only for DIGEVRA Local', () => {
    expect(resolveRpcUrl(
      NETWORKS['digevra-local'],
      true,
      'http://localhost:4200'
    )).toBe('http://localhost:4200/besu-rpc');
    expect(resolveRpcUrl(NETWORKS['digevra-local'], false)).toBe('');
    expect(resolveRpcUrl(NETWORKS['ethereum-sepolia'], true))
      .toBe('');
  });

  it('verifies a successful RPC connection and reads the current block', async () => {
    const provider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 20261019n }),
      getBlockNumber: vi.fn().mockResolvedValue(321),
      getBlock: vi.fn().mockResolvedValue({
        hash: NETWORKS['digevra-local'].genesisHash
      }),
      getCode: vi.fn().mockResolvedValue('0x')
    } as unknown as JsonRpcProvider;

    await expect(
      verifyProviderConnection(NETWORKS['digevra-local'], provider)
    ).resolves.toMatchObject({
      provider,
      chainId: 20261019,
      blockNumber: 321,
      genesisHash: NETWORKS['digevra-local'].genesisHash,
      smartWalletDeployed: false
    });
  });

  it('reports an inaccessible RPC instead of presenting it as connected', async () => {
    const provider = {
      getNetwork: vi.fn().mockRejectedValue(new Error('connection refused'))
    } as unknown as JsonRpcProvider;

    await expect(
      verifyProviderConnection(NETWORKS['digevra-local'], provider)
    ).rejects.toThrow('connection refused');
  });

  it('rejects a provider on the wrong Chain ID', async () => {
    const provider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
      getBlockNumber: vi.fn(),
      getCode: vi.fn()
    } as unknown as JsonRpcProvider;

    await expect(
      verifyProviderConnection(NETWORKS['digevra-local'], provider)
    ).rejects.toThrow('Chain ID inattendu : reçu 1, attendu 20261019.');
    expect(provider.getBlockNumber).not.toHaveBeenCalled();
  });

  it('reads a positive native balance from the provider without rounding', async () => {
    const provider = {
      getBalance: vi.fn().mockResolvedValue(1234567890123456789n)
    } as unknown as JsonRpcProvider;

    await expect(
      readNativeBalance(
        provider,
        '0x1111111111111111111111111111111111111111'
      )
    ).resolves.toBe('1.234567890123456789');
  });

  it('returns a real zero native balance', async () => {
    const provider = {
      getBalance: vi.fn().mockResolvedValue(0n)
    } as unknown as JsonRpcProvider;

    await expect(
      readNativeBalance(
        provider,
        '0x1111111111111111111111111111111111111111'
      )
    ).resolves.toBe('0.0');
  });
});
