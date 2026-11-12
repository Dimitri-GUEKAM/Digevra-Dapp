import { TestBed } from '@angular/core/testing';
import { Wallet } from 'ethers';
import { App } from './app';
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

  it('should render the wallet dashboard', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Votre portefeuille DIGEVRA');
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

  it('does not send until the session is authorized', async () => {
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
    app.soldeDgv = 5;
    app.adresseDestinataire =
      '0x2222222222222222222222222222222222222222';
    app.montantEnvoi = 1.25;
    await app.preparerEnvoi();

    expect(app.messageTransaction).toBe(
      'La session doit être autorisée dans DIGEVRA Wallet.'
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
    expect(chargerWallet).toHaveBeenCalledOnce();
    fixture.destroy();
    localStorage.removeItem('digevra_connected_address');
  });
});
