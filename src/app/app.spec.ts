import { TestBed } from '@angular/core/testing';
import { Wallet } from 'ethers';
import { App } from './app';
import { NetworkService } from './network.service';
import { NETWORKS } from './network-config';
import { IndexerService } from './indexer.service';
import type { IndexedTransaction } from './indexer.service';
import { vi } from 'vitest';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{
        provide: NetworkService,
        useValue: {
          connect: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
          getNativeBalance: vi.fn(),
          getTokenBalance: vi.fn(),
          destroy: vi.fn()
        }
      }, {
        provide: IndexerService,
        useValue: {
          getAddressTransactions: vi.fn().mockResolvedValue({
            items: [],
            pagination: { limit: 10, offset: 0, total: 0, hasMore: false },
            indexer: {
              state: 'ready',
              startBlock: 0,
              lastIndexedBlock: 100,
              chainHead: 100,
              historyComplete: true
            }
          })
        }
      }]
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the DIGEVRA auth screen with all welcome options', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.auth-card h1')?.textContent)
      .toContain('DIGEVRA Wallet');
    expect(compiled.querySelector('.welcome-screen')).toBeNull();
    expect(compiled.querySelectorAll('.auth-options button')).toHaveLength(3);
    expect(compiled.querySelector('.auth-back')).toBeNull();
    fixture.destroy();
  });

  it('opens the configured local Explorer from the Wallet', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    app.ouvrirExplorer();

    expect(open).toHaveBeenCalledWith(
      'http://localhost:4201/#/',
      '_blank',
      'noopener,noreferrer'
    );
    fixture.destroy();
  });

  it('opens transaction, block, and address links using the Explorer hash routes', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    app.ouvrirTransaction(`0x${'a'.repeat(64)}`);
    app.ouvrirBloc(27640);
    app.ouvrirAdresse('0x1111111111111111111111111111111111111111');

    expect(open).toHaveBeenNthCalledWith(
      1,
      `http://localhost:4201/#/transaction/0x${'a'.repeat(64)}`,
      '_blank',
      'noopener,noreferrer'
    );
    expect(open).toHaveBeenNthCalledWith(
      2,
      'http://localhost:4201/#/block/27640',
      '_blank',
      'noopener,noreferrer'
    );
    expect(open).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4201/#/address/0x1111111111111111111111111111111111111111',
      '_blank',
      'noopener,noreferrer'
    );
    fixture.destroy();
  });

  it('loads the active wallet history page and exposes indexer completeness', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const address = '0x1111111111111111111111111111111111111111';
    const getAddressTransactions = vi.mocked(
      TestBed.inject(IndexerService).getAddressTransactions
    );
    getAddressTransactions.mockResolvedValue({
      items: [],
      pagination: { limit: 10, offset: 20, total: 25, hasMore: true },
      indexer: {
        state: 'ready',
        startBlock: 0,
        lastIndexedBlock: 125,
        chainHead: 125,
        historyComplete: true
      }
    });
    app.adresseWallet = address;

    await app.chargerHistorique(2);

    expect(getAddressTransactions).toHaveBeenCalledWith(address, 10, 20);
    expect(app.transactionsPage).toBe(2);
    expect(app.transactionsTotal).toBe(25);
    expect(app.transactionsState).toBe('ready');
    expect(app.transactionsIndexedThrough).toBe(125);
    expect(app.transactionsHistoryComplete).toBe(true);
    expect(app.transactionsLoading).toBe(false);
    fixture.destroy();
  });

  it('loads the next history page when pagination is requested', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const address = '0x1111111111111111111111111111111111111111';
    const getAddressTransactions = vi.mocked(
      TestBed.inject(IndexerService).getAddressTransactions
    );
    getAddressTransactions.mockResolvedValue({
      items: [],
      pagination: { limit: 10, offset: 10, total: 25, hasMore: true },
      indexer: {
        state: 'ready',
        startBlock: 0,
        lastIndexedBlock: 125,
        chainHead: 125,
        historyComplete: true
      }
    });
    app.adresseWallet = address;
    app.transactionsTotal = 25;

    app.pageHistorique(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(getAddressTransactions).toHaveBeenCalledWith(address, 10, 10);
    expect(app.transactionsPage).toBe(1);
    fixture.destroy();
  });

  it('renders indexed wallet transactions in the recent activity panel', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.transactions = [{
      hash: `0x${'a'.repeat(64)}`,
      blockNumber: 123,
      transactionIndex: 0,
      from: app.adresseWallet,
      to: '0x2222222222222222222222222222222222222222',
      valueWei: '10000000000000000',
      valueDgv: '0.01',
      gasUsed: '21000',
      effectiveGasPriceWei: '1000',
      feeWei: '21000000',
      feeDgv: '0.000000000021',
      status: 1,
      timestamp: 1_700_000_000
    } satisfies IndexedTransaction];

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const recent = fixture.nativeElement.querySelector('.v3-recent') as HTMLElement;
    expect(recent.querySelectorAll('.v3-tx')).toHaveLength(1);
    expect(recent.textContent).toContain('Envoi');
    expect(recent.textContent).toContain('-0.01 DGV');
    expect(recent.textContent).toContain('bloc 123');
    expect(recent.textContent).toContain('Frais : 0.000000000021 DGV');
    fixture.destroy();
  });

  it('reports an indexer failure instead of presenting it as an empty history', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    vi.mocked(TestBed.inject(IndexerService).getAddressTransactions)
      .mockRejectedValue(new Error('Indexer unavailable.'));
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.transactionsHistoryComplete = true;

    await app.chargerHistorique();

    expect(app.transactionsError).toBe('Indexer unavailable.');
    expect(app.transactionsState).toBe('degraded');
    expect(app.transactionsHistoryComplete).toBe(false);
    expect(app.transactions).toEqual([]);
    expect(app.transactionsLoading).toBe(false);
    fixture.destroy();
  });

  it('routes auth options to create, import, and local unlock modes', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const authButtons = () =>
      fixture.nativeElement.querySelectorAll(
        '.auth-options button'
      ) as NodeListOf<HTMLButtonElement>;

    authButtons()[0].click();
    expect(app.authMode).toBe('create');

    app.choisirAuth('welcome');
    fixture.detectChanges();
    authButtons()[1].click();
    expect(app.authMode).toBe('import');

    app.choisirAuth('welcome');
    fixture.detectChanges();
    authButtons()[2].click();
    expect(app.authMode).toBe('import');

    fixture.destroy();
  });

  it('routes connect to unlock when a local vault exists', () => {
    const previousVault = localStorage.getItem('digevra_vault_v1');
    localStorage.setItem('digevra_vault_v1', 'encrypted-vault-placeholder');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const connectButton = fixture.nativeElement.querySelectorAll(
      '.auth-options button'
    )[2] as HTMLButtonElement;

    connectButton.click();

    expect(app.vaultExists).toBe(true);
    expect(app.authMode).toBe('unlock');
    fixture.destroy();
    if (previousVault === null) {
      localStorage.removeItem('digevra_vault_v1');
    } else {
      localStorage.setItem('digevra_vault_v1', previousVault);
    }
  });

  it('accepts a public address only from the opened Wallet window', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const address = '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75';
    const generatedWallet = {
      address: '0x1234567890123456789012345678901234567890'
    } as ReturnType<typeof Wallet.createRandom>;
    vi.spyOn(Wallet, 'createRandom').mockReturnValue(generatedWallet);
    const postMessage = vi.spyOn(window, 'postMessage');
    const chargerWallet = vi
      .spyOn(app, 'chargerWallet')
      .mockResolvedValue();
    vi.spyOn(window, 'open').mockReturnValue(window);
    app.ouvrirWallet();

    app.recevoirMessageWallet(
      new MessageEvent('message', {
        origin: 'http://localhost:4200',
        source: window,
        data: {
        type: 'DIGEVRA_WALLET_CONNECTED',
        address
        }
      })
    );

    expect(app.walletConnecte).toBe(true);
    expect(app.adresseWallet).toBe(address);
    expect(app.sessionWallet).not.toBeNull();
    expect(app.sessionAddress).toBe(app.sessionWallet?.address);
    expect(app.sessionAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(app.sessionAutorisee).toBe(false);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DIGEVRA_AUTHORIZE_SESSION_REQUEST',
        owner: address,
        sessionAddress: app.sessionAddress
      }),
      'http://localhost:4200'
    );
    expect(chargerWallet).toHaveBeenCalledOnce();
    expect(
      localStorage.getItem('digevra_connected_address')
    ).toBe(address);
  });

  it('ignores messages from other origins, windows, or malformed addresses', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const address = '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75';
    vi.spyOn(window, 'open').mockReturnValue(window);
    app.ouvrirWallet();
    localStorage.removeItem('digevra_connected_address');

    const message = (
      origin: string,
      source: MessageEventSource | null,
      data: unknown
    ) => app.recevoirMessageWallet(
      new MessageEvent('message', {
        origin,
        source,
        data
      })
    );

    message('http://evil.example', window, {
      type: 'DIGEVRA_WALLET_CONNECTED',
      address
    });
    message('http://localhost:4200', null, {
      type: 'DIGEVRA_WALLET_CONNECTED',
      address
    });
    message('http://localhost:4200', window, {
      type: 'DIGEVRA_WALLET_CONNECTED',
      address: 'invalid'
    });

    expect(app.walletConnecte).toBe(false);
    expect(
      localStorage.getItem('digevra_connected_address')
    ).toBeNull();
  });

  it('marks the active session authorized only for a matching Wallet result', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const sessionAddress =
      '0x1234567890123456789012345678901234567890';
    const sessionWallet = {
      address: sessionAddress
    } as ReturnType<typeof Wallet.createRandom>;
    app.sessionWallet = sessionWallet;
    app.sessionAddress = sessionAddress;
    app.demandeAutorisationSessionId = 'session-request-123';
    vi.spyOn(window, 'open').mockReturnValue(window);
    app.ouvrirWallet();

    app.recevoirMessageWallet(
      new MessageEvent('message', {
        origin: 'http://localhost:4200',
        source: window,
        data: {
          type: 'DIGEVRA_AUTHORIZE_SESSION_RESULT',
          requestId: 'session-request-123',
          authorized: true,
          sessionAddress
        }
      })
    );

    expect(app.sessionAutorisee).toBe(true);
    expect(app.demandeAutorisationSessionId).toBe('');
    expect(app.messageTransaction).toContain('Session autorisée');
    fixture.destroy();
  });

  it('focuses an already-open Wallet when opening it for a connection', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const walletWindow = {
      closed: false,
      focus: vi.fn(),
      postMessage: vi.fn()
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(walletWindow);

    app.ouvrirWallet();
    app.ouvrirWallet();

    expect(open).toHaveBeenCalledOnce();
    expect(walletWindow.focus).toHaveBeenCalledOnce();
    fixture.destroy();
  });

  it('does not send when no wallet is unlocked and session is not authorized', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const open = vi.spyOn(window, 'open');
    const request = vi.spyOn(app, 'demanderSignatureWallet');

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.sessionWallet = {
      address: '0x3333333333333333333333333333333333333333'
    } as ReturnType<typeof Wallet.createRandom>;
    app.sessionAddress = app.sessionWallet.address;
    app.sessionAutorisee = false;
    app.soldeDgv = 5;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;
    await app.preparerEnvoi();

    expect(app.messageTransaction).toContain(
      'Déverrouillez localement le portefeuille qui détient les DGV'
    );
    expect(request).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('validates recipient and amount before contacting the RPC', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.sessionWallet = {
      address: '0x3333333333333333333333333333333333333333'
    } as ReturnType<typeof Wallet.createRandom>;
    app.sessionAddress = app.sessionWallet.address;
    app.sessionAutorisee = true;

    app.adresseDestinataire = 'invalid';
    app.montantEnvoi = 1;
    await app.preparerEnvoi();
    expect(app.messageTransaction).toBe('Adresse destinataire invalide.');

    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 0;
    await app.preparerEnvoi();
    expect(app.messageTransaction).toBe('Montant invalide.');

    app.montantEnvoi = 10.1;
    await app.preparerEnvoi();
    expect(app.messageTransaction).toBe(
      'Maximum autorisé : 10 DGV par transaction.'
    );

    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('does not send when local wallet is unlocked but balance is insufficient for gas', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const networkService = TestBed.inject(NetworkService);

    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(20261019) }),
      getBalance: vi.fn().mockResolvedValue(BigInt(1000000000000)),
      getFeeData: vi.fn().mockResolvedValue({
        gasPrice: BigInt(1000000000),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null
      }),
      getCode: vi.fn().mockResolvedValue('0x'),
      estimateGas: vi.fn().mockResolvedValue(21_000n),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: null,
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency }
      },
      configurable: true
    });

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    (app as any).unlockedWallet = {
      address: '0x1111111111111111111111111111111111111111'
    } as any;
    app.sessionAutorisee = false;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;

    vi.spyOn(networkService, 'getTokenBalance').mockResolvedValue({
      amount: '100',
      symbol: 'DGV'
    });

    await app.preparerEnvoi();

    expect(app.messageTransaction).toContain(
      'Solde DGV insuffisant'
    );
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('does not send when local wallet is unlocked and balance is sufficient', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(20261019) }),
      getBalance: vi.fn().mockResolvedValue(BigInt(10000000000000000000)),
      getFeeData: vi.fn().mockResolvedValue({
        gasPrice: BigInt(1000000000),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null
      }),
      getCode: vi.fn().mockResolvedValue('0x'),
      estimateGas: vi.fn().mockResolvedValue(21_000n),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: null,
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency }
      },
      configurable: true
    });

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    (app as any).unlockedWallet = {
      address: '0x1111111111111111111111111111111111111111'
    } as any;
    app.sessionAutorisee = false;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;

    vi.spyOn(TestBed.inject(NetworkService), 'getTokenBalance').mockResolvedValue({
      amount: '100',
      symbol: 'DGV'
    });

    await app.preparerEnvoi();

    expect(app.messageTransaction).toContain(
      'Transfert vérifié'
    );
    expect(app.transactionEnCours).toBe(false);
    expect(app.preparedTransfer?.amountDgv).toBe('1.25');
    fixture.destroy();
  });

  it('does not send when external session is not authorized', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const open = vi.spyOn(window, 'open');
    const request = vi.spyOn(app, 'demanderSignatureWallet');

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.sessionWallet = {
      address: '0x3333333333333333333333333333333333333333'
    } as ReturnType<typeof Wallet.createRandom>;
    app.sessionAddress = app.sessionWallet.address;
    app.sessionAutorisee = false;
    (app as any).unlockedWallet = null;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;
    await app.preparerEnvoi();

    expect(app.messageTransaction).toContain(
      'Déverrouillez localement le portefeuille qui détient les DGV'
    );
    expect(request).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('does not let an authorized session sign for the EOA holding DGV', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(20261019) }),
      getBalance: vi.fn().mockResolvedValue(BigInt(10000000000000000000)),
      getFeeData: vi.fn().mockResolvedValue({
        gasPrice: BigInt(1000000000),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null
      }),
      getCode: vi.fn().mockResolvedValue('0x'),
      estimateGas: vi.fn().mockResolvedValue(21_000n),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: null,
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency }
      },
      configurable: true
    });

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.sessionWallet = {
      address: '0x3333333333333333333333333333333333333333'
    } as ReturnType<typeof Wallet.createRandom>;
    app.sessionAddress = app.sessionWallet.address;
    app.sessionAutorisee = true;
    (app as any).unlockedWallet = null;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;

    vi.spyOn(TestBed.inject(NetworkService), 'getTokenBalance').mockResolvedValue({
      amount: '100',
      symbol: 'DGV'
    });

    await app.preparerEnvoi();

    expect(app.messageTransaction).toContain('Déverrouillez localement');
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('does not send when external session is authorized but balance is insufficient', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(20261019) }),
      getBalance: vi.fn().mockResolvedValue(BigInt(1000000000000)),
      getFeeData: vi.fn().mockResolvedValue({
        gasPrice: BigInt(1000000000),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null
      }),
      getCode: vi.fn().mockResolvedValue('0x'),
      estimateGas: vi.fn().mockResolvedValue(21_000n),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: null,
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency }
      },
      configurable: true
    });

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.sessionWallet = {
      address: '0x3333333333333333333333333333333333333333'
    } as ReturnType<typeof Wallet.createRandom>;
    app.sessionAddress = app.sessionWallet.address;
    app.sessionAutorisee = true;
    (app as any).unlockedWallet = null;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;

    vi.spyOn(TestBed.inject(NetworkService), 'getTokenBalance').mockResolvedValue({
      amount: '100',
      symbol: 'DGV'
    });

    await app.preparerEnvoi();

    expect(app.messageTransaction).toContain('Déverrouillez localement');
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('does not send when RPC is unavailable', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    (app as any).unlockedWallet = {
      address: '0x1111111111111111111111111111111111111111'
    } as any;
    (app as any).rpcProvider = null;
    app.rpcConnected = false;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;
    await app.preparerEnvoi();

    expect(app.messageTransaction).toBe(
      'La connexion RPC du réseau actif n’est pas vérifiée.'
    );
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('does not send when Chain ID is incorrect', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(999999) }),
      getBalance: vi.fn(),
      getFeeData: vi.fn(),
      getCode: vi.fn().mockResolvedValue('0x'),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: null,
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency }
      },
      configurable: true
    });

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    (app as any).unlockedWallet = {
      address: '0x1111111111111111111111111111111111111111'
    } as any;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;
    await app.preparerEnvoi();

    expect(app.messageTransaction).toBe(
      'Le Chain ID RPC ne correspond pas au réseau sélectionné.'
    );
    expect(app.rpcConnected).toBe(false);
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('refuses a classic native transfer from a Smart Contract Wallet', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const provider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 20261019n }),
      getCode: vi.fn().mockResolvedValue('0x60006000'),
      getBalance: vi.fn(),
      getFeeData: vi.fn(),
      estimateGas: vi.fn(),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = provider;
    app.rpcConnected = true;
    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    (app as any).unlockedWallet = {
      address: app.adresseWallet
    } as any;
    app.adresseDestinataire = '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1;

    await app.preparerEnvoi();

    expect(app.messageTransaction).toContain('Cette adresse est un Smart Contract Wallet');
    expect(provider.getBalance).not.toHaveBeenCalled();
    expect(app.preparedTransfer).toBeNull();
    fixture.destroy();
  });

  it('requires explicit confirmation, sends a native value transaction, and refreshes the balance', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const txHash = `0x${'a'.repeat(64)}`;
    const sendTransaction = vi.fn().mockResolvedValue({
      hash: txHash,
      wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 145 })
    });
    const provider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 20261019n }),
      getCode: vi.fn().mockResolvedValue('0x'),
      getBalance: vi.fn().mockResolvedValue(100n * 10n ** 18n),
      getFeeData: vi.fn().mockResolvedValue({
        gasPrice: 1_000_000_000n,
        maxFeePerGas: null,
        maxPriorityFeePerGas: null
      }),
      estimateGas: vi.fn().mockResolvedValue(21_000n),
      destroy: vi.fn()
    };
    const signer = {
      address: '0x1111111111111111111111111111111111111111',
      connect: vi.fn(() => ({ sendTransaction }))
    };
    (app as any).rpcProvider = provider;
    (app as any).unlockedWallet = signer;
    app.rpcConnected = true;
    app.walletConnecte = true;
    app.adresseWallet = signer.address;
    app.adresseDestinataire = '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;
    vi.spyOn(TestBed.inject(NetworkService), 'getNativeBalance')
      .mockResolvedValue('98.7499748');

    await app.preparerEnvoi();

    expect(app.preparedTransfer?.amountDgv).toBe('1.25');
    expect(app.preparedTransfer?.estimatedFeeDgv).toBe('0.0000252');
    expect(sendTransaction).not.toHaveBeenCalled();

    await app.confirmerEtEnvoyer();

    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
      to: '0x2222222222222222222222222222222222222222',
      value: 1_250_000_000_000_000_000n,
      chainId: 20261019n
    }));
    expect(app.dernierHashTransaction).toBe(txHash);
    expect(app.messageTransaction).toContain(`Transaction confirmée : ${txHash}`);
    expect(app.soldeDgvDisplay).toBe('98.7499748');
    expect(app.preparedTransfer).toBeNull();
    fixture.destroy();
  });

  it('switches the active network only after its configured chain is verified', async () => {
    const networkService = TestBed.inject(NetworkService);
    const provider = {
      getNetwork: vi.fn(),
      getBlockNumber: vi.fn(),
      getCode: vi.fn(),
      destroy: vi.fn()
    };
    vi.spyOn(networkService, 'connect').mockImplementation(async (config) => ({
      provider: provider as never,
      chainId: config.chainId,
      blockNumber: 52,
      smartWalletDeployed: false
    }));

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance;

    await app.changerReseau('ethereum-sepolia');

    expect(app.activeNetworkKey).toBe('ethereum-sepolia');
    expect(app.rpcConnected).toBe(true);
    expect(app.actualChainId).toBe(NETWORKS['ethereum-sepolia'].chainId);
    expect(app.dernierBloc).toBe(52);
    fixture.destroy();
  });

  it('refreshes real native balances and displays zero exactly as 0 DGV', async () => {
    localStorage.removeItem('digevra_connected_address');
    const networkService = TestBed.inject(NetworkService);
    const provider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 20261019n }),
      getBlockNumber: vi.fn().mockResolvedValue(128),
      getCode: vi.fn().mockResolvedValue('0x'),
      destroy: vi.fn()
    };
    vi.spyOn(networkService, 'connect').mockResolvedValue({
      provider: provider as never,
      chainId: 20261019,
      blockNumber: 127,
      smartWalletDeployed: false
    });
    vi.spyOn(networkService, 'getNativeBalance')
      .mockResolvedValueOnce('1.234567890123456789')
      .mockResolvedValueOnce('0');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const app = fixture.componentInstance;
    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';

    await app.actualiserSolde();
    expect(app.soldeDgvDisplay).toBe('1.234567890123456789');
    expect(app.soldeDgvSymbol).toBe('DGV');

    await app.actualiserSolde();
    fixture.detectChanges();
    expect(app.soldeDgvDisplay).toBe('0');
    expect(fixture.nativeElement.textContent).toContain('0 DGV');
    expect(app.rpcConnected).toBe(true);
    fixture.destroy();
  });

  it('rejects transaction signature message from unauthorized origin', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.demandeAutorisationSessionId = 'test-request-id';

    app.recevoirMessageWallet(
      new MessageEvent('message', {
        origin: 'http://malicious-site.com',
        source: window,
        data: {
          type: 'DIGEVRA_AUTHORIZE_SESSION_RESULT',
          requestId: 'test-request-id',
          authorized: true,
          sessionAddress: '0x3333333333333333333333333333333333333333'
        }
      })
    );

    expect(app.sessionAutorisee).toBe(false);
    fixture.destroy();
  });

  it('restores a saved public address without marking Wallet connected', () => {
    const address = '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75';
    localStorage.setItem('digevra_connected_address', address);
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const chargerWallet = vi
      .spyOn(app, 'chargerWallet')
      .mockResolvedValue();

    fixture.detectChanges();

    expect(app.adresseWallet).toBe(address);
    expect(app.walletConnecte).toBe(false);
    expect(app.sessionAutorisee).toBe(false);
    expect(app.sessionWallet).toBeNull();
    expect(app.sessionAddress).toBe('');
    expect(chargerWallet).toHaveBeenCalledOnce();
    fixture.destroy();
    localStorage.removeItem('digevra_connected_address');
  });
});
