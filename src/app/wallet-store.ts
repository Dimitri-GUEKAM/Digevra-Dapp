import { getAddress, isAddress } from 'ethers';

export type ManagedWalletKind = 'primary' | 'watch' | 'private-key' | 'mnemonic';

export interface StoredWalletAccount {
  id: string;
  name: string;
  address: string;
  kind: ManagedWalletKind;
  encryptedJson?: string;
}

export const WALLET_ACCOUNTS_STORAGE_KEY = 'digevra_wallet_accounts_v1';
export const SELECTED_WALLET_STORAGE_KEY = 'digevra_selected_wallet_v1';
export const PRIMARY_WALLET_ID = 'digevra-primary';

export function readStoredWalletAccounts(storage: Storage): StoredWalletAccount[] {
  const raw = storage.getItem(WALLET_ACCOUNTS_STORAGE_KEY);
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('La liste locale des portefeuilles est illisible; aucune donnée n’a été modifiée.');
  }
  if (!Array.isArray(value)) {
    throw new Error('La liste locale des portefeuilles a un format invalide; aucune donnée n’a été modifiée.');
  }

  const ids = new Set<string>();
  const addresses = new Set<string>();
  return value.map((entry: unknown) => {
    if (!isStoredWalletAccount(entry)) {
      throw new Error('Une entrée du gestionnaire est invalide; aucune donnée n’a été modifiée.');
    }
    const address = getAddress(entry.address);
    if (ids.has(entry.id) || addresses.has(address.toLowerCase())) {
      throw new Error('La liste locale contient des identifiants ou adresses en double.');
    }
    ids.add(entry.id);
    addresses.add(address.toLowerCase());
    return { ...entry, address };
  });
}

export function writeStoredWalletAccounts(
  storage: Storage,
  accounts: StoredWalletAccount[]
): void {
  const serialized = JSON.stringify(accounts);
  storage.setItem(WALLET_ACCOUNTS_STORAGE_KEY, serialized);
}

export function isStoredWalletAccount(value: unknown): value is StoredWalletAccount {
  if (typeof value !== 'object' || value === null) return false;
  const account = value as Partial<StoredWalletAccount>;
  const keys = Object.keys(value);
  if (
    keys.some((key) => !['id', 'name', 'address', 'kind', 'encryptedJson'].includes(key)) ||
    typeof account.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(account.id) ||
    typeof account.name !== 'string' ||
    account.name.trim().length === 0 ||
    account.name.length > 64 ||
    typeof account.address !== 'string' ||
    !isAddress(account.address) ||
    !['primary', 'watch', 'private-key', 'mnemonic'].includes(account.kind ?? '')
  ) {
    return false;
  }
  if (account.kind === 'watch') return account.encryptedJson === undefined;
  if (account.kind === 'primary') {
    return account.encryptedJson === undefined;
  }
  return typeof account.encryptedJson === 'string' &&
    account.encryptedJson.length > 0;
}
