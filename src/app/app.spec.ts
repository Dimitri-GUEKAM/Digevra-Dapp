import { TestBed } from '@angular/core/testing';
import { Wallet } from 'ethers';
import { App } from './app';
import { NetworkService } from './network.service';
import { NETWORKS } from './network-config';
import { vi } from 'vitest';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
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
      .mockImplementation(() => {});
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
      'Aucun portefeuille autorisé pour signer cette transaction'
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
      getCode: vi.fn().mockResolvedValue('0x1234'),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: '0x0000000000000000000000000000000000000001',
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency, verified: true }
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
      'Solde natif insuffisant pour les frais de réseau'
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
      getCode: vi.fn().mockResolvedValue('0x1234'),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: '0x0000000000000000000000000000000000000001',
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency, verified: true }
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
      'Tous les prérequis sont vérifiés'
    );
    expect(app.transactionEnCours).toBe(false);
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
      'Aucun portefeuille autorisé pour signer cette transaction'
    );
    expect(request).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('sends when external session is authorized and balance is sufficient', async () => {
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
      getCode: vi.fn().mockResolvedValue('0x1234'),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: '0x0000000000000000000000000000000000000001',
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency, verified: true }
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

    expect(app.messageTransaction).toContain(
      'Tous les prérequis sont vérifiés'
    );
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
      getCode: vi.fn().mockResolvedValue('0x1234'),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: '0x0000000000000000000000000000000000000001',
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency, verified: true }
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

    expect(app.messageTransaction).toContain(
      'Solde natif insuffisant pour les frais de réseau'
    );
    expect(app.transactionEnCours).toBe(false);
    fixture.destroy();
  });

  it('does not send when RPC is unavailable', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';
    app.sessionWallet = {
      address: '0x3333333333333333333333333333333333333333'
    } as ReturnType<typeof Wallet.createRandom>;
    app.sessionAddress = app.sessionWallet.address;
    app.sessionAutorisee = true;
    (app as any).unlockedWallet = null;
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
      getCode: vi.fn(),
      destroy: vi.fn()
    };
    (app as any).rpcProvider = mockProvider;
    app.rpcConnected = true;

    Object.defineProperty(app, 'activeNetwork', {
      value: {
        ...NETWORKS['digevra-local'],
        dgvTokenAddress: '0x0000000000000000000000000000000000000001',
        nativeCurrency: { ...NETWORKS['digevra-local'].nativeCurrency, verified: true }
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
    await app.preparerEnvoi();

    expect(app.messageTransaction).toBe(
      'Le Chain ID RPC ne correspond pas au réseau sélectionné.'
    );
    expect(app.rpcConnected).toBe(false);
    expect(app.transactionEnCours).toBe(false);
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
      .mockImplementation(() => {});

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
