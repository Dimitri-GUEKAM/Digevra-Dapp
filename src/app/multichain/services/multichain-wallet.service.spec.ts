// @vitest-environment node

import { HDNodeWallet, Wallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import { MultiChainWalletService } from './multichain-wallet.service';

const PUBLIC_BIP39_VECTOR =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('MultiChainWalletService', () => {
  const service = new MultiChainWalletService();

  it('derives standard EVM, Bitcoin BIP84, and Solana addresses from one BIP39 seed', () => {
    const wallet = HDNodeWallet.fromPhrase(PUBLIC_BIP39_VECTOR);
    const accounts = service.deriveAccounts(
      'test-account',
      'Vector wallet',
      wallet
    );

    expect(accounts.map((account) => account.networkId)).toEqual([
      'bitcoin',
      'ethereum',
      'solana',
      'bnb-smart-chain',
      'digevra'
    ]);
    expect(accounts.find((account) => account.networkId === 'bitcoin')).toMatchObject({
      address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      derivationPath: "m/84'/0'/0'/0/0",
      source: 'mnemonic',
      keyAvailable: true
    });
    expect(accounts.find((account) => account.networkId === 'ethereum')?.address)
      .toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(accounts.find((account) => account.networkId === 'bnb-smart-chain')?.address)
      .toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(accounts.find((account) => account.networkId === 'digevra')?.address)
      .toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(accounts.find((account) => account.networkId === 'solana')).toMatchObject({
      address: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
      derivationPath: "m/44'/501'/0'/0'",
      source: 'mnemonic',
      keyAvailable: true
    });
  });

  it('restores the same multichain addresses from an encrypted legacy ethers keystore', async () => {
    const source = HDNodeWallet.fromPhrase(PUBLIC_BIP39_VECTOR);
    const encryptedJson = await source.encrypt('public-vector-password');
    expect(encryptedJson).not.toContain(PUBLIC_BIP39_VECTOR);

    const restored = await Wallet.fromEncryptedJson(
      encryptedJson,
      'public-vector-password'
    );
    if (!('mnemonic' in restored) || !restored.mnemonic) {
      throw new Error('Public test wallet did not restore its encrypted BIP39 metadata.');
    }
    expect(restored.mnemonic.phrase).toBe(PUBLIC_BIP39_VECTOR);
    expect(service.deriveAccounts('restored', 'Restored', restored)).toEqual(
      service.deriveAccounts('source', 'Restored', source).map((account) => ({
        ...account,
        walletId: 'restored',
        walletName: 'Restored',
        id: `restored:${account.networkId}`
      }))
    );
  }, 300_000);

  it('never derives Bitcoin or Solana from an EVM-only private key', () => {
    const privateKeyWallet = new Wallet(
      '0x' + '11'.repeat(32)
    );
    const accounts = service.deriveAccounts(
      'private-key-account',
      'Imported EVM key',
      privateKeyWallet
    );

    expect(accounts.map((account) => account.networkId)).toEqual([
      'ethereum',
      'bnb-smart-chain',
      'digevra'
    ]);
    expect(accounts.every((account) => account.source === 'private-key')).toBe(true);
    expect(accounts.every((account) => account.keyAvailable)).toBe(true);
  });

  it('marks watch-only EVM entries as unable to sign', () => {
    const account = service.createWatchAccount(
      'external-watch',
      'Imported read-only EVM',
      '0x1111111111111111111111111111111111111111'
    );

    expect(account.map((entry) => entry.networkId)).toEqual([
      'ethereum',
      'bnb-smart-chain',
      'digevra'
    ]);
    expect(account.every((entry) => !entry.keyAvailable)).toBe(true);
    expect(account.every((entry) => !entry.canSign)).toBe(true);
  });

  it('uses the account index when deriving another standard address set', () => {
    const accounts = service.deriveAccounts(
      'second',
      'Second account',
      HDNodeWallet.fromPhrase(PUBLIC_BIP39_VECTOR, '', "m/44'/60'/0'/0/1")
    );
    expect(accounts.find((account) => account.networkId === 'bitcoin')?.derivationPath)
      .toBe("m/84'/0'/1'/0/0");
    expect(accounts.find((account) => account.networkId === 'solana')?.derivationPath)
      .toBe("m/44'/501'/1'/0'");
  });
});
