import {
  ChangeDetectorRef,
  Component,
  isDevMode,
  OnInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MultiChainAssetsComponent } from './multichain/components/multichain-assets.component';
import { MultiChainWalletService } from './multichain/services/multichain-wallet.service';
import { MultiChainWalletAccount } from './multichain/models/network';
import {
  formatEther,
  getAddress,
  keccak256,
  parseEther,
  JsonRpcProvider,
  Wallet,
  isAddress
} from 'ethers';

import { HDNodeWallet } from 'ethers';
import {
  DIGEVRA_DEV_RPC_PROXY_PATH,
  displayRpcEndpoint,
  isNetworkKey,
  NETWORKS,
  isDemoDeployment,
  NetworkKey
} from './network-config';
import {
  assertExpectedChainId,
  assertExpectedGenesisHash,
  NetworkService
} from './network.service';
import { IndexedTransaction, IndexerService } from './indexer.service';
import {
  DigevraSnapshot,
  SnapshotService,
  SnapshotTransaction,
  toIndexedTransactions
} from './snapshot.service';
import { buildExplorerUrl, getExplorerBaseUrl } from '../../explorer/routes.js';
import {
  ManagedWalletKind,
  PRIMARY_WALLET_ID,
  readStoredWalletAccounts,
  SELECTED_WALLET_STORAGE_KEY,
  StoredWalletAccount,
  WALLET_ACCOUNTS_STORAGE_KEY,
  writeStoredWalletAccounts
} from './wallet-store';
import {
  readTrackedTransaction,
  saveTrackedTransaction,
  TrackedTransaction,
  TrackedTransactionStatus
} from './transaction-tracking';

function formatBalanceAmount(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export function formatDgvBalanceDisplay(amount: string): string {
  const [whole, fraction] = amount.split('.');
  if (!/^\d+$/.test(whole)) return amount;
  const groupedWhole = new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0
  }).format(BigInt(whole));
  const normalizedFraction = fraction?.replace(/0+$/, '');
  return normalizedFraction
    ? `${groupedWhole},${normalizedFraction}`
    : groupedWhole;
}

export function formatIndicativeDgvUsd(
  balanceDgv: string,
  rate: number | null | undefined
): string | null {
  if (
    !/^\d+(?:\.\d{1,18})?$/.test(balanceDgv) ||
    typeof rate !== 'number' ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    return null;
  }
  const toRatio = (decimal: string) => {
    const match = decimal.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    if (!match) return null;
    let numerator = BigInt(`${match[1]}${match[2] ?? ''}`);
    let scale = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
    if (scale < 0) {
      numerator *= 10n ** BigInt(-scale);
      scale = 0;
    }
    return { numerator, denominator: 10n ** BigInt(scale) };
  };
  const balance = toRatio(balanceDgv);
  const rateRatio = toRatio(String(rate));
  if (!balance || !rateRatio) return null;
  const numerator = balance.numerator * rateRatio.numerator * 100n;
  const denominator = balance.denominator * rateRatio.denominator;
  const cents = (numerator + denominator / 2n) / denominator;
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, '0');
  return `≈ $${new Intl.NumberFormat('en-US').format(whole)}.${fraction}`;
}

interface PreparedNativeTransfer {
  sender: string;
  recipient: string;
  amount: bigint;
  amountDgv: string;
  senderBalance: bigint;
  senderBalanceDgv: string;
  gasLimit: bigint;
  feePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  isEip1559: boolean;
  estimatedFee: bigint;
  estimatedFeeDgv: string;
  chainId: number;
}

interface ManagedWallet extends StoredWalletAccount {
  balanceDgv: string | null;
  balanceLoading: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MultiChainAssetsComponent
  ],
  templateUrl: './app.html'
})
export class App implements OnInit, OnDestroy {

  activeNetworkKey: NetworkKey = 'digevra-local';
  readonly primaryWalletId = PRIMARY_WALLET_ID;
  chainId: number | null = null;
  rpcConnected = false;
  networkSwitchInProgress = false;
  networkError = '';
  actualChainId: number | null = null;
  smartWalletDeployed = false;
  soldeEth: string | null = null;
  soldeDgvDisplay = '—';
  soldeDgvSymbol = 'DGV';
  soldeDgvMessage = '';
  balanceLoading = false;
  transactionsLoading = false;
  transactionsError = '';
  transactionsState: 'idle' | 'starting' | 'syncing' | 'ready' | 'degraded' = 'idle';
  transactionsHistoryComplete = false;
  transactionsIndexedThrough: number | null = null;
  transactionsStale = false;
  transactionsSyncedAt: string | null = null;
  transactionsTotal = 0;
  transactionsPage = 0;
  readonly transactionsPageSize = 10;
  private transactionsRequestSequence = 0;
  private rpcProvider: JsonRpcProvider | null = null;
  private networkSwitchSequence = 0;

  get activeNetwork() {
    return NETWORKS[this.activeNetworkKey];
  }

  get snapshotVisible(): boolean {
    return this.activeNetworkKey === 'digevra-local' &&
      !!this.adresseWallet &&
      this.snapshot?.address.toLowerCase() === this.adresseWallet.toLowerCase();
  }

  get dgvUsdIndicativeRate(): number | null {
    const rate = globalThis.DIGEVRA_CONFIG?.dgvUsdIndicativeRate;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
      ? rate
      : null;
  }

  get dgvUsdEstimatedValue(): string | null {
    if (this.activeNetworkKey !== 'digevra-local') return null;
    const balance = this.rpcConnected
      ? this.soldeEth
      : this.snapshotVisible
        ? this.snapshot?.balanceDgv ?? null
        : null;
    return balance === null
      ? null
      : formatIndicativeDgvUsd(balance, this.dgvUsdIndicativeRate);
  }

  get soldeDgvPresentation(): string {
    const balance = this.rpcConnected && this.soldeDgvDisplay !== '—'
      ? this.soldeDgvDisplay
      : this.snapshotVisible
        ? this.snapshot?.balanceDgv ?? '—'
        : '—';
    return balance === '—' ? balance : formatDgvBalanceDisplay(balance);
  }

  // Libellé basé sur la configuration effective, pas sur une sélection visuelle.
  get nomReseau(): string {
    return this.activeNetwork.name;
  }

  get consensus(): string {
    return this.activeNetwork.consensus;
  }

  get walletUrl(): string | null {
    return this.activeNetwork.walletUrl;
  }

  get walletOrigin(): string | null {
    return this.walletUrl ? new URL(this.walletUrl).origin : null;
  }

  get explorerUrl(): string {
    return this.activeNetwork.explorerUrl ?? '';
  }

  get selectedWallet(): ManagedWallet | undefined {
    return this.walletAccounts.find((wallet) => wallet.id === this.selectedWalletId);
  }

  get activeWalletReadOnly(): boolean {
    return this.selectedWallet?.kind === 'watch';
  }

  get modeDemonstration(): boolean {
    return isDemoDeployment(globalThis.DIGEVRA_CONFIG, isDevMode());
  }

  get rpcEndpointDisplay(): string {
    if (this.activeNetworkKey === 'digevra-local' && isDevMode()) {
      return `${DIGEVRA_DEV_RPC_PROXY_PATH} → Besu local`;
    }

    return displayRpcEndpoint(this.activeNetwork.rpcUrl);
  }

  get indexerEndpointDisplay(): string {
    if (isDevMode()) {
      return '/api → Indexeur local';
    }

    return displayRpcEndpoint(globalThis.DIGEVRA_CONFIG?.indexerApiUrl ?? '');
  }

  get transactionUnavailableReason(): string {
    if (!this.rpcConnected) {
      return 'Les transactions sont désactivées tant que la connexion RPC n’est pas vérifiée.';
    }

    if (
      this.activeNetworkKey === 'digevra-local' &&
      !this.activeNetwork.dgvTokenAddress &&
      this.activeNetwork.nativeCurrency.symbol === 'DGV' &&
      this.activeNetwork.nativeCurrency.decimals === 18
    ) {
      return '';
    }

    if (this.activeNetwork.dgvTokenAddress) {
      return 'DGV est configuré comme un token ERC-20 sur ce réseau. Le transfert natif direct ne s’applique pas.';
    }

    return 'Le transfert natif DGV n’est disponible que sur DIGEVRA Local.';
  }

  vueActive: 'wallet' | 'activite' | 'parametres' = 'wallet';

  walletConnecte = false;
  consultationMode = false;
  authMode: 'welcome' | 'create' | 'import' | 'unlock' = 'welcome';
  vaultExists = false;
  authPassword = '';
  authConfirm = '';
  authPhrase = '';
  recoveryPhrase = '';
  authError = '';
  authBusy = false;
  vaultUnlocked = false;
  walletManagerOpen = false;
  walletAddOpen = false;
  walletAddType: 'watch' | 'private-key' | 'mnemonic' | null = null;
  walletManagerError = '';
  walletManagerMessage = '';
  walletAccounts: ManagedWallet[] = [];
  multichainAccounts: MultiChainWalletAccount[] = [];
  selectedWalletId = '';
  walletNameInput = '';
  walletAddressInput = '';
  walletPrivateKeyInput = '';
  walletMnemonicInput = '';
  walletVaultPassword = '';
  walletPrivateKeyPreview = '';
  walletMnemonicPreviews: Array<{ index: number; address: string; selected: boolean }> = [];
  walletMnemonicStartIndex = 0;
  editingWalletId = '';
  editingWalletName = '';
  private walletSigners = new Map<string, Wallet | HDNodeWallet>();
  private walletBalanceRequestId = 0;
  recoveryAcknowledged = false;
  private unlockedWallet: Wallet | HDNodeWallet | null = null;
  private readonly vaultKey = 'digevra_vault_v1';


  adresseWallet = '';
  sessionWallet: ReturnType<typeof Wallet.createRandom> | null = null;
  sessionAddress = '';
  soldeDgv = 0;
  soldeMasque = false;
  walletDataError = '';

  transactions: IndexedTransaction[] = [];
  snapshot: DigevraSnapshot | null = null;
  publicSnapshots: DigevraSnapshot[] = [];
  snapshotIsStale = true;
  snapshotWarning = '';

  dernierBloc = 0;
  reseauEnLigne = false;

  panneauTransfert: 'aucun' | 'envoyer' | 'recevoir' = 'aucun';
  adresseDestinataire = '';
  montantEnvoi = 0;
  preparedTransfer: PreparedNativeTransfer | null = null;
  qrCodeDataUrl = '';
  messageCopie = '';
  messageTransaction = '';
  messageNavigation = '';
  transactionEnCours = false;
  dernierHashTransaction = '';
  transactionStatus: 'idle' | 'signing' | 'pending' | 'confirmed' | 'failed' | 'unknown' = 'idle';

  private intervalId: ReturnType<typeof setInterval>;
  private transactionVerificationInProgress = false;
  private navigationMessageTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private signatureRequestTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastSigningActivityAt = 0;
  private readonly signingInactivityTimeoutMs = 30 * 60 * 1000;
  private walletWindow: Window | null = null;
  private demandeTransactionId = '';
  demandeAutorisationSessionId = '';
  sessionAutorisee = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private networkService: NetworkService,
    private indexerService: IndexerService,
    private snapshotService: SnapshotService,
    private multichainWalletService: MultiChainWalletService
  ) {
    this.intervalId = setInterval(() => {
      void this.actualiserDonneesReseau();
      this.verrouillerApresInactiviteSignature();
    }, 15000);
    window.addEventListener('pointerdown', this.marquerActiviteSignature);
    window.addEventListener('keydown', this.marquerActiviteSignature);
    window.addEventListener('touchstart', this.marquerActiviteSignature, { passive: true });
  }

  ngOnInit() {
    void this.changerReseau('digevra-local');
    void this.chargerSnapshotsPublics();
    window.addEventListener(
      'message',
      this.recevoirMessageWallet
    );

    if (window.opener) {
      const walletWindow = window.opener;
      this.walletWindow = walletWindow;
      const walletOrigin = this.walletOrigin;
      if (walletOrigin) {
        walletWindow.postMessage(
          { type: 'DIGEVRA_DAPP_READY' },
          walletOrigin
        );
      }
    }

    this.vaultExists = !!localStorage.getItem(this.vaultKey);
    this.authMode = 'welcome';
    const adresseSauvegardee = localStorage.getItem(
      'digevra_connected_address'
    );

    if (
      adresseSauvegardee &&
      /^0x[a-fA-F0-9]{40}$/.test(adresseSauvegardee)
    ) {
      this.adresseWallet = adresseSauvegardee;
      void this.restaurerSnapshot(adresseSauvegardee);
      this.walletConnecte = false;
      this.consultationMode = true;
      this.sessionAutorisee = false;
      this.sessionWallet = null;
      this.sessionAddress = '';
      this.vaultUnlocked = false;
      this.consultationMode = true;
      this.authMode = 'unlock';
      try {
        const accounts = readStoredWalletAccounts(localStorage);
        this.walletAccounts = accounts.map((account) => ({
          ...account,
          balanceDgv: null,
          balanceLoading: false
        }));
        const selectedId = localStorage.getItem(SELECTED_WALLET_STORAGE_KEY);
        const selected = accounts.find((account) => account.id === selectedId)
          ?? accounts.find((account) => account.address.toLowerCase() === adresseSauvegardee.toLowerCase())
          ?? accounts[0];
        if (selected) {
          this.selectedWalletId = selected.id;
          this.adresseWallet = selected.address;
        }
      } catch {
        this.walletAccounts = [];
        this.selectedWalletId = '';
      }
      void this.chargerWallet();
    }
  }

  private async chargerSnapshotsPublics(): Promise<void> {
    const addresses = globalThis.DIGEVRA_CONFIG?.publicSnapshotAddresses;
    if (!Array.isArray(addresses)) return;

    const authorizedAddresses = [...new Set(
      addresses.filter((address) => isAddress(address)).map((address) => address.toLowerCase())
    )];
    if (!authorizedAddresses.length) return;

    try {
      const results = await Promise.all(authorizedAddresses.map((address) =>
        this.snapshotService.load(address)
      ));
      this.publicSnapshots = results.flatMap((result) =>
        result.snapshot ? [result.snapshot] : []
      );
      this.snapshotWarning = results
        .map((result) => result.warning)
        .filter(Boolean)
        .join(' ');
      if (!this.rpcConnected && this.adresseWallet) {
        const selectedSnapshot = this.publicSnapshots.find((item) =>
          item.address.toLowerCase() === this.adresseWallet.toLowerCase()
        );
        if (selectedSnapshot) this.appliquerSnapshot(selectedSnapshot);
      }
    } catch (error) {
      this.snapshotWarning = error instanceof Error
        ? error.message
        : 'Les snapshots publics DIGEVRA ne peuvent pas être lus.';
    }
    this.cdr.detectChanges();
  }

  private async restaurerSnapshot(address: string): Promise<void> {
    if (this.activeNetworkKey !== 'digevra-local' || !isAddress(address)) return;
    try {
      const result = await this.snapshotService.load(address);
      if (
        this.activeNetworkKey !== 'digevra-local' ||
        address.toLowerCase() !== this.adresseWallet.toLowerCase()
      ) {
        return;
      }
      this.snapshotWarning = result.warning;
      if (result.snapshot) this.appliquerSnapshot(result.snapshot);
    } catch (error) {
      this.snapshotWarning = error instanceof Error
        ? error.message
        : 'Le snapshot local DIGEVRA ne peut pas être lu.';
    }
    this.cdr.detectChanges();
  }

  private appliquerSnapshot(snapshot: DigevraSnapshot): void {
    if (
      this.activeNetworkKey !== 'digevra-local' ||
      !this.adresseWallet ||
      snapshot.address.toLowerCase() !== this.adresseWallet.toLowerCase()
    ) {
      return;
    }
    this.snapshot = snapshot;
    this.snapshotIsStale = true;
    this.soldeEth = snapshot.balanceDgv;
    this.soldeDgv = Number(snapshot.balanceDgv);
    this.soldeDgvDisplay = snapshot.balanceDgv;
    this.soldeDgvSymbol = 'DGV';
    this.soldeDgvMessage = 'Données non actualisées';
    this.transactions = toIndexedTransactions(snapshot);
    this.transactionsLoading = false;
    this.transactionsTotal = snapshot.transactions.length;
    this.transactionsPage = 0;
    this.transactionsState = 'ready';
    this.transactionsHistoryComplete = snapshot.historyComplete;
    this.transactionsIndexedThrough = snapshot.lastBlockNumber;
    this.transactionsStale = true;
    this.transactionsSyncedAt = snapshot.syncedAt;
    this.transactionsError = '';
  }

  private async synchroniserSnapshot(
    address: string,
    provider: JsonRpcProvider
  ): Promise<void> {
    if (this.activeNetworkKey !== 'digevra-local' || !this.rpcConnected) return;
    try {
      const history = await this.indexerService.getCompleteAddressHistory(address);
      if (
        history.lastIndexedBlock > await provider.getBlockNumber() ||
        provider !== this.rpcProvider ||
        address.toLowerCase() !== this.adresseWallet.toLowerCase()
      ) {
        throw new Error('RPC, adresse ou indexeur a changé pendant la synchronisation du snapshot.');
      }

      const [network, genesis, block] = await Promise.all([
        provider.getNetwork(),
        provider.getBlock(0),
        provider.getBlock(history.lastIndexedBlock)
      ]);
      assertExpectedChainId(this.activeNetwork.chainId, network.chainId);
      assertExpectedGenesisHash(
        this.activeNetwork.genesisHash ?? '',
        genesis?.hash
      );
      if (!block || block.number !== history.lastIndexedBlock || !block.hash) {
        throw new Error('Le bloc de fin d’indexation n’a pas pu être vérifié via le RPC.');
      }

      const previousSnapshot = this.snapshotService.readLocal(address);
      if (previousSnapshot && previousSnapshot.lastBlockNumber > history.lastIndexedBlock) {
        const previousBlock = await provider.getBlock(previousSnapshot.lastBlockNumber);
        if (previousBlock?.hash?.toLowerCase() === previousSnapshot.lastBlockHash) {
          return;
        }
      }

      const balanceWei = await provider.getBalance(address, history.lastIndexedBlock);
      const transactions: SnapshotTransaction[] = history.items.map((transaction) => {
        const outgoing = transaction.from?.toLowerCase() === address.toLowerCase();
        const incoming = transaction.to?.toLowerCase() === address.toLowerCase();
        if (!outgoing && !incoming) {
          throw new Error('L’indexeur a retourné une transaction d’une autre adresse.');
        }
        return {
          hash: transaction.hash.toLowerCase(),
          from: transaction.from,
          to: transaction.to,
          chainId: this.activeNetwork.chainId,
          blockNumber: transaction.blockNumber,
          transactionIndex: transaction.transactionIndex,
          direction: outgoing ? 'outgoing' : 'incoming',
          valueWei: transaction.valueWei,
          valueDgv: transaction.valueDgv,
          gasUsed: transaction.gasUsed,
          effectiveGasPriceWei: transaction.effectiveGasPriceWei,
          feeWei: transaction.feeWei,
          feeDgv: transaction.feeDgv,
          status: transaction.status,
          timestamp: transaction.timestamp
        };
      });
      const snapshot: DigevraSnapshot = {
        schemaVersion: 1,
        chainId: 20261019,
        genesisHash: this.activeNetwork.genesisHash ?? '',
        lastBlockNumber: block.number,
        lastBlockHash: block.hash,
        syncedAt: new Date().toISOString(),
        address,
        balanceWei: balanceWei.toString(),
        balanceDgv: formatEther(balanceWei),
        historyComplete: history.historyComplete,
        transactions
      };
      this.snapshotService.saveLocal(snapshot);
      if (
        provider === this.rpcProvider &&
        address.toLowerCase() === this.adresseWallet.toLowerCase()
      ) {
        this.snapshot = snapshot;
        this.snapshotIsStale = false;
        this.snapshotWarning = '';
        this.cdr.detectChanges();
      }
    } catch (error) {
      if (provider === this.rpcProvider && address.toLowerCase() === this.adresseWallet.toLowerCase()) {
        this.snapshotIsStale = true;
        this.snapshotWarning = error instanceof Error
          ? error.message
          : 'La synchronisation du snapshot DIGEVRA a échoué.';
        this.cdr.detectChanges();
      }
    }
  }

  async changerReseau(networkKey: string): Promise<void> {
    if (!isNetworkKey(networkKey)) {
      this.networkError = 'Le réseau sélectionné n’est pas pris en charge.';
      return;
    }

    const requestId = ++this.networkSwitchSequence;
    const config = NETWORKS[networkKey];
    if (networkKey !== this.activeNetworkKey) {
      this.snapshot = null;
      this.snapshotIsStale = true;
      this.snapshotWarning = '';
      this.resetTransactionHistory();
    }
    this.networkSwitchInProgress = true;
    this.networkError = '';
    this.rpcConnected = false;
    this.reseauEnLigne = false;
    this.actualChainId = null;
    this.balanceLoading = false;
    this.soldeDgvDisplay = '—';
    this.walletBalanceRequestId += 1;
    this.walletAccounts = this.walletAccounts.map((account) => ({
      ...account,
      balanceDgv: null,
      balanceLoading: false
    }));
    this.soldeDgvMessage = this.adresseWallet
      ? 'Solde indisponible — réseau déconnecté'
      : '';
    this.cdr.detectChanges();

    try {
      const connection = await this.networkService.connect(config);
      if (requestId !== this.networkSwitchSequence) {
        this.networkService.destroy(connection.provider);
        return;
      }

      const previousProvider = this.rpcProvider;
      this.rpcProvider = connection.provider;
      this.activeNetworkKey = networkKey;
      this.chainId = connection.chainId;
      this.actualChainId = connection.chainId;
      this.dernierBloc = connection.blockNumber;
      this.smartWalletDeployed = connection.smartWalletDeployed;
      this.rpcConnected = true;
      this.reseauEnLigne = true;
      this.networkError = '';
      this.soldeEth = null;
      this.soldeDgv = 0;
      this.soldeDgvDisplay = '—';
      this.soldeDgvMessage = networkKey === 'ethereum-sepolia' &&
        !config.dgvTokenAddress
        ? 'Token DGV non configuré sur ce réseau'
        : '';
      this.soldeDgvSymbol = 'DGV';
      if (networkKey !== 'digevra-local') {
        this.resetTransactionHistory();
      }

      if (previousProvider && previousProvider !== connection.provider) {
        this.networkService.destroy(previousProvider);
      }

      if (this.adresseWallet) {
        await this.chargerWallet();
      }
      if (this.vaultUnlocked) {
        void this.chargerSoldePortefeuilles();
      }
    } catch (error) {
      if (requestId === this.networkSwitchSequence) {
        this.networkError = error instanceof Error
          ? error.message
          : `Impossible de vérifier le réseau ${config.name}.`;
        this.rpcConnected = false;
        this.reseauEnLigne = false;
        this.actualChainId = null;
        this.soldeDgvDisplay = '—';
        this.soldeDgvMessage = this.adresseWallet
          ? 'Solde indisponible — réseau déconnecté'
          : '';
        if (this.activeNetworkKey === 'digevra-local' && this.adresseWallet) {
          await this.restaurerSnapshot(this.adresseWallet);
        }
      }
    } finally {
      if (requestId === this.networkSwitchSequence) {
        this.networkSwitchInProgress = false;
        this.cdr.detectChanges();
      }
    }
  }

  private async actualiserBlocReseau(): Promise<void> {
    if (!this.rpcProvider) {
      return;
    }

    try {
      const [network, blockNumber, genesis] = await Promise.all([
        this.rpcProvider.getNetwork(),
        this.rpcProvider.getBlockNumber(),
        this.activeNetwork.genesisHash
          ? this.rpcProvider.getBlock(0)
          : Promise.resolve(null)
      ]);
      if (network.chainId !== BigInt(this.activeNetwork.chainId)) {
        throw new Error('Le Chain ID RPC ne correspond plus au réseau actif.');
      }
      if (this.activeNetwork.genesisHash) {
        assertExpectedGenesisHash(this.activeNetwork.genesisHash, genesis?.hash);
      }
      this.actualChainId = Number(network.chainId);
      this.dernierBloc = blockNumber;
      this.rpcConnected = true;
      this.reseauEnLigne = true;
      this.networkError = '';
    } catch {
      this.rpcConnected = false;
      this.reseauEnLigne = false;
      this.actualChainId = null;
      this.networkError = `La connexion RPC à ${this.activeNetwork.name} a été perdue.`;
      this.soldeDgvDisplay = '—';
      this.soldeDgvMessage = this.adresseWallet
        ? 'Solde indisponible — réseau déconnecté'
        : '';
      if (this.activeNetworkKey === 'digevra-local' && this.adresseWallet) {
        void this.restaurerSnapshot(this.adresseWallet);
      }
    }
    this.cdr.detectChanges();
  }

  choisirAuth(mode: 'welcome' | 'create' | 'import' | 'unlock') {
    this.authMode = mode;
    this.authError = '';
    this.authPassword = '';
    this.authConfirm = '';
    this.authPhrase = '';
  }

  async creerPortefeuille() {
    if (this.authBusy) return;
    if (this.vaultExists) { this.authError = 'Un coffre existe déjà sur cet appareil. Sauvegardez-le avant de le remplacer.'; return; }
    if (this.authPassword.length < 12 || this.authPassword !== this.authConfirm) {
      this.authError = 'Utilisez au moins 12 caractères et confirmez le mot de passe.'; return;
    }
    this.authBusy = true;
    try {
      const wallet = Wallet.createRandom();
      const encrypted = await wallet.encrypt(this.authPassword);
      localStorage.setItem(this.vaultKey, encrypted);
      this.recoveryPhrase = wallet.mnemonic?.phrase ?? '';
      this.vaultExists = true;
      this.authPassword = this.authConfirm = '';
      this.recoveryAcknowledged = false;
      this.authError = '';
      // Ne pas déverrouiller avant confirmation explicite de sauvegarde.
    } catch { this.authError = 'Création impossible. Vérifiez votre navigateur.'; }
    finally { this.authBusy = false; this.cdr.detectChanges(); }
  }

  confirmerSauvegarde() {
    if (!this.recoveryPhrase || !this.recoveryAcknowledged) return;
    this.recoveryPhrase = '';
    this.choisirAuth('unlock');
  }

  async importerPortefeuille() {
    if (this.authBusy) return;
    if (this.vaultExists) { this.authError = 'Un coffre existe déjà. La restauration écraserait le coffre local : exportez-le et effacez-le manuellement avant import.'; return; }
    if (this.authPassword.length < 12 || this.authPassword !== this.authConfirm) {
      this.authError = 'Mot de passe de 12 caractères minimum et confirmation identique requis.'; return;
    }
    this.authBusy = true;
    try {
      const wallet = Wallet.fromPhrase(this.authPhrase.trim().replace(/\s+/g, ' '));
      const encrypted = await wallet.encrypt(this.authPassword);
      localStorage.setItem(this.vaultKey, encrypted);
      this.vaultExists = true;
      this.authPhrase = this.authPassword = this.authConfirm = '';
      this.choisirAuth('unlock');
    } catch { this.authError = 'Phrase de récupération invalide ou import impossible.'; }
    finally { this.authBusy = false; this.cdr.detectChanges(); }
  }

  async deverrouiller() {
    if (this.authBusy) return;
    const encrypted = localStorage.getItem(this.vaultKey);
    if (!encrypted) { this.authError = 'Aucun portefeuille local. Importez votre phrase.'; return; }
    this.authBusy = true;
    try {
      const wallet = await Wallet.fromEncryptedJson(encrypted, this.authPassword);
      const storedAccounts = readStoredWalletAccounts(localStorage);
      const primaryMetadata = storedAccounts.find(
        (account) => account.id === PRIMARY_WALLET_ID
      );
      if (
        primaryMetadata &&
        (primaryMetadata.kind !== 'primary' ||
          primaryMetadata.address.toLowerCase() !== wallet.address.toLowerCase())
      ) {
        throw new Error('Les métadonnées du portefeuille principal ne correspondent pas au coffre existant.');
      }

      const signers = new Map<string, Wallet | HDNodeWallet>([
        [PRIMARY_WALLET_ID, wallet]
      ]);
      const managedAccounts: ManagedWallet[] = [{
        id: PRIMARY_WALLET_ID,
        name: primaryMetadata?.name ?? 'Portefeuille principal',
        address: wallet.address,
        kind: 'primary',
        balanceDgv: null,
        balanceLoading: false
      }];

      for (const account of storedAccounts) {
        if (account.id === PRIMARY_WALLET_ID) continue;
        if (account.kind === 'primary') {
          throw new Error('Un portefeuille secondaire est incorrectement marqué comme principal.');
        }
        if (managedAccounts.some((item) =>
          item.address.toLowerCase() === account.address.toLowerCase()
        )) {
          throw new Error('La liste locale contient une adresse déjà présente dans le coffre principal.');
        }
        if (account.kind === 'private-key' || account.kind === 'mnemonic') {
          const storedKeystore = account.encryptedJson;
          if (!storedKeystore) {
            throw new Error(`Le keystore chiffré du compte « ${account.name} » est absent.`);
          }
          const signer = await Wallet.fromEncryptedJson(
            storedKeystore,
            this.authPassword
          );
          if (signer.address.toLowerCase() !== account.address.toLowerCase()) {
            throw new Error(`L’adresse dérivée du compte « ${account.name} » ne correspond pas à ses métadonnées.`);
          }
          signers.set(account.id, signer);
        }
        managedAccounts.push({
          ...account,
          balanceDgv: null,
          balanceLoading: false
        });
      }

      const selectedId = localStorage.getItem(SELECTED_WALLET_STORAGE_KEY);
      const selected = managedAccounts.find((account) => account.id === selectedId)
        ?? managedAccounts[0];
      this.walletSigners = signers;
      this.walletAccounts = managedAccounts;
      this.selectedWalletId = selected.id;
      this.unlockedWallet = signers.get(selected.id) ?? null;
      this.mettreAJourComptesMultiChain();
      this.vaultUnlocked = true;
      this.authPassword = '';
      this.authError = '';
      this.walletManagerError = '';
      this.adresseWallet = selected.address;
      this.snapshot = null;
      this.snapshotIsStale = true;
      this.walletConnecte = true;
      this.consultationMode = false;
      this.lastSigningActivityAt = Date.now();
      // La signature via session Smart Wallet externe n'est PAS autorisée ici.
      this.sessionAutorisee = false;
      this.sessionWallet = null;
      this.sessionAddress = '';
      this.resetTransactionHistory();
      this.chargerWallet();
      void this.chargerSoldePortefeuilles();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      const detailedError = [
        'métadonnées',
        'keystore chiffré',
        'entrée',
        'liste locale',
        'portefeuille secondaire'
      ].some((message) => errorMessage.includes(message));
      this.authError = detailedError
        ? errorMessage
        : 'Mot de passe incorrect ou coffre illisible. Le coffre principal n’a pas été modifié.';
      this.walletSigners.clear();
      this.walletAccounts = [];
      this.multichainAccounts = [];
      this.selectedWalletId = '';
      this.unlockedWallet = null;
      this.vaultUnlocked = false;
    }
    finally { this.authBusy = false; this.cdr.detectChanges(); }
  }

  ouvrirGestionnairePortefeuilles(): void {
    if (!this.vaultUnlocked) return;
    this.walletManagerOpen = true;
    this.walletManagerError = '';
    this.walletManagerMessage = '';
    void this.chargerSoldePortefeuilles();
  }

  fermerGestionnairePortefeuilles(): void {
    this.walletManagerOpen = false;
    this.fermerAjoutPortefeuille();
  }

  ouvrirAjoutPortefeuille(kind: 'watch' | 'private-key' | 'mnemonic'): void {
    if (!this.vaultUnlocked) return;
    this.walletAddType = kind;
    this.walletAddOpen = true;
    this.walletManagerError = '';
    this.walletManagerMessage = '';
    this.walletNameInput = '';
    this.walletAddressInput = '';
    this.walletPrivateKeyInput = '';
    this.walletMnemonicInput = '';
    this.walletVaultPassword = '';
    this.walletPrivateKeyPreview = '';
    this.walletMnemonicPreviews = [];
    this.walletMnemonicStartIndex = 0;
  }

  fermerAjoutPortefeuille(): void {
    this.walletAddOpen = false;
    this.walletAddType = null;
    this.walletAddressInput = '';
    this.walletPrivateKeyInput = '';
    this.walletMnemonicInput = '';
    this.walletVaultPassword = '';
    this.walletPrivateKeyPreview = '';
    this.walletMnemonicPreviews = [];
    this.walletMnemonicStartIndex = 0;
  }

  async selectionnerPortefeuille(accountId: string): Promise<void> {
    if (!this.vaultUnlocked || this.transactionEnCours) return;
    const account = this.walletAccounts.find((item) => item.id === accountId);
    if (!account || accountId === this.selectedWalletId) {
      this.walletManagerOpen = false;
      return;
    }

    this.selectedWalletId = account.id;
    this.adresseWallet = account.address;
    this.mettreAJourComptesMultiChain();
    this.snapshot = null;
    this.snapshotIsStale = true;
    this.snapshotWarning = '';
    this.unlockedWallet = this.walletSigners.get(account.id) ?? null;
    this.mettreAJourComptesMultiChain();
    this.sessionWallet = null;
    this.sessionAddress = '';
    this.sessionAutorisee = false;
    this.soldeDgv = 0;
    this.soldeDgvDisplay = '—';
    this.soldeEth = null;
    this.soldeDgvMessage = '';
    this.walletDataError = '';
    this.preparedTransfer = null;
    this.resetTransactionHistory();
    this.walletManagerOpen = false;
    try {
      localStorage.setItem(SELECTED_WALLET_STORAGE_KEY, account.id);
      this.walletManagerMessage = '';
    } catch {
      this.walletManagerError = 'Le compte a été sélectionné pour cette session, mais son choix n’a pas pu être sauvegardé localement.';
    }

    await this.chargerWallet();
    await this.chargerSoldePortefeuilles();
  }

  async chargerSoldePortefeuilles(): Promise<void> {
    if (!this.vaultUnlocked) return;
    const requestId = ++this.walletBalanceRequestId;
    const provider = this.rpcProvider;
    if (!provider || !this.rpcConnected) {
      this.walletAccounts = this.walletAccounts.map((account) => ({
        ...account,
        balanceDgv: null,
        balanceLoading: false
      }));
      this.cdr.detectChanges();
      return;
    }

    const chain = await provider.getNetwork().catch(() => null);
    if (
      requestId !== this.walletBalanceRequestId ||
      provider !== this.rpcProvider ||
      !chain ||
      chain.chainId !== BigInt(this.activeNetwork.chainId)
    ) {
      if (requestId === this.walletBalanceRequestId) {
        this.walletAccounts = this.walletAccounts.map((account) => ({
          ...account,
          balanceDgv: null,
          balanceLoading: false
        }));
        this.cdr.detectChanges();
      }
      return;
    }

    this.walletAccounts = this.walletAccounts.map((account) => ({
      ...account,
      balanceLoading: true
    }));
    this.cdr.detectChanges();
    const accounts = [...this.walletAccounts];
    const balances = await Promise.allSettled(
      accounts.map((account) =>
        this.networkService.getNativeBalance(provider, account.address)
      )
    );
    if (
      requestId !== this.walletBalanceRequestId ||
      provider !== this.rpcProvider
    ) {
      return;
    }

    this.walletAccounts = accounts.map((account, index) => {
      const result = balances[index];
      return {
        ...account,
        balanceDgv: result?.status === 'fulfilled'
          ? formatBalanceAmount(result.value)
          : null,
        balanceLoading: false
      };
    });
    this.cdr.detectChanges();
  }

  async selectionnerPortefeuilleDepuisMultiChain(accountId: string): Promise<void> {
    await this.selectionnerPortefeuille(accountId);
  }

  private mettreAJourComptesMultiChain(): void {
    const accounts: MultiChainWalletAccount[] = [];
    for (const walletAccount of this.walletAccounts) {
      if (walletAccount.kind === 'watch') {
        accounts.push(...this.multichainWalletService.createWatchAccount(
          walletAccount.id,
          walletAccount.name,
          walletAccount.address
        ));
        continue;
      }

      const signer = this.walletSigners.get(walletAccount.id);
      if (!signer) continue;
      accounts.push(...this.multichainWalletService.deriveAccounts(
        walletAccount.id,
        walletAccount.name,
        signer
      ));
    }
    this.multichainAccounts = accounts;
  }

  async copierAdressePortefeuille(account: ManagedWallet): Promise<void> {
    try {
      await navigator.clipboard.writeText(account.address);
      this.walletManagerMessage = `Adresse de « ${account.name} » copiée.`;
      this.walletManagerError = '';
    } catch {
      this.walletManagerError = 'Impossible de copier l’adresse sur cet appareil.';
    }
  }

  commencerRenommagePortefeuille(account: ManagedWallet): void {
    this.editingWalletId = account.id;
    this.editingWalletName = account.name;
    this.walletManagerError = '';
  }

  annulerRenommagePortefeuille(): void {
    this.editingWalletId = '';
    this.editingWalletName = '';
  }

  enregistrerNomPortefeuille(): void {
    const name = this.editingWalletName.trim();
    const account = this.walletAccounts.find(
      (item) => item.id === this.editingWalletId
    );
    if (!account) return;
    if (!name || name.length > 64) {
      this.walletManagerError = 'Le nom doit contenir entre 1 et 64 caractères.';
      return;
    }

    const updated = this.walletAccounts.map((item) =>
      item.id === account.id ? { ...item, name } : item
    );
    if (!this.persistManagedWallets(updated)) return;
    this.walletAccounts = updated;
    this.mettreAJourComptesMultiChain();
    this.annulerRenommagePortefeuille();
    this.walletManagerError = '';
  }

  previsualiserClePrivee(): void {
    try {
      this.walletPrivateKeyPreview = new Wallet(
        this.walletPrivateKeyInput.trim()
      ).address;
      this.walletManagerError = '';
    } catch {
      this.walletPrivateKeyPreview = '';
      this.walletManagerError = 'Clé privée invalide. Elle est vérifiée localement et n’est pas enregistrée.';
    }
  }

  previsualiserPhrase(startIndex = 0): void {
    const phrase = this.walletMnemonicInput.trim().replace(/\s+/g, ' ');
    if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
      this.walletManagerError = 'Index de dérivation invalide.';
      return;
    }
    try {
      this.walletMnemonicStartIndex = startIndex;
      this.walletMnemonicPreviews = Array.from({ length: 5 }, (_, index) => {
        const accountIndex = startIndex + index;
        const wallet = HDNodeWallet.fromPhrase(
          phrase,
          '',
          `m/44'/60'/0'/0/${accountIndex}`
        );
        return {
          index: accountIndex,
          address: wallet.address,
          selected: accountIndex === startIndex
        };
      });
      this.walletManagerError = '';
    } catch {
      this.walletMnemonicPreviews = [];
      this.walletManagerError = 'Phrase invalide. Elle est vérifiée localement et n’est pas enregistrée.';
    }
  }

  async ajouterPortefeuille(): Promise<void> {
    if (!this.vaultUnlocked || !this.walletAddType) return;
    this.walletManagerError = '';
    this.walletManagerMessage = '';
    const name = this.walletNameInput.trim();
    if (!name || name.length > 64) {
      this.walletManagerError = 'Saisissez un nom de 1 à 64 caractères.';
      return;
    }

    try {
      if (this.walletAddType === 'watch') {
        if (!isAddress(this.walletAddressInput.trim())) {
          throw new Error('Adresse publique EVM invalide.');
        }
        const address = getAddress(this.walletAddressInput.trim());
        this.ensureWalletAddressIsNew(address);
        const record: StoredWalletAccount = {
          id: crypto.randomUUID().replace(/-/g, ''),
          name,
          address,
          kind: 'watch'
        };
        await this.enregistrerNouveauxPortefeuilles([{
          account: record,
          signer: null
        }]);
        return;
      }

      const password = this.walletVaultPassword;
      if (password.length < 12) {
        throw new Error('Saisissez le mot de passe du coffre (12 caractères minimum) pour chiffrer le nouveau compte.');
      }
      await this.verifierMotDePasseCoffre(password);

      if (this.walletAddType === 'private-key') {
        const wallet = new Wallet(this.walletPrivateKeyInput.trim());
        this.ensureWalletAddressIsNew(wallet.address);
        const encryptedJson = await wallet.encrypt(password);
        const record: StoredWalletAccount = {
          id: crypto.randomUUID().replace(/-/g, ''),
          name,
          address: wallet.address,
          kind: 'private-key',
          encryptedJson
        };
        await this.enregistrerNouveauxPortefeuilles([{
          account: record,
          signer: wallet
        }]);
        this.walletPrivateKeyInput = '';
        return;
      }

      const phrase = this.walletMnemonicInput.trim().replace(/\s+/g, ' ');
      const selected = this.walletMnemonicPreviews.filter((entry) => entry.selected);
      if (!selected.length) {
        throw new Error('Sélectionnez au moins une adresse dérivée de la phrase.');
      }
      const newAccounts: Array<{
        account: StoredWalletAccount;
        signer: Wallet | HDNodeWallet;
      }> = [];
      for (const entry of selected) {
        const signer = HDNodeWallet.fromPhrase(
          phrase,
          '',
          `m/44'/60'/0'/0/${entry.index}`
        );
        if (signer.address.toLowerCase() !== entry.address.toLowerCase()) {
          throw new Error('Une adresse dérivée a changé; aucun compte n’a été ajouté.');
        }
        this.ensureWalletAddressIsNew(signer.address, newAccounts.map(
          (item) => item.account.address
        ));
        newAccounts.push({
          account: {
            id: crypto.randomUUID().replace(/-/g, ''),
            name: selected.length > 1 ? `${name} ${entry.index + 1}` : name,
            address: signer.address,
            kind: 'mnemonic',
            encryptedJson: await signer.encrypt(password)
          },
          signer
        });
      }
      await this.enregistrerNouveauxPortefeuilles(newAccounts);
      this.walletMnemonicInput = '';
      this.walletMnemonicPreviews = [];
    } catch (error) {
      this.walletManagerError = error instanceof Error
        ? error.message
        : 'Impossible d’ajouter ce portefeuille; les données existantes sont conservées.';
    } finally {
      this.walletVaultPassword = '';
      this.cdr.detectChanges();
    }
  }

  private ensureWalletAddressIsNew(
    address: string,
    pendingAddresses: string[] = []
  ): void {
    const normalized = address.toLowerCase();
    if (
      this.walletAccounts.some((account) =>
        account.address.toLowerCase() === normalized
      ) ||
      pendingAddresses.some((item) => item.toLowerCase() === normalized)
    ) {
      throw new Error('Cette adresse est déjà enregistrée dans le gestionnaire.');
    }
  }

  private async verifierMotDePasseCoffre(password: string): Promise<void> {
    const encryptedPrimary = localStorage.getItem(this.vaultKey);
    if (!encryptedPrimary) {
      throw new Error('Le coffre principal existant est introuvable; aucun compte n’a été ajouté.');
    }
    const primary = await Wallet.fromEncryptedJson(encryptedPrimary, password);
    const expected = this.walletAccounts.find(
      (account) => account.id === PRIMARY_WALLET_ID
    );
    if (!expected || primary.address.toLowerCase() !== expected.address.toLowerCase()) {
      throw new Error('Mot de passe incorrect ou coffre principal incohérent.');
    }
  }

  private async enregistrerNouveauxPortefeuilles(
    additions: Array<{
      account: StoredWalletAccount;
      signer: Wallet | HDNodeWallet | null;
    }>
  ): Promise<void> {
    const updated = [...this.walletAccounts];
    for (const addition of additions) {
      this.ensureWalletAddressIsNew(
        addition.account.address,
        updated.map((account) => account.address)
      );
      updated.push({
        ...addition.account,
        balanceDgv: null,
        balanceLoading: false
      });
    }
    if (!this.persistManagedWallets(updated)) return;

    this.walletAccounts = updated;
    this.mettreAJourComptesMultiChain();
    for (const addition of additions) {
      if (addition.signer) {
        this.walletSigners.set(addition.account.id, addition.signer);
      }
    }
    this.walletManagerMessage = additions.length === 1
      ? 'Portefeuille ajouté et chiffré localement.'
      : `${additions.length} comptes dérivés ajoutés et chiffrés localement.`;
    this.walletManagerError = '';
    this.fermerAjoutPortefeuille();
    await this.selectionnerPortefeuille(additions[0].account.id);
  }

  private persistManagedWallets(accounts: ManagedWallet[]): boolean {
    const stored: StoredWalletAccount[] = accounts.map((account) => ({
      id: account.id,
      name: account.name,
      address: account.address,
      kind: account.kind,
      ...(account.encryptedJson ? { encryptedJson: account.encryptedJson } : {})
    }));
    try {
      const existing = localStorage.getItem(WALLET_ACCOUNTS_STORAGE_KEY);
      const validatedExisting = existing === null
        ? []
        : readStoredWalletAccounts(localStorage);
      const currentPersisted = this.walletAccounts
        .filter((account) =>
          account.id !== PRIMARY_WALLET_ID ||
          validatedExisting.some((entry) => entry.id === PRIMARY_WALLET_ID)
        )
        .map((account) => ({
          id: account.id,
          name: account.name,
          address: account.address,
          kind: account.kind,
          ...(account.encryptedJson ? { encryptedJson: account.encryptedJson } : {})
        }));
      if (JSON.stringify(validatedExisting) !== JSON.stringify(currentPersisted)) {
        throw new Error('La liste locale a changé pendant cette opération; rechargez-la avant de continuer.');
      }
      writeStoredWalletAccounts(localStorage, stored);
      return true;
    } catch (error) {
      this.walletManagerError = error instanceof Error
        ? error.message
        : 'Enregistrement local impossible. Le coffre principal reste inchangé.';
      return false;
    }
  }

  verrouiller() {
    this.unlockedWallet = null;
    this.walletSigners.clear();
    this.multichainAccounts = [];
    this.walletBalanceRequestId += 1;
    this.walletAccounts = [];
    this.selectedWalletId = '';
    this.vaultUnlocked = false;
    this.walletManagerOpen = false;
    this.fermerAjoutPortefeuille();
    this.walletConnecte = false;
    this.adresseWallet = '';
    this.soldeDgv = 0;
    this.soldeDgvDisplay = '—';
    this.soldeEth = null;
    this.sessionWallet = null;
    this.sessionAddress = '';
    this.resetTransactionHistory();
    this.sessionAutorisee = false;
    this.demandeAutorisationSessionId = '';
    this.arreterTimeoutSignature();
    this.authPassword = '';
    this.authConfirm = '';
    this.authPhrase = '';
    this.recoveryPhrase = '';
    this.walletPrivateKeyInput = '';
    this.walletMnemonicInput = '';
    this.walletVaultPassword = '';
    this.walletPrivateKeyPreview = '';
    this.walletMnemonicPreviews = [];
    this.walletMnemonicStartIndex = 0;
    this.fermerTransfert();
    this.choisirAuth('unlock');
  }

  private marquerActiviteSignature = (): void => {
    if (this.vaultUnlocked) {
      this.lastSigningActivityAt = Date.now();
    }
  };

  private verrouillerApresInactiviteSignature(): void {
    if (
      !this.vaultUnlocked ||
      this.lastSigningActivityAt === 0 ||
      Date.now() - this.lastSigningActivityAt < this.signingInactivityTimeoutMs
    ) {
      return;
    }
    this.verrouiller();
  }

  ngOnDestroy() {
    window.removeEventListener(
      'message',
      this.recevoirMessageWallet
    );
    window.removeEventListener('pointerdown', this.marquerActiviteSignature);
    window.removeEventListener('keydown', this.marquerActiviteSignature);
    window.removeEventListener('touchstart', this.marquerActiviteSignature);

    clearInterval(this.intervalId);
    if (this.navigationMessageTimeoutId) {
      clearTimeout(this.navigationMessageTimeoutId);
    }
    this.arreterTimeoutSignature();
    this.sessionWallet = null;
    this.sessionAddress = '';
    this.unlockedWallet = null;
    this.multichainAccounts = [];
    this.authPassword = '';
    this.authConfirm = '';
    this.authPhrase = '';
    this.recoveryPhrase = '';
    this.walletPrivateKeyInput = '';
    this.walletMnemonicInput = '';
    this.walletVaultPassword = '';
    this.walletPrivateKeyPreview = '';
    this.walletMnemonicPreviews = [];
    this.walletMnemonicStartIndex = 0;
    this.rpcProvider?.destroy();
    this.rpcProvider = null;
  }

  recevoirMessageWallet = (
    event: MessageEvent
  ) => {
    if (
      !this.walletOrigin ||
      event.origin !== this.walletOrigin ||
      event.source !== this.walletWindow
    ) {
      return;
    }

    const data = event.data;

    if (!data || typeof data !== 'object') {
      return;
    }

    if (
      typeof data.requestId === 'string' &&
      data.requestId === this.demandeAutorisationSessionId
    ) {
      if (
        data.type === 'DIGEVRA_SESSION_AUTHORIZATION_REQUEST_RECEIVED'
      ) {
        this.messageTransaction =
          'Demande reçue par le Wallet. En attente de votre autorisation...';
        this.cdr.detectChanges();
        return;
      }

      if (
        data.type !== 'DIGEVRA_AUTHORIZE_SESSION_RESULT' ||
        typeof data.authorized !== 'boolean'
      ) {
        return;
      }

      this.sessionAutorisee =
        data.authorized &&
        typeof data.sessionAddress === 'string' &&
        data.sessionAddress.toLowerCase() ===
          this.sessionAddress.toLowerCase();
      this.messageTransaction = this.sessionAutorisee
        ? `Session autorisée : ${this.sessionAddress}. Vérifiez son solde DGV pour le gas avant l’envoi.`
        : 'Autorisation de session refusée ou échouée dans le Wallet.';
      this.demandeAutorisationSessionId = '';
      this.cdr.detectChanges();
      return;
    }

    if (data.type === 'DIGEVRA_WALLET_CONNECTED') {
      const adresse = data.address;

      if (
        typeof adresse !== 'string' ||
        !/^0x[a-fA-F0-9]{40}$/.test(adresse)
      ) {
        return;
      }

      this.connecterAdresse(adresse);

      localStorage.setItem(
        'digevra_connected_address',
        adresse
      );

      return;
    }

    if (
      typeof data.requestId !== 'string' ||
      data.requestId !== this.demandeTransactionId
    ) {
      return;
    }

    if (data.type === 'DIGEVRA_TRANSACTION_REQUEST_RECEIVED') {
      this.arreterTimeoutSignature();
      this.messageTransaction =
        'Demande reçue par le Wallet. En attente de votre autorisation...';
    } else if (data.type === 'DIGEVRA_TRANSACTION_SENT') {
      if (
        typeof data.hash !== 'string' ||
        !/^0x[a-fA-F0-9]{64}$/.test(data.hash)
      ) {
        return;
      }

      this.arreterTimeoutSignature();
      try {
        this.enregistrerTransactionSuivie(data.hash, 'pending');
        this.messageTransaction =
          `Transaction diffusée. Confirmation en attente pour ${data.hash}.`;
        void this.verifierTransactionConfirmee(data.hash);
      } catch (error) {
        this.dernierHashTransaction = data.hash;
        this.transactionStatus = 'unknown';
        this.messageTransaction =
          `Le hash ${data.hash} est conservé en mémoire, mais son suivi local n’a pas pu être enregistré. ` +
          (error instanceof Error ? error.message : 'Stockage indisponible.');
      }
    } else if (data.type === 'DIGEVRA_TRANSACTION_CONFIRMED') {
      if (
        typeof data.hash !== 'string' ||
        !/^0x[a-fA-F0-9]{64}$/.test(data.hash)
      ) {
        return;
      }

      void this.verifierTransactionConfirmee(data.hash);
    } else if (data.type === 'DIGEVRA_TRANSACTION_REJECTED') {
      this.transactionEnCours = false;
      this.demandeTransactionId = '';
      this.arreterTimeoutSignature();
      this.messageTransaction = 'Transaction refusée.';
    } else if (data.type === 'DIGEVRA_TRANSACTION_ERROR') {
      this.transactionEnCours = false;
      this.demandeTransactionId = '';
      this.arreterTimeoutSignature();
      this.transactionStatus = this.dernierHashTransaction ? 'pending' : 'unknown';
      this.messageTransaction = this.dernierHashTransaction
        ? `Le Wallet a signalé une erreur, mais le hash ${this.dernierHashTransaction} est conservé et doit être vérifié sur la chaîne.`
        : 'Le Wallet a signalé une erreur; aucun hash ne permet de vérifier si une transaction a été diffusée.';
    } else {
      return;
    }

    this.cdr.detectChanges();
  };

  ouvrirWallet() {
    const walletUrl = NETWORKS['digevra-local'].walletUrl;
    if (this.activeNetworkKey !== 'digevra-local' || !walletUrl) {
      this.messageTransaction =
        'La connexion à DIGEVRA Wallet externe n’est disponible que sur le réseau DIGEVRA local.';
      return;
    }

    if (
      this.walletWindow &&
      !this.walletWindow.closed
    ) {
      this.walletWindow.focus();
      return;
    }

    this.walletWindow = window.open(
      walletUrl,
      'DIGEVRA-Wallet',
      'width=1200,height=850'
    );
  }

  connecterAdresse(adresse: string) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(adresse)) {
      return;
    }

    if (
      this.walletConnecte &&
      this.adresseWallet.toLowerCase() === adresse.toLowerCase() &&
      this.sessionWallet
    ) {
      this.chargerWallet();
      return;
    }

    this.adresseWallet = adresse;
    this.snapshot = null;
    this.snapshotIsStale = true;
    this.snapshotWarning = '';
    this.walletConnecte = true;
    this.resetTransactionHistory();
    this.creerSessionDapp();

    this.chargerWallet();
  }

  creerSessionDapp() {
    const sessionWallet = Wallet.createRandom();
    this.sessionWallet = sessionWallet;
    this.sessionAddress = sessionWallet.address;
    this.sessionAutorisee = false;

    this.demanderAutorisationSession();
  }

  demanderAutorisationSession() {
    if (
      !this.walletConnecte ||
      !this.sessionWallet ||
      !this.sessionAddress
    ) {
      this.messageTransaction =
        'Aucune session DIGEVRA active.';
      return;
    }

    if (
      !this.walletWindow ||
      this.walletWindow.closed
    ) {
      this.messageTransaction =
        'Ouvrez DIGEVRA Wallet pour autoriser cette session.';
      return;
    }

    const walletOrigin = this.walletOrigin;
    if (!walletOrigin) {
      this.messageTransaction =
        'Aucun Wallet externe n’est configuré pour le réseau actif.';
      return;
    }

    if (this.demandeAutorisationSessionId) {
      return;
    }

    this.demandeAutorisationSessionId = crypto.randomUUID();
    this.walletWindow.postMessage(
      {
        type: 'DIGEVRA_AUTHORIZE_SESSION_REQUEST',
        requestId: this.demandeAutorisationSessionId,
        owner: this.adresseWallet,
        sessionAddress: this.sessionAddress
      },
      walletOrigin
    );
    this.messageTransaction =
      'Confirmez l’autorisation de la session dans DIGEVRA Wallet.';
  }

  deconnecterWallet() {
    if (this.transactionEnCours) {
      return;
    }
    if (this.demandeAutorisationSessionId) {
      this.messageTransaction =
        'Attendez la réponse du Wallet avant de vous déconnecter.';
      return;
    }

    this.walletConnecte = false;
    this.adresseWallet = '';
    this.unlockedWallet = null;
    this.walletSigners.clear();
    this.multichainAccounts = [];
    this.walletBalanceRequestId += 1;
    this.walletAccounts = [];
    this.selectedWalletId = '';
    this.vaultUnlocked = false;
    this.walletManagerOpen = false;
    this.sessionWallet = null;
    this.sessionAddress = '';
    this.sessionAutorisee = false;
    this.demandeAutorisationSessionId = '';
    this.soldeDgv = 0;
    this.soldeDgvDisplay = '—';
    this.soldeEth = null;
    this.transactions = [];
    localStorage.removeItem(
      'digevra_connected_address'
    );

    this.fermerTransfert();
  }

  async ouvrirReception() {
    if (!this.walletConnecte) {
      this.ouvrirWallet();
      return;
    }

    this.panneauTransfert = 'recevoir';
    this.messageCopie = '';
    this.messageTransaction = '';

    try {
      const QRCode = await import('qrcode');
      this.qrCodeDataUrl = await QRCode.default.toDataURL(
        this.adresseWallet,
        {
          width: 240,
          margin: 2
        }
      );
      this.cdr.detectChanges();
    } catch (error) {
      console.error(
        'Erreur génération QR DIGEVRA :',
        error
      );
      this.qrCodeDataUrl = '';
      this.messageTransaction =
        'Impossible de générer le QR code pour cette adresse.';
      this.cdr.detectChanges();
    }
  }

  ouvrirEnvoi() {
    if (!this.walletConnecte) {
      this.ouvrirWallet();
      return;
    }

    if (this.activeWalletReadOnly) {
      this.messageTransaction = 'Ce portefeuille est en lecture seule. Déverrouillez un portefeuille contrôlé pour envoyer des DGV.';
      return;
    }

    this.panneauTransfert = 'envoyer';
    this.messageTransaction = '';
    this.restaurerTransactionSuivie(this.adresseWallet);
    this.preparedTransfer = null;
    if (this.transactionUnavailableReason) {
      this.messageTransaction = this.transactionUnavailableReason;
    }
  }

  invaliderPreparationTransfert() {
    this.preparedTransfer = null;
    this.messageTransaction = '';
  }

  formatDgvWei(amount: bigint): string {
    return formatBalanceAmount(formatEther(amount));
  }

  fermerTransfert() {
    if (this.transactionEnCours) {
      return;
    }

    this.panneauTransfert = 'aucun';
    this.adresseDestinataire = '';
    this.montantEnvoi = 0;
    this.preparedTransfer = null;
    this.messageTransaction = '';
    this.qrCodeDataUrl = '';
    this.messageCopie = '';
    this.demandeTransactionId = '';
  }

  async preparerEnvoi(): Promise<void> {
    if (this.transactionEnCours) {
      return;
    }
    if (this.transactionStatus === 'pending') {
      this.messageTransaction =
        `La transaction ${this.dernierHashTransaction} est encore en attente. Aucun nouvel envoi ne sera préparé.`;
      return;
    }

    this.transactionStatus = 'idle';
    this.preparedTransfer = null;
    if (this.modeDemonstration) {
      this.messageTransaction =
        'Envoi désactivé : un RPC et un indexeur HTTPS doivent être configurés.';
      return;
    }

    if (!isAddress(this.adresseDestinataire)) {
      this.messageTransaction = 'Adresse destinataire invalide.';
      return;
    }

    if (!Number.isFinite(this.montantEnvoi) || this.montantEnvoi <= 0) {
      this.messageTransaction = 'Montant invalide.';
      return;
    }

    if (this.montantEnvoi > 10) {
      this.messageTransaction = 'Maximum autorisé : 10 DGV par transaction.';
      return;
    }

    if (!this.walletConnecte || !this.adresseWallet) {
      this.messageTransaction = 'Le portefeuille doit être connecté.';
      return;
    }

    if (
      !this.unlockedWallet ||
      this.unlockedWallet.address.toLowerCase() !== this.adresseWallet.toLowerCase()
    ) {
      this.messageTransaction =
        'Déverrouillez localement le portefeuille qui détient les DGV. Une clé de session ne peut pas signer pour cette adresse.';
      return;
    }

    if (!this.rpcProvider || !this.rpcConnected) {
      this.messageTransaction =
        'La connexion RPC du réseau actif n’est pas vérifiée.';
      return;
    }

    try {
      this.preparedTransfer = await this.creerPreparationTransfert();
      this.messageTransaction = 'Transfert vérifié. Vérifiez le récapitulatif avant de confirmer.';
    } catch (error) {
      this.messageTransaction = error instanceof Error
        ? error.message
        : 'Impossible de vérifier les prérequis transactionnels.';
    } finally {
      this.cdr.detectChanges();
    }
  }

  private async creerPreparationTransfert(): Promise<PreparedNativeTransfer> {
    const provider = this.rpcProvider;
    if (!provider) {
      throw new Error('Le provider RPC n’est pas disponible pour vérifier le solde.');
    }

    const networkKey = this.activeNetworkKey;
    const config = this.activeNetwork;
    if (
      this.activeNetworkKey !== 'digevra-local' ||
      config.dgvTokenAddress ||
      config.nativeCurrency.symbol !== 'DGV' ||
      config.nativeCurrency.decimals !== 18
    ) {
      throw new Error(
        'Ce parcours envoie uniquement le DGV natif de DIGEVRA Local; un token ERC-20 exige son contrat et son mécanisme de transfert vérifiés.'
      );
    }

    const signer = this.unlockedWallet;
    if (!signer || signer.address.toLowerCase() !== this.adresseWallet.toLowerCase()) {
      throw new Error('La clé déverrouillée ne contrôle pas l’adresse qui détient les DGV.');
    }

    const sender = getAddress(signer.address);
    const recipient = getAddress(this.adresseDestinataire);
    const enteredAmount = this.montantEnvoi;
    if (sender.toLowerCase() === recipient.toLowerCase()) {
      throw new Error('Le destinataire doit être différent de l’expéditeur.');
    }

    let amount: bigint;
    try {
      amount = parseEther(this.montantEnvoi.toString());
    } catch {
      throw new Error('Montant invalide : saisissez au plus 18 décimales.');
    }
    if (amount <= 0n) {
      throw new Error('Le montant doit être supérieur à zéro.');
    }

    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(config.chainId)) {
      this.rpcConnected = false;
      this.actualChainId = null;
      throw new Error('Le Chain ID RPC ne correspond pas au réseau sélectionné.');
    }

    const code = await provider.getCode(sender);
    if (code !== '0x') {
      throw new Error(
        'Cette adresse est un Smart Contract Wallet. Un transfert EOA classique est refusé tant que sa méthode d’exécution et ses autorisations ne sont pas vérifiées.'
      );
    }

    const [senderBalance, feeData, estimatedGas] = await Promise.all([
      provider.getBalance(sender),
      provider.getFeeData(),
      provider.estimateGas({ from: sender, to: recipient, value: amount })
    ]);
    if (
      this.rpcProvider !== provider ||
      this.activeNetworkKey !== networkKey ||
      this.adresseWallet.toLowerCase() !== sender.toLowerCase() ||
      this.unlockedWallet !== signer ||
      !isAddress(this.adresseDestinataire) ||
      getAddress(this.adresseDestinataire) !== recipient ||
      this.montantEnvoi !== enteredAmount
    ) {
      throw new Error('Le portefeuille, le réseau ou le formulaire a changé pendant la vérification.');
    }

    const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (feePerGas === null || feePerGas === undefined || feePerGas <= 0n) {
      throw new Error('Le RPC ne fournit pas de frais de transaction estimables.');
    }
    if (
      feeData.maxFeePerGas != null &&
      (feeData.maxPriorityFeePerGas === null ||
        feeData.maxPriorityFeePerGas === undefined ||
        feeData.maxPriorityFeePerGas <= 0n)
    ) {
      throw new Error('Le RPC ne fournit pas les frais EIP-1559 complets.');
    }

    if (estimatedGas <= 0n) {
      throw new Error('Le RPC a estimé une limite de gas invalide.');
    }

    const gasLimit = (estimatedGas * 120n + 99n) / 100n;
    const estimatedFee = gasLimit * feePerGas;
    if (senderBalance < amount + estimatedFee) {
      throw new Error(
        `Solde DGV insuffisant : ${formatEther(senderBalance)} DGV disponible, ${formatEther(amount + estimatedFee)} DGV requis (montant et frais estimés).`
      );
    }

    return {
      sender,
      recipient,
      amount,
      amountDgv: formatEther(amount),
      senderBalance,
      senderBalanceDgv: formatEther(senderBalance),
      gasLimit,
      feePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
      isEip1559: feeData.maxFeePerGas != null,
      estimatedFee,
      estimatedFeeDgv: formatEther(estimatedFee),
      chainId: Number(network.chainId)
    };
  }

  async confirmerEtEnvoyer(): Promise<void> {
    if (this.modeDemonstration) {
      this.messageTransaction =
        'Envoi désactivé : ce déploiement ne dispose pas de backends blockchain configurés.';
      return;
    }

    if (this.transactionEnCours) return;

    const prepared = this.preparedTransfer;
    const signer = this.unlockedWallet;
    const provider = this.rpcProvider;
    if (!prepared || !signer || !provider || !isAddress(this.adresseWallet)) {
      return;
    }

    let existingTransaction: TrackedTransaction | null;
    try {
      existingTransaction = readTrackedTransaction(
        localStorage,
        this.activeNetwork.chainId,
        this.adresseWallet
      );
    } catch (error) {
      this.transactionStatus = 'unknown';
      this.messageTransaction = error instanceof Error
        ? error.message
        : 'Le statut local d’une transaction ne peut pas être vérifié.';
      return;
    }
    if (existingTransaction?.status === 'pending') {
      this.restaurerTransactionSuivie(this.adresseWallet);
      this.messageTransaction =
        `Une transaction (${existingTransaction.hash}) est toujours en attente de vérification. Aucun nouvel envoi ne sera lancé.`;
      return;
    }

    if (
      signer.address.toLowerCase() !== prepared.sender.toLowerCase() ||
      this.adresseWallet.toLowerCase() !== prepared.sender.toLowerCase()
    ) {
      this.preparedTransfer = null;
      this.messageTransaction = 'Le compte déverrouillé a changé. Vérifiez à nouveau le transfert.';
      return;
    }

    this.transactionEnCours = true;
    this.transactionStatus = 'signing';
    this.messageTransaction = 'Vérification des frais et de l’état du réseau avant signature…';
    let broadcastStarted = false;
    try {
      const current = await this.creerPreparationTransfert();
      if (
        current.sender !== prepared.sender ||
        current.recipient !== prepared.recipient ||
        current.amount !== prepared.amount ||
        current.chainId !== prepared.chainId
      ) {
        this.preparedTransfer = null;
        throw new Error('Le compte, le réseau ou le montant a changé. Vérifiez à nouveau le transfert.');
      }

      if (
        current.estimatedFee !== prepared.estimatedFee ||
        current.senderBalance !== prepared.senderBalance ||
        current.gasLimit !== prepared.gasLimit ||
        current.feePerGas !== prepared.feePerGas ||
        current.maxPriorityFeePerGas !== prepared.maxPriorityFeePerGas ||
        current.isEip1559 !== prepared.isEip1559
      ) {
        this.preparedTransfer = current;
        throw new Error('Les frais ou le solde ont changé. Vérifiez le récapitulatif actualisé et confirmez à nouveau.');
      }

      const transactionRequest = {
        to: current.recipient,
        value: current.amount,
        gasLimit: current.gasLimit,
        nonce: await provider.getTransactionCount(current.sender, 'pending'),
        chainId: BigInt(current.chainId),
        ...(current.isEip1559
          ? {
              maxFeePerGas: current.feePerGas,
              maxPriorityFeePerGas: current.maxPriorityFeePerGas
            }
          : { gasPrice: current.feePerGas })
      };
      const connectedSigner = signer.connect(provider);
      const signedTransaction = await connectedSigner.signTransaction(transactionRequest);
      const signedHash = keccak256(signedTransaction);
      this.enregistrerTransactionSuivie(signedHash, 'pending', current);
      broadcastStarted = true;
      this.transactionStatus = 'pending';
      const response = await provider.broadcastTransaction(signedTransaction);
      if (response.hash.toLowerCase() !== signedHash.toLowerCase()) {
        throw new Error('Le hash retourné par le RPC ne correspond pas à la transaction signée.');
      }

      this.preparedTransfer = null;
      this.messageTransaction =
        `Transaction diffusée. Confirmation en attente pour ${signedHash}.`;
      await this.verifierTransactionConfirmee(signedHash);
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      if (broadcastStarted && this.dernierHashTransaction) {
        this.transactionStatus = 'pending';
        this.messageTransaction =
          `La réponse du RPC a été interrompue après la diffusion. Le hash ${this.dernierHashTransaction} est conservé et son reçu sera revérifié; ne renvoyez pas cette transaction.`;
        await this.verifierTransactionConfirmee(this.dernierHashTransaction);
      } else {
        this.transactionStatus = 'idle';
        this.messageTransaction = errorCode === 'ACTION_REJECTED'
          ? 'Signature refusée. Aucune transaction n’a été diffusée.'
          : error instanceof Error
            ? error.message
            : 'Échec de la vérification ou de la signature. Aucune diffusion n’a été tentée.';
      }
    } finally {
      this.transactionEnCours = false;
      this.cdr.detectChanges();
    }
  }

  private enregistrerTransactionSuivie(
    hash: string,
    status: TrackedTransactionStatus,
    transfer?: PreparedNativeTransfer,
    blockNumber?: number
  ): void {
    const sender = transfer?.sender ?? this.adresseWallet;
    const chainId = transfer?.chainId ?? this.activeNetwork.chainId;
    const existing = readTrackedTransaction(localStorage, chainId, sender);
    if (existing?.status === 'pending' && existing.hash !== hash.toLowerCase()) {
      throw new Error(
        `La transaction ${existing.hash} est encore en attente; elle doit être résolue avant tout nouvel envoi.`
      );
    }
    const record: TrackedTransaction = {
      schemaVersion: 1,
      chainId,
      sender: getAddress(sender),
      recipient: transfer?.recipient ?? existing?.recipient ?? null,
      amountDgv: transfer?.amountDgv ?? existing?.amountDgv ?? null,
      hash: hash.toLowerCase(),
      status,
      updatedAt: new Date().toISOString(),
      ...(blockNumber !== undefined ? { blockNumber } : {})
    };
    saveTrackedTransaction(localStorage, record);
    this.dernierHashTransaction = record.hash;
    this.transactionStatus = status;
  }

  private restaurerTransactionSuivie(address: string): void {
    if (!isAddress(address)) return;
    try {
      const record = readTrackedTransaction(
        localStorage,
        this.activeNetwork.chainId,
        address
      );
      if (!record) return;
      this.dernierHashTransaction = record.hash;
      this.transactionStatus = record.status;
      if (record.status === 'confirmed') {
        this.messageTransaction = 'Transaction envoyée avec succès !';
      } else if (record.status === 'failed') {
        this.messageTransaction =
          `La transaction ${record.hash} a été incluse mais exécutée en échec.`;
      } else {
        this.messageTransaction =
          `Transaction ${record.hash} en attente de confirmation vérifiée.`;
        void this.verifierTransactionConfirmee(record.hash);
      }
    } catch (error) {
      this.transactionStatus = 'unknown';
      this.messageTransaction = error instanceof Error
        ? error.message
        : 'Le suivi local de la transaction est illisible.';
    }
  }

  private async verifierTransactionConfirmee(hash: string): Promise<void> {
    if (this.transactionVerificationInProgress) return;
    this.transactionVerificationInProgress = true;
    this.transactionStatus = 'pending';
    this.dernierHashTransaction = hash;

    let sender = this.adresseWallet;
    let record: TrackedTransaction | null = null;
    try {
      if (!isAddress(sender) || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
        throw new Error('Adresse ou hash invalide pour vérifier la transaction.');
      }
      record = readTrackedTransaction(
        localStorage,
        this.activeNetwork.chainId,
        sender
      );
      if (!record) {
        this.enregistrerTransactionSuivie(hash, 'pending');
        record = readTrackedTransaction(
          localStorage,
          this.activeNetwork.chainId,
          sender
        );
      }
      if (!record || record.hash !== hash.toLowerCase()) {
        throw new Error('Le hash ne correspond pas à la transaction suivie pour ce portefeuille.');
      }
    } catch (error) {
      this.transactionStatus = 'unknown';
      this.messageTransaction = error instanceof Error
        ? error.message
        : 'Le statut local de la transaction ne peut pas être vérifié.';
      this.transactionEnCours = false;
      this.transactionVerificationInProgress = false;
      this.cdr.detectChanges();
      return;
    }

    const provider = this.rpcProvider;
    if (!provider || !this.rpcConnected) {
      this.messageTransaction =
        `Le hash ${hash} est conservé; la confirmation reste en attente car le RPC est indisponible.`;
      this.transactionEnCours = false;
      this.transactionVerificationInProgress = false;
      this.cdr.detectChanges();
      return;
    }

    try {
      const [network, receipt] = await Promise.all([
        provider.getNetwork(),
        provider.getTransactionReceipt(hash)
      ]);
      if (network.chainId !== BigInt(record.chainId)) {
        throw new Error('Le RPC connecté ne correspond pas au réseau de la transaction.');
      }
      if (!receipt) {
        this.transactionStatus = 'pending';
        this.messageTransaction =
          `Transaction ${hash} diffusée; aucun reçu n’est encore disponible. Le suivi reprendra automatiquement. Ne renvoyez pas cette transaction.`;
        return;
      }
      if (
        receipt.hash?.toLowerCase() !== hash.toLowerCase() ||
        !Number.isSafeInteger(receipt.blockNumber) ||
        receipt.blockNumber < 0 ||
        !receipt.blockHash
      ) {
        throw new Error('Le reçu RPC ne correspond pas au hash ou ne contient pas de bloc valide.');
      }
      const canonicalBlock = await provider.getBlock(receipt.blockNumber);
      if (canonicalBlock?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        this.transactionStatus = 'pending';
        this.messageTransaction =
          `Le bloc de la transaction ${hash} n’est pas encore vérifiable comme canonique. Le reçu sera revérifié.`;
        return;
      }

      if (receipt.status === 0) {
        this.enregistrerTransactionSuivie(hash, 'failed', undefined, receipt.blockNumber);
        this.messageTransaction =
          `La transaction ${hash} a été confirmée sur la chaîne, mais son exécution a échoué.`;
        return;
      }
      if (receipt.status !== 1) {
        throw new Error('Le reçu ne contient pas un statut d’exécution vérifiable.');
      }

      this.enregistrerTransactionSuivie(hash, 'confirmed', undefined, receipt.blockNumber);
      this.messageTransaction = 'Transaction envoyée avec succès !';
      this.adresseDestinataire = '';
      this.montantEnvoi = 0;
      this.preparedTransfer = null;
      await this.chargerWallet();
    } catch (error) {
      this.transactionStatus = 'pending';
      this.messageTransaction =
        `Le hash ${hash} est conservé, mais sa confirmation n’est pas vérifiable pour le moment. ` +
        (error instanceof Error ? error.message : 'Le RPC est indisponible.');
    } finally {
      this.transactionEnCours = false;
      this.demandeTransactionId = this.transactionStatus === 'pending'
        ? this.demandeTransactionId
        : '';
      if (this.transactionStatus !== 'pending') this.arreterTimeoutSignature();
      this.transactionVerificationInProgress = false;
      this.cdr.detectChanges();
    }
  }

  demanderSignatureWallet() {
    if (!this.walletConnecte) {
      this.messageTransaction =
        'Connectez d’abord DIGEVRA Wallet.';
      return;
    }
    const walletUrl = this.walletUrl;
    const walletOrigin = this.walletOrigin;
    if (!walletUrl || !walletOrigin) {
      this.messageTransaction =
        'DIGEVRA Wallet n’est pas configuré pour signer sur ce déploiement.';
      return;
    }

    this.transactionEnCours = true;
    this.demandeTransactionId = crypto.randomUUID();
    this.messageTransaction =
      'Ouverture du Wallet...';

    this.walletWindow = window.open(
      walletUrl,
      'DIGEVRA-Wallet',
      'width=1200,height=850'
    );

    if (!this.walletWindow) {
      this.transactionEnCours = false;
      this.demandeTransactionId = '';
      this.messageTransaction =
        'Le navigateur a bloqué l’ouverture de DIGEVRA Wallet. Autorisez les popups.';
      return;
    }

    const requestId = this.demandeTransactionId;
    const walletWindow = this.walletWindow;
    this.signatureRequestTimeoutId = setTimeout(() => {
      if (
        !this.transactionEnCours ||
        this.demandeTransactionId !== requestId
      ) {
        return;
      }

      if (walletWindow.closed) {
        this.transactionEnCours = false;
        this.demandeTransactionId = '';
        this.messageTransaction =
          'DIGEVRA Wallet a été fermé avant de recevoir la demande.';
        this.signatureRequestTimeoutId = null;
        this.cdr.detectChanges();
        return;
      }

      walletWindow.postMessage(
        {
          type: 'DIGEVRA_SIGN_TRANSACTION_REQUEST',
          requestId,
          from: this.adresseWallet,
          to: this.adresseDestinataire,
          amount: this.montantEnvoi
        },
        walletOrigin
      );

      this.messageTransaction =
        'Demande de signature envoyée.';
      walletWindow.focus();

      this.signatureRequestTimeoutId = setTimeout(() => {
        if (
          !this.transactionEnCours ||
          this.demandeTransactionId !== requestId
        ) {
          return;
        }

        this.transactionEnCours = false;
        this.demandeTransactionId = '';
        this.messageTransaction =
          'Le Wallet n’a pas reçu la demande. Vérifiez sa connexion puis réessayez.';
        this.cdr.detectChanges();
        this.signatureRequestTimeoutId = null;
      }, 10000);
      this.cdr.detectChanges();
    }, 1000);
  }

  private arreterTimeoutSignature() {
    if (this.signatureRequestTimeoutId) {
      clearTimeout(this.signatureRequestTimeoutId);
      this.signatureRequestTimeoutId = null;
    }
  }

  async chargerWallet(): Promise<void> {
    if (!this.adresseWallet) {
      return;
    }

    if (this.activeNetworkKey === 'digevra-local') {
      this.restaurerTransactionSuivie(this.adresseWallet);
    }

    if (!this.rpcProvider || !this.rpcConnected) {
      this.balanceLoading = false;
      if (this.activeNetworkKey === 'digevra-local' && isAddress(this.adresseWallet)) {
        await this.restaurerSnapshot(this.adresseWallet);
      } else {
        this.soldeDgvDisplay = '—';
        this.soldeDgvMessage = 'Solde indisponible — réseau déconnecté';
      }
      return;
    }

    if (this.activeNetworkKey === 'ethereum-sepolia') {
      await this.chargerWalletSepolia(
        this.rpcProvider,
        this.adresseWallet,
        this.networkSwitchSequence
      );
      return;
    }

    await this.chargerWalletLocal(
      this.rpcProvider,
      this.adresseWallet,
      this.networkSwitchSequence
    );
  }

  private async chargerWalletLocal(
    provider: JsonRpcProvider,
    address: string,
    requestId: number
  ): Promise<void> {
    this.balanceLoading = true;
    this.soldeDgvDisplay = '—';
    this.soldeDgvSymbol = 'DGV';
    this.soldeDgvMessage = '';

    try {
      if (!isAddress(address)) {
        this.walletDataError = 'Adresse du portefeuille invalide.';
        this.soldeDgvMessage = 'Adresse du portefeuille invalide.';
        return;
      }

      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(this.activeNetwork.chainId)) {
        throw new Error('Le Chain ID RPC ne correspond pas au réseau sélectionné.');
      }

      const nativeBalance = await this.networkService.getNativeBalance(provider, address);
      if (
        requestId !== this.networkSwitchSequence ||
        provider !== this.rpcProvider ||
        address !== this.adresseWallet
      ) {
        return;
      }

      const parsedBalance = Number(nativeBalance);
      this.soldeEth = nativeBalance;
      this.soldeDgv = Number.isFinite(parsedBalance) ? parsedBalance : 0;
      this.soldeDgvDisplay = formatBalanceAmount(nativeBalance);
      this.soldeDgvSymbol = 'DGV';
      this.soldeDgvMessage = '';
      this.actualChainId = Number(network.chainId);
      this.rpcConnected = true;
      this.reseauEnLigne = true;
      this.walletDataError = '';
      void this.chargerHistorique(0);
      void this.synchroniserSnapshot(address, provider);
    } catch {
      if (
        requestId === this.networkSwitchSequence &&
        provider === this.rpcProvider &&
        address === this.adresseWallet
      ) {
        this.walletDataError =
          'Le solde natif DIGEVRA n’a pas pu être vérifié via le RPC.';
        this.soldeEth = null;
        this.soldeDgv = 0;
        this.soldeDgvDisplay = '—';
        this.soldeDgvMessage = 'Solde indisponible — réseau déconnecté';
        this.rpcConnected = false;
        this.reseauEnLigne = false;
        this.actualChainId = null;
        this.networkError = 'La connexion RPC ou le Chain ID DIGEVRA n’a pas pu être vérifié.';
        void this.restaurerSnapshot(address);
      }
    } finally {
      if (
        requestId === this.networkSwitchSequence &&
        provider === this.rpcProvider &&
        address === this.adresseWallet
      ) {
        this.balanceLoading = false;
      }
      this.cdr.detectChanges();
    }
  }

  private async chargerWalletSepolia(
    provider: JsonRpcProvider,
    address: string,
    requestId: number
  ): Promise<void> {
    this.balanceLoading = true;
    this.soldeDgvDisplay = '—';

    try {
      const nativeBalance = await this.networkService.getNativeBalance(
        provider,
        address
      );
      if (
        requestId !== this.networkSwitchSequence ||
        provider !== this.rpcProvider ||
        address !== this.adresseWallet
      ) {
        return;
      }

      this.soldeEth = nativeBalance;
      const tokenAddress = this.activeNetwork.dgvTokenAddress;
      if (!tokenAddress) {
        this.soldeDgv = 0;
        this.soldeDgvDisplay = '—';
        this.soldeDgvSymbol = 'DGV';
        this.soldeDgvMessage = 'Token DGV non configuré sur ce réseau';
        this.resetTransactionHistory();
        this.walletDataError = '';
        this.cdr.detectChanges();
        return;
      }

      const tokenBalance = await this.networkService.getTokenBalance(
        provider,
        tokenAddress,
        address
      );
      if (
        requestId !== this.networkSwitchSequence ||
        provider !== this.rpcProvider ||
        address !== this.adresseWallet
      ) {
        return;
      }

      this.soldeDgvDisplay = formatBalanceAmount(tokenBalance.amount);
      this.soldeDgvSymbol = tokenBalance.symbol;
      const numericBalance = Number(tokenBalance.amount);
      this.soldeDgv = Number.isFinite(numericBalance) ? numericBalance : 0;
      this.soldeDgvMessage = '';
      this.resetTransactionHistory();
      this.walletDataError = '';
    } catch {
      if (requestId === this.networkSwitchSequence && provider === this.rpcProvider) {
        this.walletDataError =
          'Les soldes Sepolia n’ont pas pu être vérifiés via le RPC.';
        this.soldeEth = null;
        this.soldeDgvDisplay = '—';
        this.soldeDgvMessage = 'Solde indisponible — réseau déconnecté';
        this.rpcConnected = false;
        this.reseauEnLigne = false;
        this.actualChainId = null;
        this.networkError = 'La connexion RPC à Ethereum Sepolia n’a pas pu être vérifiée.';
      }
    } finally {
      if (requestId === this.networkSwitchSequence && provider === this.rpcProvider) {
        this.balanceLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  async actualiserDonneesReseau(): Promise<void> {
    if (!this.rpcProvider) {
      await this.changerReseau(this.activeNetworkKey);
      return;
    }

    await this.actualiserBlocReseau();
    if (this.transactionStatus === 'pending' && this.dernierHashTransaction) {
      await this.verifierTransactionConfirmee(this.dernierHashTransaction);
    }
    if (this.rpcConnected && this.adresseWallet) {
      await this.chargerWallet();
    }
  }

  actualiserSolde(): Promise<void> {
    return this.actualiserDonneesReseau();
  }

  ouvrirActivite() {
    this.vueActive = 'activite';
    void this.chargerHistorique(this.transactionsPage);
  }

  private resetTransactionHistory(): void {
    this.transactionsRequestSequence += 1;
    this.transactions = [];
    this.transactionsLoading = false;
    this.transactionsError = '';
    this.transactionsState = 'idle';
    this.transactionsHistoryComplete = false;
    this.transactionsIndexedThrough = null;
    this.transactionsStale = false;
    this.transactionsSyncedAt = null;
    this.transactionsTotal = 0;
    this.transactionsPage = 0;
  }

  async chargerHistorique(page = 0): Promise<void> {
    if (this.activeNetworkKey !== 'digevra-local' || !this.adresseWallet) {
      this.resetTransactionHistory();
      return;
    }

    const requestId = ++this.transactionsRequestSequence;
    const address = this.adresseWallet;
    const offset = Math.max(0, page) * this.transactionsPageSize;
    this.transactionsLoading = true;
    this.transactionsError = '';
    try {
      const result = await this.indexerService.getAddressTransactions(
        address,
        this.transactionsPageSize,
        offset
      );
      if (
        requestId !== this.transactionsRequestSequence ||
        address.toLowerCase() !== this.adresseWallet.toLowerCase() ||
        this.activeNetworkKey !== 'digevra-local'
      ) {
        return;
      }

      this.transactions = result.items;
      this.transactionsTotal = result.pagination.total;
      this.transactionsPage = page;
      this.transactionsState = result.indexer.state;
      this.transactionsHistoryComplete = result.indexer.historyComplete;
      this.transactionsIndexedThrough = result.indexer.lastIndexedBlock;
      this.transactionsSyncedAt = null;
      this.transactionsStale =
        result.indexer.state !== 'ready' ||
        !result.indexer.historyComplete ||
        result.indexer.lastIndexedBlock === null ||
        result.indexer.lastIndexedBlock !== result.indexer.chainHead;
    } catch (error) {
      if (requestId === this.transactionsRequestSequence) {
        const indexerError = error instanceof Error
          ? error.message
          : 'Historique indisponible.';
        this.transactionsState = 'degraded';
        this.transactionsHistoryComplete = false;
        this.transactionsStale = true;

        let cachedSnapshot = this.snapshot?.address.toLowerCase() === address.toLowerCase()
          ? this.snapshot
          : this.publicSnapshots.find((item) =>
              item.address.toLowerCase() === address.toLowerCase()
            ) ?? null;
        try {
          cachedSnapshot ??= this.snapshotService.readLocal(address);
        } catch (cacheError) {
          this.transactionsError = `${indexerError} Le cache local a aussi été refusé : ${
            cacheError instanceof Error ? cacheError.message : 'snapshot invalide.'
          }`;
        }
        if (cachedSnapshot) {
          this.transactions = toIndexedTransactions(cachedSnapshot);
          this.transactionsTotal = cachedSnapshot.transactions.length;
          this.transactionsIndexedThrough = cachedSnapshot.lastBlockNumber;
          this.transactionsSyncedAt = cachedSnapshot.syncedAt;
          this.transactionsHistoryComplete = cachedSnapshot.historyComplete;
          this.snapshot = cachedSnapshot;
          this.snapshotIsStale = true;
          this.transactionsError =
            `${indexerError} Dernier historique vérifié du ${new Date(cachedSnapshot.syncedAt).toLocaleString('fr-FR')} (bloc ${cachedSnapshot.lastBlockNumber}); données non actualisées.`;
        } else if (!this.transactionsError) {
          this.transactionsError = indexerError;
          this.transactions = [];
          this.transactionsTotal = 0;
          this.transactionsIndexedThrough = null;
          this.transactionsSyncedAt = null;
          this.transactionsHistoryComplete = false;
        }
      }
    } finally {
      if (requestId === this.transactionsRequestSequence) {
        this.transactionsLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  pageHistorique(direction: -1 | 1): void {
    const nextPage = this.transactionsPage + direction;
    if (
      nextPage < 0 ||
      nextPage * this.transactionsPageSize >= this.transactionsTotal
    ) {
      return;
    }
    void this.chargerHistorique(nextPage);
  }

  ouvrirParametres() {
    this.vueActive = 'parametres';
  }

  afficherBientotDisponible(fonctionnalite: string): void {
    this.messageNavigation = `${fonctionnalite} — bientôt disponible.`;
    if (this.navigationMessageTimeoutId) {
      clearTimeout(this.navigationMessageTimeoutId);
    }
    this.navigationMessageTimeoutId = setTimeout(() => {
      this.messageNavigation = '';
      this.navigationMessageTimeoutId = null;
      this.cdr.detectChanges();
    }, 3500);
  }

  afficherNotifications(): void {
    this.messageNavigation = 'Aucune nouvelle notification.';
    if (this.navigationMessageTimeoutId) {
      clearTimeout(this.navigationMessageTimeoutId);
    }
    this.navigationMessageTimeoutId = setTimeout(() => {
      this.messageNavigation = '';
      this.navigationMessageTimeoutId = null;
      this.cdr.detectChanges();
    }, 3500);
  }

  ouvrirWalletView() {
    this.vueActive = 'wallet';
  }

  ouvrirExplorer() {
    if (!this.explorerUrl) return;
    this.ouvrirExplorerRoute('home');
  }

  ouvrirTransaction(hash: string) {
    if (!hash) return;
    this.ouvrirExplorerRoute('transaction', hash);
  }

  ouvrirBloc(numero: number) {
    this.ouvrirExplorerRoute('block', numero);
  }

  ouvrirAdresse(adresse: string) {
    if (!adresse) return;
    this.ouvrirExplorerRoute('address', adresse);
  }

  private ouvrirExplorerRoute(
    route: 'home' | 'transaction' | 'block' | 'address',
    identifier?: string | number
  ): void {
    const url = buildExplorerUrl(
      getExplorerBaseUrl(this.explorerUrl),
      route,
      identifier,
      this.activeNetwork.explorerRouteMode
    );
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async copierAdresse() {
    if (!this.adresseWallet) return;

    try {
      await navigator.clipboard.writeText(this.adresseWallet);
      this.messageCopie = 'Adresse copiée.';
    } catch (error) {
      console.error(
        'Erreur copie adresse DIGEVRA :',
        error
      );
      this.messageCopie =
        'Impossible de copier l’adresse sur cet appareil.';
    }

    this.cdr.detectChanges();
  }

  raccourcirAdresse(
    adresse: string | undefined
  ): string {
    if (typeof adresse !== 'string') {
      return '';
    }

    if (!adresse) {
      return '';
    }

    if (adresse.length < 15) {
      return adresse;
    }

    return (
      adresse.slice(0, 8) +
      '...' +
      adresse.slice(-6)
    );
  }

  estEnvoyee(tx: IndexedTransaction): boolean {
    return (
      this.walletConnecte &&
      !!tx.from &&
      tx.from.toLowerCase() === this.adresseWallet.toLowerCase()
    );
  }

  obtenirMontant(tx: IndexedTransaction): string {
    return tx.valueDgv;
  }

  obtenirDate(tx: IndexedTransaction): Date | null {

    if (!tx.timestamp) {
      return null;
    }

    const timestamp =
      Number(tx.timestamp);

    return new Date(
      timestamp < 1000000000000
        ? timestamp * 1000
        : timestamp
    );
  }

  obtenirHash(tx: IndexedTransaction): string {
    return tx.hash;
  }

  obtenirBloc(tx: IndexedTransaction): number {
    return tx.blockNumber;
  }
}
