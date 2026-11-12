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
  Contract,
  JsonRpcProvider,
  Wallet,
  parseEther
} from 'ethers';
import QRCode from 'qrcode';

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

  backendUrl = 'http://localhost:3000';
  walletUrl = 'http://localhost:4200';
  explorerUrl = 'http://localhost:4201';

  chainId = 20261019;
  consensus = 'QBFT (4 validateurs)';

  vueActive: 'wallet' | 'activite' | 'parametres' = 'wallet';

  walletConnecte = false;

  adresseWallet = '';
  sessionWallet: ReturnType<typeof Wallet.createRandom> | null = null;
  sessionAddress = '';
  soldeDgv = 0;

  transactions: any[] = [];

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
  private readonly RPC_URL = 'http://127.0.0.1:9545';
  private readonly SMART_WALLET_ADDRESS =
    '0xf0571df1FB4a56b83aD3962D4167C2cAE32F25d1';
  private readonly SMART_WALLET_ABI = [
    'function execute(address to, uint256 value)',
    'function sessionActive() view returns (bool)',
    'function sessionKey() view returns (address)',
    'function sessionSpent() view returns (uint256)',
    'function maxPerTransaction() view returns (uint256)',
    'function maxSessionAmount() view returns (uint256)'
  ];
  sessionAutorisee = false;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {
    this.chargerStats();

    this.intervalId = setInterval(() => {
      this.chargerStats();

      if (this.adresseWallet) {
        this.chargerWallet();
      }
    }, 5000);
  }

  ngOnInit() {
    window.addEventListener(
      'message',
      this.recevoirMessageWallet
    );

    if (window.opener) {
      const walletWindow = window.opener;
      this.walletWindow = walletWindow;
      walletWindow.postMessage(
        { type: 'DIGEVRA_DAPP_READY' },
        this.walletUrl
      );
    }

    const adresseSauvegardee =
      localStorage.getItem(
        'digevra_connected_address'
      );

    if (
      adresseSauvegardee &&
      /^0x[a-fA-F0-9]{40}$/.test(
        adresseSauvegardee
      )
    ) {
      this.adresseWallet = adresseSauvegardee;
      this.chargerWallet();
    }
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
  }

  recevoirMessageWallet = (
    event: MessageEvent
  ) => {
    if (
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

      this.dernierHashTransaction = data.hash;
      this.transactionEnCours = false;
      this.demandeTransactionId = '';
      this.arreterTimeoutSignature();
      this.messageTransaction = 'Transaction confirmée.';
      this.adresseDestinataire = '';
      this.montantEnvoi = 0;
      this.chargerWallet();

      setTimeout(() => {
        this.chargerWallet();
        this.chargerStats();
      }, 6000);
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
    if (
      this.walletWindow &&
      !this.walletWindow.closed
    ) {
      this.walletWindow.focus();
      return;
    }

    this.walletWindow = window.open(
      'http://localhost:4200',
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

    console.log(
      'Session DIGEVRA créée :',
      this.sessionAddress
    );

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
    this.sessionWallet = null;
    this.sessionAddress = '';
    this.sessionAutorisee = false;
    this.demandeAutorisationSessionId = '';
    this.soldeDgv = 0;
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
      this.qrCodeDataUrl = await QRCode.toDataURL(
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

  async preparerEnvoi() {
    if (this.transactionEnCours) {
      return;
    }

    this.messageTransaction = '';

    if (!this.sessionWallet || !this.sessionAddress) {
      this.messageTransaction =
        'Aucune session DIGEVRA active.';
      return;
    }

    if (!this.sessionAutorisee) {
      this.messageTransaction =
        'La session doit être autorisée dans DIGEVRA Wallet.';
      return;
    }

    if (
      !/^0x[a-fA-F0-9]{40}$/.test(
        this.adresseDestinataire
      )
    ) {
      this.messageTransaction =
        'Adresse destinataire invalide.';
      return;
    }

    if (!this.montantEnvoi || this.montantEnvoi <= 0) {
      this.messageTransaction = 'Montant invalide.';
      return;
    }

    if (this.montantEnvoi > 10) {
      this.messageTransaction =
        'Maximum autorisé : 10 DGV par transaction.';
      return;
    }

    this.transactionEnCours = true;
    let provider: JsonRpcProvider | null = null;

    try {
      provider = new JsonRpcProvider(
        this.RPC_URL,
        this.chainId
      );
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(this.chainId)) {
        throw new Error(
          `Réseau incorrect : Chain ID ${network.chainId}.`
        );
      }

      const contractCode = await provider.getCode(
        this.SMART_WALLET_ADDRESS
      );
      if (contractCode === '0x') {
        throw new Error(
          'Le Smart Wallet est introuvable sur ce réseau.'
        );
      }

      const signer = this.sessionWallet.connect(provider);
      if (
        signer.address.toLowerCase() !==
        this.sessionAddress.toLowerCase()
      ) {
        throw new Error('Adresse du signer de session incohérente.');
      }

      const contract = new Contract(
        this.SMART_WALLET_ADDRESS,
        this.SMART_WALLET_ABI,
        signer
      );

      const [active, authorizedSession, spent, perTransactionLimit, sessionLimit] =
        await Promise.all([
          contract['sessionActive']() as Promise<boolean>,
          contract['sessionKey']() as Promise<string>,
          contract['sessionSpent']() as Promise<bigint>,
          contract['maxPerTransaction']() as Promise<bigint>,
          contract['maxSessionAmount']() as Promise<bigint>
        ]);

      if (!active) {
        this.sessionAutorisee = false;
        throw new Error('La session Smart Wallet est inactive.');
      }

      if (
        authorizedSession.toLowerCase() !==
        this.sessionAddress.toLowerCase()
      ) {
        this.sessionAutorisee = false;
        throw new Error('Cette session n’est pas autorisée.');
      }

      const amount = parseEther(this.montantEnvoi.toString());
      if (amount > perTransactionLimit) {
        throw new Error(
          'Maximum autorisé : 10 DGV par transaction.'
        );
      }
      if (spent + amount > sessionLimit) {
        throw new Error(
          'Limite cumulée de 50 DGV de la session dépassée.'
        );
      }

      const smartWalletBalance = await provider.getBalance(
        this.SMART_WALLET_ADDRESS
      );
      if (smartWalletBalance < amount) {
        throw new Error(
          'Solde insuffisant dans le Smart Wallet.'
        );
      }

      const sessionBalance = await provider.getBalance(
        this.sessionAddress
      );
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (gasPrice === null) {
        throw new Error('Impossible d’estimer le prix du gas.');
      }
      if (sessionBalance === 0n) {
        throw new Error(
          `Le compte de session ${this.sessionAddress} doit être financé en DGV pour payer le gas.`
        );
      }
      const gasLimit = await contract['execute'].estimateGas(
        this.adresseDestinataire,
        amount
      );
      if (sessionBalance < gasLimit * gasPrice) {
        throw new Error(
          `Solde gas insuffisant pour la session ${this.sessionAddress}.`
        );
      }

      this.messageTransaction =
        'Envoi direct via le Smart Wallet en cours...';
      const tx = await contract['execute'](
        this.adresseDestinataire,
        amount
      );
      this.dernierHashTransaction = tx.hash;
      this.messageTransaction =
        `Transaction envoyée : ${tx.hash}`;

      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error('La transaction n’a pas été confirmée.');
      }

      this.messageTransaction =
        `Transaction confirmée : ${tx.hash}`;
      this.adresseDestinataire = '';
      this.montantEnvoi = 0;
      this.chargerWallet();
    } catch (error) {
      console.error(
        'Erreur lors de l’envoi direct DIGEVRA :',
        error
      );
      this.messageTransaction =
        error instanceof Error
          ? error.message
          : 'Échec de la transaction DIGEVRA.';
    } finally {
      await provider?.destroy();
      this.transactionEnCours = false;
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
    if (!this.adresseWallet) {
      return;
    }

    this.http
      .get<any>(
        `${this.backendUrl}/api/address/${this.adresseWallet}`
      )
      .subscribe({
        next: (data) => {
          this.soldeDgv =
            Number(data.balanceDgv ?? 0);

          this.transactions =
            data.transactions ?? [];

          this.cdr.detectChanges();
        },

        error: (error) => {
          console.error(
            'Erreur chargement wallet :',
            error
          );

          this.cdr.detectChanges();
        }
      });
  }

  chargerStats() {
    this.http
      .get<any>(
        `${this.backendUrl}/api/stats`
      )
      .subscribe({
        next: (data) => {
          this.dernierBloc =
            Number(data.latestBlock ?? 0);

          this.totalTransactions =
            Number(data.totalTransactions ?? 0);

          this.reseauEnLigne = true;

          this.cdr.detectChanges();
        },

        error: (error) => {
          this.reseauEnLigne = false;
          console.error(
            'Erreur chargement statistiques DIGEVRA :',
            error
          );
          this.cdr.detectChanges();
        }
      });
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
    adresse: string
  ): string {

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
