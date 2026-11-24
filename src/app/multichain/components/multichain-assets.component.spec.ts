import { ChangeDetectorRef } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { MultiChainAssetsComponent } from './multichain-assets.component';
import { MultiChainService } from '../services/multichain.service';
import { MULTICHAIN_NETWORKS } from '../config/networks';
import { MultiChainWalletAccount } from '../models/network';

describe('MultiChainAssetsComponent', () => {
  it('distinguishes confirmed zero balances from RPC errors and missing addresses', async () => {
    const getNativeBalance = vi.fn(async (id: string) => {
      if (id === 'ethereum') return '0.0';
      if (id === 'bnb-smart-chain') throw new Error('RPC rate limited.');
      return '2.5';
    });
    const service = {
      networks: MULTICHAIN_NETWORKS,
      hasBalanceEndpoint: vi.fn().mockReturnValue(true),
      isValidAddress: vi.fn().mockReturnValue(true),
      getNativeBalance
    } as unknown as MultiChainService;
    const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;
    const component = new MultiChainAssetsComponent(service, cdr);
    const evmAddress = '0x1111111111111111111111111111111111111111';
    component.selectedWalletId = 'test-wallet';
    component.accounts = MULTICHAIN_NETWORKS
      .filter((network) => network.addressType === 'evm')
      .map((network): MultiChainWalletAccount => ({
        id: `test-wallet:${network.id}`,
        walletId: 'test-wallet',
        walletName: 'Test wallet',
        networkId: network.id,
        networkName: network.networkName,
        address: evmAddress,
        source: 'private-key',
        derivationPath: null,
        keyAvailable: true,
        canSign: network.id === 'digevra'
      }));
    await component.refreshBalances();

    expect(component.balanceFor('ethereum')).toMatchObject({
      amount: '0.0',
      state: 'connected',
      error: null
    });
    expect(component.balanceFor('bnb-smart-chain')).toMatchObject({
      amount: null,
      state: 'error',
      error: 'RPC rate limited.'
    });
    expect(component.balanceFor('digevra')).toMatchObject({
      amount: '2.5',
      state: 'connected'
    });
    expect(component.balanceFor('bitcoin')).toMatchObject({
      amount: null,
      state: 'unavailable',
      error: 'Adresse publique requise.'
    });
    expect(component.balanceFor('solana')).toMatchObject({
      amount: null,
      state: 'unavailable',
      error: 'Adresse publique requise.'
    });
  });
});
