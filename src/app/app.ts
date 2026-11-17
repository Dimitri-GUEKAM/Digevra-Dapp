import {
  ChangeDetectorRef,
  Component,
  isDevMode,
  OnInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  formatEther,
  getAddress,
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
import { NetworkService } from './network.service';
import { IndexedTransaction, IndexerService } from './indexer.service';
import { buildExplorerUrl, getExplorerBaseUrl } from '../../explorer/routes.js';

function formatBalanceAmount(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
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

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {

  activeNetworkKey: NetworkKey = 'digevra-local';
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
  transactionsTotal = 0;
  transactionsPage = 0;
  readonly transactionsPageSize = 10;
  private transactionsRequestSequence = 0;
  private rpcProvider: JsonRpcProvider | null = null;
  private networkSwitchSequence = 0;

  get activeNetwork() {
    return NETWORKS[this.activeNetworkKey];
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

  get modeDemonstration(): boolean {
    return isDemoDeployment(globalThis.DIGEVRA_CONFIG, isDevMode());
  }

  get rpcEndpointDisplay(): string {
    if (this.activeNetworkKey === 'digevra-local' && isDevMode()) {
      return `${DIGEVRA_DEV_RPC_PROXY_PATH} → Besu local`;
    }

    return displayRpcEndpoint(this.activeNetwork.rpcUrl);
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
  authMode: 'welcome' | 'create' | 'import' | 'unlock' = 'welcome';
  vaultExists = false;
  authPassword = '';
  authConfirm = '';
  authPhrase = '';
  recoveryPhrase = '';
  authError = '';
  authBusy = false;
  recoveryAcknowledged = false;
  private unlockedWallet: Wallet | HDNodeWallet | null = null;
  private readonly vaultKey = 'digevra_vault_v1';


  adresseWallet = '';
  sessionWallet: ReturnType<typeof Wallet.createRandom> | null = null;
  sessionAddress = '';
  soldeDgv = 0;
  walletDataError = '';

  transactions: IndexedTransaction[] = [];

  dernierBloc = 0;
  reseauEnLigne = false;

  panneauTransfert: 'aucun' | 'envoyer' | 'recevoir' = 'aucun';
  adresseDestinataire = '';
  montantEnvoi = 0;
  preparedTransfer: PreparedNativeTransfer | null = null;
  qrCodeDataUrl = '';
  messageCopie = '';
  messageTransaction = '';
  transactionEnCours = false;
  dernierHashTransaction = '';

  private intervalId: ReturnType<typeof setInterval>;
  private signatureRequestTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private walletWindow: Window | null = null;
  private demandeTransactionId = '';
  demandeAutorisationSessionId = '';
  sessionAutorisee = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private networkService: NetworkService,
    private indexerService: IndexerService
  ) {
    this.intervalId = setInterval(() => {
      void this.actualiserDonneesReseau();
    }, 15000);
  }

  ngOnInit() {
    void this.changerReseau('digevra-local');
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
      this.walletConnecte = false;
      this.sessionAutorisee = false;
      this.sessionWallet = null;
      this.sessionAddress = '';
      this.chargerWallet();
    }
  }

  async changerReseau(networkKey: string): Promise<void> {
    if (!isNetworkKey(networkKey)) {
      this.networkError = 'Le réseau sélectionné n’est pas pris en charge.';
      return;
    }

    const requestId = ++this.networkSwitchSequence;
    const config = NETWORKS[networkKey];
    this.networkSwitchInProgress = true;
    this.networkError = '';
    this.rpcConnected = false;
    this.reseauEnLigne = false;
    this.actualChainId = null;
    this.balanceLoading = false;
    this.soldeDgvDisplay = '—';
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
      const [network, blockNumber] = await Promise.all([
        this.rpcProvider.getNetwork(),
        this.rpcProvider.getBlockNumber()
      ]);
      if (network.chainId !== BigInt(this.activeNetwork.chainId)) {
        throw new Error('Le Chain ID RPC ne correspond plus au réseau actif.');
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
    }
    this.cdr.detectChanges();
  }

  choisirAuth(mode: 'welcome' | 'create' | 'import' | 'unlock') {
    this.authMode = mode;
    this.authError = '';
    this.authPassword = '';
    this.authConfirm = '';
    this.authPhrase = '';
    this.recoveryAcknowledged = false;
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
      this.unlockedWallet = wallet;
      this.authPassword = '';
      this.authError = '';
      this.adresseWallet = wallet.address;
      this.walletConnecte = true;
      // La signature via session Smart Wallet externe n'est PAS autorisée ici.
      this.sessionAutorisee = false;
      this.sessionWallet = null;
      this.sessionAddress = '';
      this.resetTransactionHistory();
      this.chargerWallet();
    } catch { this.authError = 'Mot de passe incorrect ou coffre illisible.'; }
    finally { this.authBusy = false; this.cdr.detectChanges(); }
  }

  verrouiller() {
    this.unlockedWallet = null;
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
    this.fermerTransfert();
    this.choisirAuth('unlock');
  }

  ngOnDestroy() {
    window.removeEventListener(
      'message',
      this.recevoirMessageWallet
    );

    clearInterval(this.intervalId);
    this.arreterTimeoutSignature();
    this.sessionWallet = null;
    this.sessionAddress = '';
    this.unlockedWallet = null;
    this.authPassword = '';
    this.authConfirm = '';
    this.authPhrase = '';
    this.recoveryPhrase = '';
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

      this.dernierHashTransaction = data.hash;
      this.messageTransaction =
        `Transaction envoyée : ${data.hash}`;
      this.arreterTimeoutSignature();
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
      this.messageTransaction = 'Échec de la transaction.';
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

    this.panneauTransfert = 'envoyer';
    this.messageTransaction = '';
    this.dernierHashTransaction = '';
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

    const prepared = this.preparedTransfer;
    const signer = this.unlockedWallet;
    const provider = this.rpcProvider;
    if (this.transactionEnCours || !prepared || !signer || !provider) {
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
    this.messageTransaction = 'Vérification des frais et de l’état du réseau avant signature…';
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
        chainId: BigInt(current.chainId),
        ...(current.isEip1559
          ? {
              maxFeePerGas: current.feePerGas,
              maxPriorityFeePerGas: current.maxPriorityFeePerGas
            }
          : { gasPrice: current.feePerGas })
      };
      const connectedSigner = signer.connect(provider);
      const response = await connectedSigner.sendTransaction(transactionRequest);
      this.dernierHashTransaction = response.hash;
      this.preparedTransfer = null;
      this.messageTransaction = `Transaction diffusée : ${response.hash}. En attente de confirmation…`;

      const receipt = await response.wait(1);
      if (!receipt || receipt.status !== 1) {
        throw new Error('La transaction n’a pas été confirmée avec succès.');
      }

      this.messageTransaction = `Transaction confirmée : ${response.hash}`;
      this.adresseDestinataire = '';
      this.montantEnvoi = 0;
      this.preparedTransfer = null;
      await this.chargerWallet();
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      this.messageTransaction = errorCode === 'ACTION_REJECTED'
        ? 'Signature refusée. Aucune transaction n’a été diffusée.'
        : error instanceof Error
          ? error.message
          : 'Échec de la vérification ou de l’envoi de la transaction.';
    } finally {
      this.transactionEnCours = false;
      this.cdr.detectChanges();
    }
  }

  private async verifierTransactionConfirmee(hash: string): Promise<void> {
    const provider = this.rpcProvider;
    if (!provider || !this.rpcConnected) {
      this.messageTransaction =
        'Le hash a été reçu, mais le statut ne peut pas être vérifié sans RPC.';
      this.transactionEnCours = false;
      this.demandeTransactionId = '';
      this.cdr.detectChanges();
      return;
    }

    try {
      const [network, receipt] = await Promise.all([
        provider.getNetwork(),
        provider.getTransactionReceipt(hash)
      ]);
      if (
        network.chainId !== BigInt(this.activeNetwork.chainId) ||
        !receipt ||
        receipt.status !== 1
      ) {
        throw new Error('La transaction n’a pas été confirmée sur le réseau actif.');
      }

      this.dernierHashTransaction = hash;
      this.messageTransaction = `Transaction confirmée : ${hash}`;
      this.adresseDestinataire = '';
      this.montantEnvoi = 0;
      this.chargerWallet();
    } catch (error) {
      this.messageTransaction = error instanceof Error
        ? error.message
        : 'Le statut de la transaction n’a pas pu être vérifié.';
    } finally {
      this.transactionEnCours = false;
      this.demandeTransactionId = '';
      this.arreterTimeoutSignature();
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

    if (!this.rpcProvider || !this.rpcConnected) {
      this.balanceLoading = false;
      this.soldeDgvDisplay = '—';
      this.soldeDgvMessage = 'Solde indisponible — réseau déconnecté';
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
    } catch (error) {
      if (requestId === this.transactionsRequestSequence) {
        this.transactionsError = error instanceof Error
          ? error.message
          : 'Historique indisponible.';
        this.transactionsState = 'degraded';
        this.transactionsHistoryComplete = false;
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
