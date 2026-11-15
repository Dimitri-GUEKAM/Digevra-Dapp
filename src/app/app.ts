import {
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  HttpClient,
  HttpClientModule
} from '@angular/common/http';
import {
  formatEther,
  parseEther,
  parseUnits,
  JsonRpcProvider,
  Wallet,
  isAddress
} from 'ethers';

import { HDNodeWallet } from 'ethers';
import {
  displayRpcEndpoint,
  isNetworkKey,
  NETWORKS,
  NetworkKey
} from './network-config';
import { NetworkService } from './network.service';

interface WalletTransaction {
  hash?: string;
  from?: string;
  fromAddress?: string;
  to?: string;
  toAddress?: string;
  valueDgv?: number | string;
  value?: number | string;
  timestamp?: number | string;
  blockNumber?: number | string;
}

interface WalletSummaryResponse {
  balanceDgv?: unknown;
  transactions?: unknown;
}

interface NetworkStatsResponse {
  latestBlock?: unknown;
  totalTransactions?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWalletTransaction(value: unknown): value is WalletTransaction {
  return isRecord(value);
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule
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
  soldeDgvMessage = '';
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

  get backendUrl(): string {
    return this.activeNetwork.backendUrl ?? 'Non configuré';
  }

  get walletUrl(): string | null {
    return this.activeNetwork.walletUrl;
  }

  get explorerUrl(): string {
    return this.activeNetwork.explorerUrl ?? '';
  }

  get rpcEndpointDisplay(): string {
    return displayRpcEndpoint(this.activeNetwork.rpcUrl);
  }

  get transactionUnavailableReason(): string {
    if (!this.rpcConnected) {
      return 'Les transactions sont désactivées tant que la connexion RPC n’est pas vérifiée.';
    }

    if (!this.activeNetwork.smartWalletAddress) {
      return 'Aucun Smart Wallet déployé n’est configuré pour ce réseau.';
    }

    if (!this.smartWalletDeployed) {
      return 'Le Smart Wallet configuré n’a pas de contrat déployé sur ce réseau.';
    }

    if (!this.activeNetwork.dgvTokenAddress && !this.activeNetwork.nativeCurrency.verified) {
      return 'L’actif DGV et son contrat ne sont pas vérifiés sur ce réseau.';
    }

    return 'Les transferts restent indisponibles tant que l’intégration transactionnelle n’est pas vérifiée.';
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

  transactions: WalletTransaction[] = [];

  dernierBloc = 0;
  totalTransactions = 0;

  reseauEnLigne = false;

  panneauTransfert: 'aucun' | 'envoyer' | 'recevoir' = 'aucun';
  adresseDestinataire = '';
  montantEnvoi = 0;
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
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private networkService: NetworkService
  ) {
    this.intervalId = setInterval(() => {
      if (this.activeNetworkKey === 'digevra-local') {
        this.chargerStats();
      } else {
        void this.actualiserBlocReseau();
      }
      if (this.adresseWallet) {
        this.chargerWallet();
      }
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
      walletWindow.postMessage(
        { type: 'DIGEVRA_DAPP_READY' },
        NETWORKS['digevra-local'].walletUrl ?? ''
      );
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
      this.reseauEnLigne = false;
      this.networkError = '';
      this.soldeEth = null;
      this.soldeDgv = 0;
      this.soldeDgvDisplay = '—';
      this.soldeDgvMessage = networkKey === 'ethereum-sepolia' &&
        !config.dgvTokenAddress
        ? 'Token DGV non configuré sur ce réseau'
        : '';
      this.transactions = [];
      this.totalTransactions = 0;

      if (previousProvider && previousProvider !== connection.provider) {
        this.networkService.destroy(previousProvider);
      }

      if (config.backendUrl) {
        this.chargerStats();
      }
      if (this.adresseWallet) {
        this.chargerWallet();
      }
    } catch (error) {
      if (requestId === this.networkSwitchSequence) {
        this.networkError = error instanceof Error
          ? error.message
          : `Impossible de vérifier le réseau ${config.name}.`;
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
      this.networkError = '';
    } catch {
      this.rpcConnected = false;
      this.actualChainId = null;
      this.networkError = `La connexion RPC à ${this.activeNetwork.name} a été perdue.`;
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
    this.transactions = [];
    this.sessionWallet = null;
    this.sessionAddress = '';
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
      !this.walletUrl ||
      event.origin !== this.walletUrl ||
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

    if (!this.walletUrl) {
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
      this.walletUrl
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
    if (this.transactionUnavailableReason) {
      this.messageTransaction = this.transactionUnavailableReason;
    }
  }

  fermerTransfert() {
    if (this.transactionEnCours) {
      return;
    }

    this.panneauTransfert = 'aucun';
    this.adresseDestinataire = '';
    this.montantEnvoi = 0;
    this.messageTransaction = '';
    this.qrCodeDataUrl = '';
    this.messageCopie = '';
    this.demandeTransactionId = '';
  }

  async preparerEnvoi(): Promise<void> {
    if (this.transactionEnCours) {
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

    const portefeuilleLocalDeverrouille =
      !!this.unlockedWallet &&
      this.unlockedWallet.address.toLowerCase() ===
        this.adresseWallet.toLowerCase();
    const sessionExterneAutorisee =
      this.sessionAutorisee &&
      !!this.sessionWallet &&
      !!this.sessionAddress &&
      this.sessionAddress.toLowerCase() ===
        this.sessionAddress.toLowerCase();

    if (!portefeuilleLocalDeverrouille && !sessionExterneAutorisee) {
      this.messageTransaction =
        'Aucun portefeuille autorisé pour signer cette transaction. Déverrouillez votre portefeuille local ou autorisez la session dans DIGEVRA Wallet.';
      return;
    }

    if (!this.rpcProvider || !this.rpcConnected) {
      this.messageTransaction =
        'La connexion RPC du réseau actif n’est pas vérifiée.';
      return;
    }

    try {
      const config = this.activeNetwork;
      const network = await this.rpcProvider.getNetwork();
      if (network.chainId !== BigInt(config.chainId)) {
        this.rpcConnected = false;
        this.actualChainId = null;
        throw new Error('Le Chain ID RPC ne correspond pas au réseau sélectionné.');
      }

      if (!config.smartWalletAddress) {
        throw new Error('Aucun Smart Wallet déployé n’est configuré pour ce réseau.');
      }

      const contractCode = await this.rpcProvider.getCode(config.smartWalletAddress);
      this.smartWalletDeployed = contractCode !== '0x';
      if (!this.smartWalletDeployed) {
        throw new Error(
          'Envoi désactivé : aucun contrat Smart Wallet n’est déployé à l’adresse configurée sur ce réseau.'
        );
      }

      if (!config.dgvTokenAddress && !config.nativeCurrency.verified) {
        throw new Error(
          'Envoi désactivé : l’actif DGV et son contrat ne sont pas vérifiés sur ce réseau.'
        );
      }

      // Vérification de session pour signature externe (si pas de wallet local déverrouillé)
      if (
        !portefeuilleLocalDeverrouille &&
        (!this.sessionWallet ||
          !this.sessionAddress ||
          !this.sessionAutorisee)
      ) {
        throw new Error(
          'Une session Smart Wallet vérifiée et autorisée est requise.'
        );
      }

      // Vérification du solde réel et des frais de réseau avant autorisation d'envoi
      await this.verifierSoldeAvantEnvoi(config);

      this.messageTransaction =
        'Tous les prérequis sont vérifiés. La transaction peut être signée.';
    } catch (error) {
      this.messageTransaction = error instanceof Error
        ? error.message
        : 'Impossible de vérifier les prérequis transactionnels.';
    } finally {
      this.cdr.detectChanges();
    }
  }

  private async verifierSoldeAvantEnvoi(config: import('./network-config').NetworkConfig): Promise<void> {
    const provider = this.rpcProvider;
    if (!provider) {
      throw new Error('Le provider RPC n’est pas disponible pour vérifier le solde.');
    }

    const address = this.adresseWallet;
    const montantWei = parseEther(this.montantEnvoi.toString());

    // --- Solde de la cryptomonnaie native ---
    const balanceWei = await provider.getBalance(address);

    // Estimation des frais de gas (transfert simple : 21 000 gas)
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? BigInt(0);
    const gasLimit = BigInt(21000);
    const gasCost = gasLimit * gasPrice;

    if (config.nativeCurrency.verified && config.nativeCurrency.symbol === 'ETH') {
      // Réseau avec cryptomonnaie native vérifiée (ex: ETH sur Sepolia)
      const totalNeeded = montantWei + gasCost;
      if (balanceWei < totalNeeded) {
        throw new Error(
          `Solde ETH insuffisant : ${formatEther(balanceWei)} ETH disponible, ${formatEther(totalNeeded)} ETH requis (montant + frais de réseau estimés).`
        );
      }
    } else {
      // Réseau avec token ERC-20 (ex: DGV sur DIGEVRA Local)
      // 1. Vérifier le solde DGV si un contrat est configuré
      if (config.dgvTokenAddress) {
        try {
          const tokenBalance = await this.networkService.getTokenBalance(
            provider,
            config.dgvTokenAddress,
            address
          );
          const dgvBalanceWei = parseUnits(tokenBalance.amount, 18);
          if (dgvBalanceWei < montantWei) {
            throw new Error(
              `Solde DGV insuffisant : ${tokenBalance.amount} DGV disponible, ${this.montantEnvoi} DGV requis.`
            );
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Solde DGV insuffisant')) {
            throw error;
          }
          throw new Error(
            'Impossible de vérifier le solde DGV sur le contrat configuré.'
          );
        }
      }

      // 2. Vérifier le solde natif pour les frais de gas
      if (balanceWei < gasCost) {
        throw new Error(
          `Solde natif insuffisant pour les frais de réseau : ${formatEther(balanceWei)} disponible, ${formatEther(gasCost)} requis.`
        );
      }
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

    this.transactionEnCours = true;
    this.demandeTransactionId = crypto.randomUUID();
    this.messageTransaction =
      'Ouverture du Wallet...';

    this.walletWindow = window.open(
      'http://localhost:4200',
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
        'http://localhost:4200'
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

  chargerWallet() {
    if (!this.adresseWallet || !this.rpcProvider || !this.rpcConnected) {
      return;
    }

    if (this.activeNetworkKey === 'ethereum-sepolia') {
      void this.chargerWalletSepolia(
        this.rpcProvider,
        this.adresseWallet,
        this.networkSwitchSequence
      );
      return;
    }

    const backendUrl = this.activeNetwork.backendUrl;
    if (!backendUrl) {
      this.walletDataError = 'Backend DIGEVRA non configuré.';
      return;
    }

    const networkKey = this.activeNetworkKey;
    const address = this.adresseWallet;
    this.http
      .get<unknown>(
        `${backendUrl}/api/address/${encodeURIComponent(address)}`
      )
      .subscribe({
        next: (response) => {
          if (
            networkKey !== this.activeNetworkKey ||
            address !== this.adresseWallet
          ) {
            return;
          }
          if (!isRecord(response)) {
            this.walletDataError = 'Réponse invalide du backend DIGEVRA.';
            this.cdr.detectChanges();
            return;
          }

          const data = response as WalletSummaryResponse;
          const balance = Number(data.balanceDgv);
          if (!Number.isFinite(balance) || balance < 0) {
            this.walletDataError = 'Solde DGV invalide retourné par le backend.';
            this.cdr.detectChanges();
            return;
          }
          if (
            !Array.isArray(data.transactions) ||
            !data.transactions.every(isWalletTransaction)
          ) {
            this.walletDataError = 'Historique invalide retourné par le backend.';
            this.cdr.detectChanges();
            return;
          }

          this.soldeDgv = balance;
          this.soldeDgvDisplay = balance.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6
          });
          this.soldeDgvMessage =
            'Solde rapporté par le backend DIGEVRA (nature du token non vérifiée).';
          this.transactions = data.transactions;
          this.walletDataError = '';
          this.cdr.detectChanges();
        },
        error: () => {
          if (networkKey === this.activeNetworkKey) {
            this.walletDataError =
              'Backend DIGEVRA indisponible : le solde et l’historique ne sont pas vérifiés.';
            this.reseauEnLigne = false;
            this.cdr.detectChanges();
          }
        }
      });
  }

  private async chargerWalletSepolia(
    provider: JsonRpcProvider,
    address: string,
    requestId: number
  ): Promise<void> {
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
        this.soldeDgvMessage = 'Token DGV non configuré sur ce réseau';
        this.transactions = [];
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

      this.soldeDgvDisplay = `${tokenBalance.amount} ${tokenBalance.symbol}`;
      const numericBalance = Number(tokenBalance.amount);
      this.soldeDgv = Number.isFinite(numericBalance) ? numericBalance : 0;
      this.soldeDgvMessage = '';
      this.transactions = [];
      this.walletDataError = '';
    } catch {
      if (requestId === this.networkSwitchSequence && provider === this.rpcProvider) {
        this.walletDataError =
          'Les soldes Sepolia n’ont pas pu être vérifiés via le RPC.';
        this.soldeEth = null;
      }
    }
    this.cdr.detectChanges();
  }

  chargerStats() {
    const backendUrl = this.activeNetwork.backendUrl;
    if (!backendUrl || this.activeNetworkKey !== 'digevra-local') {
      this.reseauEnLigne = false;
      return;
    }

    const networkKey = this.activeNetworkKey;
    this.http
      .get<unknown>(`${backendUrl}/api/stats`)
      .subscribe({
        next: (response) => {
          if (networkKey !== this.activeNetworkKey || !isRecord(response)) {
            return;
          }
          const data = response as NetworkStatsResponse;
          const block = Number(data.latestBlock);
          const transactionCount = Number(data.totalTransactions);
          if (
            !Number.isSafeInteger(block) ||
            block < 0 ||
            !Number.isSafeInteger(transactionCount) ||
            transactionCount < 0
          ) {
            this.reseauEnLigne = false;
            this.networkError =
              'Les statistiques retournées par le backend sont invalides.';
            this.cdr.detectChanges();
            return;
          }
          this.dernierBloc = block;
          this.totalTransactions = transactionCount;
          this.reseauEnLigne = true;
          this.cdr.detectChanges();
        },
        error: () => {
          this.reseauEnLigne = false;
          this.networkError = 'Backend DIGEVRA indisponible.';
          this.cdr.detectChanges();
        }
      });
  }

  private async actualiserBlocSepolia(): Promise<void> {
    await this.actualiserBlocReseau();
  }

  ouvrirActivite() {
    this.vueActive = 'activite';
  }

  ouvrirParametres() {
    this.vueActive = 'parametres';
  }

  ouvrirWalletView() {
    this.vueActive = 'wallet';
  }

  ouvrirExplorer() {
    window.open(
      this.explorerUrl,
      '_blank',
      'noopener,noreferrer'
    );
  }

  ouvrirTransaction(hash: string) {
    if (!hash) return;

    window.open(
      `${this.explorerUrl}/transaction/${hash}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  ouvrirBloc(numero: number) {
    window.open(
      `${this.explorerUrl}/block/${numero}`,
      '_blank',
      'noopener,noreferrer'
    );
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

  estEnvoyee(tx: any): boolean {
    const from =
      tx.from ??
      tx.fromAddress ??
      '';

    return (
      this.walletConnecte &&
      from.toLowerCase() ===
      this.adresseWallet.toLowerCase()
    );
  }

  obtenirMontant(tx: any): number {
    return Number(
      tx.valueDgv ??
      tx.value ??
      0
    );
  }

  obtenirDate(tx: any): Date | null {

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

  obtenirHash(tx: any): string {
    return tx.hash ?? '';
  }

  obtenirBloc(tx: any): number {
    return Number(
      tx.blockNumber ?? 0
    );
  }
}
