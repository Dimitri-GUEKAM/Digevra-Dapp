import { describe, expect, it } from 'vitest';
import {
  PRIMARY_WALLET_ID,
  readStoredWalletAccounts,
  SELECTED_WALLET_STORAGE_KEY,
  WALLET_ACCOUNTS_STORAGE_KEY,
  writeStoredWalletAccounts
} from './wallet-store';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const primary = {
  id: PRIMARY_WALLET_ID,
  name: 'Portefeuille principal',
  address: '0x0000000000000000000000000000000000000001',
  kind: 'primary' as const
};
const watch = {
  id: 'watch-1',
  name: 'Compte de lecture',
  address: '0x0000000000000000000000000000000000000002',
  kind: 'watch' as const
};

describe('wallet-store additive local storage', () => {
  it('keeps new wallet metadata and encrypted keystores in a separate versioned key', () => {
    const storage = new MemoryStorage();
    const originalLegacyVault = '{"version":3,"crypto":"legacy-keystore"}';
    storage.setItem('digevra_vault_v1', originalLegacyVault);

    writeStoredWalletAccounts(storage, [
      primary,
      watch,
      {
        id: 'private-1',
        name: 'Compte chiffré',
        address: '0x0000000000000000000000000000000000000003',
        kind: 'private-key',
        encryptedJson: '{"crypto":"encrypted"}'
      }
    ]);

    const loaded = readStoredWalletAccounts(storage);
    expect(loaded).toHaveLength(3);
    expect(storage.getItem('digevra_vault_v1')).toBe(originalLegacyVault);
    expect(storage.getItem(WALLET_ACCOUNTS_STORAGE_KEY)).toContain('"encryptedJson"');
    expect(storage.getItem(SELECTED_WALLET_STORAGE_KEY)).toBeNull();
  });

  it('does not silently replace malformed storage with an empty list', () => {
    const storage = new MemoryStorage();
    storage.setItem(WALLET_ACCOUNTS_STORAGE_KEY, '{broken');

    expect(() => readStoredWalletAccounts(storage))
      .toThrow(/aucune donnée n’a été modifiée/);
    expect(storage.getItem(WALLET_ACCOUNTS_STORAGE_KEY)).toBe('{broken');
  });

  it('rejects duplicate ids, duplicate addresses, plaintext signer data, and invalid addresses', () => {
    const storage = new MemoryStorage();
    const duplicates = [watch, { ...watch, id: 'watch-2' }];
    storage.setItem(WALLET_ACCOUNTS_STORAGE_KEY, JSON.stringify(duplicates));
    expect(() => readStoredWalletAccounts(storage)).toThrow(/en double/);

    storage.setItem(WALLET_ACCOUNTS_STORAGE_KEY, JSON.stringify([{
      ...watch,
      id: 'watch-2',
      kind: 'private-key',
      privateKey: '0xplaintext'
    }]));
    expect(() => readStoredWalletAccounts(storage)).toThrow(/entrée.*invalide/);

    storage.setItem(WALLET_ACCOUNTS_STORAGE_KEY, JSON.stringify([{
      ...watch,
      id: 'bad-address',
      address: 'not-an-address'
    }]));
    expect(() => readStoredWalletAccounts(storage)).toThrow(/entrée.*invalide/);

    storage.setItem(WALLET_ACCOUNTS_STORAGE_KEY, JSON.stringify([{
      ...watch,
      privateKey: '0xplaintext'
    }]));
    expect(() => readStoredWalletAccounts(storage)).toThrow(/entrée.*invalide/);
  });
});
