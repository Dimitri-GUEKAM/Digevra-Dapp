import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MultiChainAssetBalance,
  MultiChainWalletAccount,
  MultiChainNetworkConfig,
  MultiChainNetworkId
} from '../models/network';
import { MultiChainService } from '../services/multichain.service';

const WATCH_ADDRESSES_KEY = 'digevra.multichain.watch-addresses.v1';
const WATCH_ACCOUNTS_KEY = 'digevra_multichain_accounts_v1';

interface WatchAccount {
  id: string;
  walletId: string;
  walletName: string;
  networkId: 'bitcoin' | 'solana';
  networkName: string;
  address: string;
  source: 'watch';
  derivationPath: null;
  keyAvailable: false;
  canSign: false;
}

@Component({
  selector: 'app-multichain-assets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './multichain-assets.component.html',
  styleUrl: './multichain-assets.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MultiChainAssetsComponent implements OnInit, OnChanges {
  @Input() accounts: readonly MultiChainWalletAccount[] = [];
  @Input() selectedWalletId = '';
  @Output() walletSelected = new EventEmitter<string>();

  readonly networks: readonly MultiChainNetworkConfig[];
  readonly balances = new Map<MultiChainNetworkId, MultiChainAssetBalance>();
  readonly selectedAccountIds: Partial<Record<MultiChainNetworkId, string>> = {};
  watchAccounts: WatchAccount[] = [];
  selectedNetworkId: MultiChainNetworkId = 'digevra';
  watchAccountName = '';
  watchAddressInput = '';
  refreshing = false;
  addressMessage = '';
  addressError = '';
  copyMessage = '';
  qrCodeDataUrl = '';
  qrError = '';
  private initialized = false;
  private refreshSequence = 0;

  constructor(
    private readonly multichain: MultiChainService,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.networks = this.multichain.networks;
    for (const network of this.networks) {
      this.balances.set(network.id, {
        networkId: network.id,
        assetName: network.nativeAsset.name,
        symbol: network.nativeAsset.symbol,
        amount: null,
        estimatedValue: null,
        address: null,
        state: 'unavailable',
        updatedAt: null,
        error: null
      });
    }
  }

  ngOnInit(): void {
    this.loadWatchAccounts();
    this.initialized = true;
    void this.refreshBalances();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && (changes['accounts'] || changes['selectedWalletId'])) {
      void this.refreshBalances();
    }
  }

  get allAccounts(): readonly (MultiChainWalletAccount | WatchAccount)[] {
    return [...this.accounts, ...this.watchAccounts];
  }

  get selectedNetwork(): MultiChainNetworkConfig | undefined {
    return this.networks.find((network) => network.id === this.selectedNetworkId);
  }

  get selectedAccount(): MultiChainWalletAccount | WatchAccount | null {
    return this.selectedNetwork
      ? this.accountForNetwork(this.selectedNetwork.id)
      : null;
  }

  balanceFor(id: MultiChainNetworkId): MultiChainAssetBalance {
    const balance = this.balances.get(id);
    if (!balance) throw new Error(`Solde absent pour le réseau ${id}.`);
    return balance;
  }

  selectNetwork(id: MultiChainNetworkId): void {
    this.selectedNetworkId = id;
    this.qrCodeDataUrl = '';
    this.qrError = '';
  }

  addressFor(id: MultiChainNetworkId): string | null {
    return this.accountForNetwork(id)?.address ?? null;
  }

  accountsForNetwork(id: MultiChainNetworkId):
    Array<MultiChainWalletAccount | WatchAccount> {
    return this.allAccounts.filter((account) => account.networkId === id);
  }

  accountForNetwork(id: MultiChainNetworkId):
    MultiChainWalletAccount | WatchAccount | null {
    const accounts = this.accountsForNetwork(id);
    const selectedId = this.selectedAccountIds[id];
    if (selectedId) {
      const selected = accounts.find((account) => account.id === selectedId);
      if (selected) return selected;
    }
    return accounts.find((account) =>
      account.walletId === this.selectedWalletId && account.source !== 'watch'
    ) ?? accounts.find((account) => account.source !== 'watch') ?? accounts[0] ?? null;
  }

  async selectAccount(id: MultiChainNetworkId, accountId: string): Promise<void> {
    const account = this.accountsForNetwork(id).find((item) => item.id === accountId);
    if (!account) {
      this.addressError = 'Compte indisponible sur ce réseau.';
      return;
    }
    this.selectedAccountIds[id] = account.id;
    this.qrCodeDataUrl = '';
    this.qrError = '';
    this.addressError = '';
    if (account.walletId !== this.selectedWalletId) {
      this.walletSelected.emit(account.walletId);
    }
    await this.refreshBalances();
  }

  async saveWatchAccount(): Promise<void> {
    this.addressError = '';
    this.addressMessage = '';
    const address = this.watchAddressInput.trim();
    const name = this.watchAccountName.trim() || 'Compte en lecture seule';
    if (this.selectedNetworkId !== 'bitcoin' && this.selectedNetworkId !== 'solana') {
      this.addressError = 'Les comptes publics Bitcoin et Solana se gèrent séparément; les comptes EVM sont dans Mes portefeuilles.';
      return;
    }
    const network = this.selectedNetwork;
    if (!network) {
      this.addressError = 'Réseau sélectionné introuvable.';
      return;
    }
    if (!this.multichain.isValidAddress(this.selectedNetworkId, address)) {
      this.addressError = `Adresse ${network.name} invalide.`;
      return;
    }

    try {
      const existing = this.watchAccounts.filter((account) =>
        account.networkId !== this.selectedNetworkId ||
        account.address.toLowerCase() !== address.toLowerCase()
      );
      const account: WatchAccount = {
        id: crypto.randomUUID().replace(/-/g, ''),
        walletId: `watch-${this.selectedNetworkId}-${crypto.randomUUID().replace(/-/g, '')}`,
        walletName: name,
        networkId: this.selectedNetworkId,
        networkName: network.networkName,
        address,
        source: 'watch',
        derivationPath: null,
        keyAvailable: false,
        canSign: false
      };
      const updated = [...existing, account];
      localStorage.setItem(WATCH_ACCOUNTS_KEY, JSON.stringify(updated));
      this.watchAccounts = updated;
      this.watchAddressInput = '';
      this.watchAccountName = '';
      this.selectedAccountIds[this.selectedNetworkId] = account.id;
      this.addressMessage = `Compte ${network.name} ajouté en lecture seule.`;
    } catch {
      this.addressError = 'Impossible d’enregistrer ce compte public sur cet appareil.';
      return;
    }
    await this.refreshBalances();
  }

  async refreshBalances(): Promise<void> {
    const sequence = ++this.refreshSequence;
    this.refreshing = true;
    this.addressError = '';
    const requests = this.networks.map(async (network) => {
      const address = this.addressFor(network.id);
      if (!address) {
        this.updateBalance(network.id, {
          amount: null,
          address: null,
          state: 'unavailable',
          error: 'Adresse publique requise.'
        });
        return;
      }
      if (!this.multichain.hasBalanceEndpoint(network.id)) {
        this.updateBalance(network.id, {
          amount: null,
          address,
          state: 'unavailable',
          error: 'Endpoint RPC/API non configuré.'
        });
        return;
      }
      if (!this.multichain.isValidAddress(network.id, address)) {
        this.updateBalance(network.id, {
          amount: null,
          address,
          state: 'error',
          error: 'Format d’adresse incompatible avec ce réseau.'
        });
        return;
      }

      this.updateBalance(network.id, {
        amount: null,
        address,
        state: 'loading',
        error: null
      });
      try {
        const amount = await this.multichain.getNativeBalance(network.id, address);
        if (sequence !== this.refreshSequence) return;
        this.updateBalance(network.id, {
          amount,
          address,
          state: 'connected',
          updatedAt: new Date(),
          error: null
        });
      } catch (error) {
        if (sequence !== this.refreshSequence) return;
        this.updateBalance(network.id, {
          amount: null,
          address,
          state: 'error',
          error: error instanceof Error ? error.message : 'Lecture du solde impossible.'
        });
      }
    });

    await Promise.all(requests);
    if (sequence === this.refreshSequence) {
      this.refreshing = false;
      this.cdr.markForCheck();
    }
  }

  explorerLink(network: MultiChainNetworkConfig): string | null {
    const address = this.addressFor(network.id);
    if (!address || !network.explorerUrl) return null;
    const suffix = network.id === 'solana' ? '?cluster=mainnet-beta' : '';
    return `${network.explorerUrl}${encodeURIComponent(address)}${suffix}`;
  }

  async copySelectedAddress(): Promise<void> {
    const address = this.selectedAccount?.address;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      this.copyMessage = 'Adresse copiée.';
      this.addressError = '';
    } catch {
      this.copyMessage = '';
      this.addressError = 'Impossible de copier l’adresse sur cet appareil.';
    }
  }

  async generateSelectedQr(): Promise<void> {
    const address = this.selectedAccount?.address;
    if (!address) return;
    this.qrError = '';
    try {
      const qrCode = await import('qrcode');
      this.qrCodeDataUrl = await qrCode.default.toDataURL(address, {
        width: 220,
        margin: 2
      });
    } catch {
      this.qrError = 'Impossible de générer le QR code.';
      this.qrCodeDataUrl = '';
    }
  }

  private loadWatchAccounts(): void {
    try {
      const storedAccounts = localStorage.getItem(WATCH_ACCOUNTS_KEY);
      if (storedAccounts) {
        const parsed: unknown = JSON.parse(storedAccounts);
        if (!Array.isArray(parsed)) {
          throw new Error('La liste de comptes multichaînes est invalide.');
        }
        this.watchAccounts = parsed.map((entry) => this.validateWatchAccount(entry));
      } else {
        this.migrateLegacyWatchAddresses();
      }
    } catch (error) {
      this.addressError = error instanceof Error
        ? error.message
        : 'Impossible de lire les comptes publics enregistrés.';
    }
  }

  private migrateLegacyWatchAddresses(): void {
    const stored = localStorage.getItem(WATCH_ADDRESSES_KEY);
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Les anciennes adresses publiques multichaînes sont illisibles.');
    }
    const record = parsed as Record<string, unknown>;
    const legacy: WatchAccount[] = [];
    for (const networkId of ['bitcoin', 'solana'] as const) {
      const address = record[networkId];
      if (typeof address !== 'string' || !address.trim()) continue;
      if (!this.multichain.isValidAddress(networkId, address)) {
        throw new Error(`L’ancienne adresse ${networkId} est invalide; elle n’a pas été modifiée.`);
      }
      legacy.push({
        id: `legacy-${networkId}`,
        walletId: `watch-${networkId}-legacy`,
        walletName: 'Compte de consultation importé',
        networkId,
        networkName: this.multichain.getNetwork(networkId).networkName,
        address: address.trim(),
        source: 'watch',
        derivationPath: null,
        keyAvailable: false,
        canSign: false
      });
    }
    if (!legacy.length) return;
    localStorage.setItem(WATCH_ACCOUNTS_KEY, JSON.stringify(legacy));
    this.watchAccounts = legacy;
  }

  private validateWatchAccount(value: unknown): WatchAccount {
    if (!value || typeof value !== 'object') {
      throw new Error('Une entrée de compte public est invalide.');
    }
    const entry = value as Record<string, unknown>;
    const networkId = entry['networkId'];
    const address = entry['address'];
    if (
      (networkId !== 'bitcoin' && networkId !== 'solana') ||
      typeof address !== 'string' ||
      !this.multichain.isValidAddress(networkId, address) ||
      typeof entry['id'] !== 'string' ||
      typeof entry['walletId'] !== 'string' ||
      typeof entry['walletName'] !== 'string'
    ) {
      throw new Error('Une entrée de compte public est invalide; aucune donnée n’a été modifiée.');
    }
    return {
      id: entry['id'],
      walletId: entry['walletId'],
      walletName: entry['walletName'],
      networkId,
      networkName: this.multichain.getNetwork(networkId).networkName,
      address,
      source: 'watch',
      derivationPath: null,
      keyAvailable: false,
      canSign: false
    };
  }

  private updateBalance(
    id: MultiChainNetworkId,
    update: Partial<MultiChainAssetBalance>
  ): void {
    const current = this.balanceFor(id);
    this.balances.set(id, { ...current, ...update });
    this.cdr.markForCheck();
  }
}
