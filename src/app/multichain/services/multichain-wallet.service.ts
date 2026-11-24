import { Injectable } from '@angular/core';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, bech32 } from '@scure/base';
import { derivePath } from 'ed25519-hd-key';
import {
  getBytes,
  HDNodeWallet,
  Mnemonic,
  ripemd160,
  sha256,
  Wallet
} from 'ethers';
import {
  MultiChainNetworkId,
  MultiChainWalletAccount
} from '../models/network';
import { MULTICHAIN_NETWORK_BY_ID } from '../config/networks';

const EVM_NETWORKS: readonly MultiChainNetworkId[] = [
  'ethereum',
  'bnb-smart-chain',
  'digevra'
];

@Injectable({ providedIn: 'root' })
export class MultiChainWalletService {
  deriveAccounts(
    walletId: string,
    walletName: string,
    signer: Wallet | HDNodeWallet
  ): MultiChainWalletAccount[] {
    if (!isMnemonicWallet(signer)) {
      return this.evmAccounts(walletId, walletName, signer.address, 'private-key', true);
    }

    const mnemonic = signer.mnemonic.phrase;
    const accountIndex = addressIndexFromPath(signer.path);
    const records: MultiChainWalletAccount[] = [];

    const bitcoinPath = `m/84'/0'/${accountIndex}'/0/0`;
    const bitcoinWallet = HDNodeWallet.fromPhrase(mnemonic, '', bitcoinPath);
    const bitcoinHash = ripemd160(sha256(getBytes(bitcoinWallet.publicKey)));
    const bitcoinAddress = bech32.encode(
      'bc',
      [0, ...bech32.toWords(getBytes(bitcoinHash))]
    );
    records.push(this.account(
      walletId,
      walletName,
      'bitcoin',
      bitcoinAddress,
      'mnemonic',
      bitcoinPath,
      true
    ));

    const evmPath = signer.path;
    for (const networkId of EVM_NETWORKS) {
      records.push(this.account(
        walletId,
        walletName,
        networkId,
        signer.address,
        'mnemonic',
        evmPath,
        true
      ));
    }

    const solanaPath = `m/44'/501'/${accountIndex}'/0'`;
    const seed = Mnemonic.fromPhrase(mnemonic).computeSeed();
    const derived = derivePath(solanaPath, seed.slice(2));
    const solanaPrivateKey = Uint8Array.from(derived.key);
    const solanaPublicKey = ed25519.getPublicKey(solanaPrivateKey);
    solanaPrivateKey.fill(0);
    const solanaAddress = base58.encode(solanaPublicKey);
    records.splice(2, 0, this.account(
      walletId,
      walletName,
      'solana',
      solanaAddress,
      'mnemonic',
      solanaPath,
      true
    ));

    return records;
  }

  createWatchAccount(
    walletId: string,
    walletName: string,
    address: string
  ): MultiChainWalletAccount[] {
    return this.evmAccounts(
      walletId,
      walletName,
      address,
      'watch',
      false
    );
  }

  private evmAccounts(
    walletId: string,
    walletName: string,
    address: string,
    source: 'private-key' | 'watch',
    keyAvailable: boolean
  ): MultiChainWalletAccount[] {
    return EVM_NETWORKS.map((networkId) =>
      this.account(
        walletId,
        walletName,
        networkId,
        address,
        source,
        null,
        keyAvailable
      )
    );
  }

  private account(
    walletId: string,
    walletName: string,
    networkId: MultiChainNetworkId,
    address: string,
    source: MultiChainWalletAccount['source'],
    derivationPath: string | null,
    keyAvailable: boolean
  ): MultiChainWalletAccount {
    return {
      id: `${walletId}:${networkId}`,
      walletId,
      walletName,
      networkId,
      networkName: MULTICHAIN_NETWORK_BY_ID[networkId].networkName,
      address,
      source,
      derivationPath,
      keyAvailable,
      canSign: keyAvailable && networkId === 'digevra'
    };
  }
}

function isMnemonicWallet(
  signer: Wallet | HDNodeWallet
): signer is HDNodeWallet & { mnemonic: Mnemonic } {
  return 'mnemonic' in signer &&
    !!signer.mnemonic?.phrase &&
    'path' in signer &&
    typeof signer.path === 'string';
}

function addressIndexFromPath(path: string | null): number {
  const index = Number(path?.match(/\/(\d+)$/)?.[1] ?? 0);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('Index de dérivation EVM invalide.');
  }
  return index;
}
