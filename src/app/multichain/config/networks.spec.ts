import { describe, expect, it } from 'vitest';
import { NETWORKS } from '../../network-config';
import { MULTICHAIN_NETWORKS, MULTICHAIN_NETWORK_BY_ID } from './networks';

describe('multichain network configuration', () => {
  it('configures Bitcoin, Ethereum, Solana, BNB and DIGEVRA mainnets', () => {
    expect(MULTICHAIN_NETWORKS.map((network) => network.id)).toEqual([
      'bitcoin',
      'ethereum',
      'solana',
      'bnb-smart-chain',
      'digevra'
    ]);
    expect(MULTICHAIN_NETWORK_BY_ID['ethereum'].chainId).toBe(1);
    expect(MULTICHAIN_NETWORK_BY_ID['bnb-smart-chain'].chainId).toBe(56);
    expect(MULTICHAIN_NETWORK_BY_ID['solana'].networkName).toBe('Solana Mainnet-beta');
    expect(MULTICHAIN_NETWORK_BY_ID['bitcoin'].networkName).toBe('Bitcoin Mainnet');
  });

  it('preserves DIGEVRA chain configuration and its existing genesis identity', () => {
    expect(MULTICHAIN_NETWORK_BY_ID['digevra'].chainId).toBe(20261019);
    expect(MULTICHAIN_NETWORK_BY_ID['digevra'].genesisHash)
      .toBe(NETWORKS['digevra-local'].genesisHash);
    expect(NETWORKS['digevra-local'].chainId).toBe(20261019);
  });

  it('keeps Bitcoin and Solana on non-EVM adapters', () => {
    expect(MULTICHAIN_NETWORK_BY_ID['bitcoin'].adapter).toBe('bitcoin-api');
    expect(MULTICHAIN_NETWORK_BY_ID['solana'].adapter).toBe('solana-rpc');
    expect(MULTICHAIN_NETWORK_BY_ID['ethereum'].adapter).toBe('evm-rpc');
  });
});
