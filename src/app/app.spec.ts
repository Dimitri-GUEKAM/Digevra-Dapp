import { TestBed } from '@angular/core/testing';
import { HDNodeWallet, Wallet } from 'ethers';
import {
  App,
  formatDgvBalanceDisplay,
  formatIndicativeDgvUsd
} from './app';
import { NetworkService } from './network.service';
import { NETWORKS } from './network-config';
import { IndexerService } from './indexer.service';
import type { IndexedTransaction } from './indexer.service';
import { SnapshotService } from './snapshot.service';
import { afterEach, vi } from 'vitest';
import {
  PRIMARY_WALLET_ID,
  readStoredWalletAccounts,
  SELECTED_WALLET_STORAGE_KEY,
  WALLET_ACCOUNTS_STORAGE_KEY
} from './wallet-store';

describe('App', () => {
  let runtimeConfigBeforeTest = globalThis.DIGEVRA_CONFIG;

  beforeEach(async () => {
    runtimeConfigBeforeTest = globalThis.DIGEVRA_CONFIG;
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
          getStats: vi.fn().mockResolvedValue({
            state: 'ready',
            chainId: 20261019,
            rpcConnected: true,
            lastIndexedBlock: 100,
            chainHead: 100,
            historyComplete: true
          }),
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
      }, {
        provide: SnapshotService,
        useValue: {
          load: vi.fn().mockResolvedValue({ snapshot: null, warning: '' }),
          saveLocal: vi.fn(),
          readLocal: vi.fn().mockReturnValue(null)
        }
      }]
    })
      .compileComponents();
  });

  afterEach(() => {
    globalThis.DIGEVRA_CONFIG = runtimeConfigBeforeTest;
  });

  it('formats an indicative DGV conversion with dollars and grouped cents', () => {
    expect(formatIndicativeDgvUsd('5000', 0.25)).toBe('≈ $1,250.00');
    expect(formatIndicativeDgvUsd('1000', 0.25)).toBe('≈ $250.00');
    expect(formatIndicativeDgvUsd('0', 0.25)).toBe('≈ $0.00');
    expect(formatIndicativeDgvUsd('5000', 0.25015)).toBe('≈ $1,250.75');
    expect(formatIndicativeDgvUsd('5000', null)).toBeNull();
    expect(formatIndicativeDgvUsd('5000', 0)).toBeNull();
    expect(formatIndicativeDgvUsd('not-a-balance', 0.25)).toBeNull();
    expect(formatIndicativeDgvUsd('9007199254740993', 0.25))
      .toBe('≈ $2,251,799,813,685,248.25');
    expect(formatDgvBalanceDisplay('5000.0')).toBe('5 000');
    expect(formatDgvBalanceDisplay('1000000.250000')).toBe('1 000 000,25');
  });

  it('updates the indicative display with the live or matching snapshot balance only', () => {
    const config = globalThis.DIGEVRA_CONFIG;
    try {
      globalThis.DIGEVRA_CONFIG = {
        deploymentMode: 'demo',
        chainId: 20261019,
        rpcUrl: '',
        indexerApiUrl: '',
        walletUrl: null,
        explorerUrl: null,
        dgvUsdIndicativeRate: 0.25
      };
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      app.rpcConnected = true;
      app.soldeEth = '5000';
      expect(app.dgvUsdEstimatedValue).toBe('≈ $1,250.00');

      app.soldeEth = '6000';
      expect(app.dgvUsdEstimatedValue).toBe('≈ $1,500.00');
      globalThis.DIGEVRA_CONFIG = {
        ...globalThis.DIGEVRA_CONFIG!,
        dgvUsdIndicativeRate: 0.5
      };
      expect(app.dgvUsdEstimatedValue).toBe('≈ $3,000.00');
      app.soldeEth = '0';
      expect(app.dgvUsdEstimatedValue).toBe('≈ $0.00');
      globalThis.DIGEVRA_CONFIG = {
        ...globalThis.DIGEVRA_CONFIG!,
        dgvUsdIndicativeRate: 0.25
      };

      app.rpcConnected = false;
      app.adresseWallet = '0x35b4336eF00eD099e030D29f925f2C69FD86b912';
      app.snapshot = {
        schemaVersion: 1,
        chainId: 20261019,
        genesisHash: '0xb6448c0fac400f410a13813a9757faec163bb41d9a75e454466ba2c3116ed04e',
        lastBlockNumber: 30698,
        lastBlockHash: `0x${'a'.repeat(64)}`,
        syncedAt: '2026-01-01T00:00:00.000Z',
        address: app.adresseWallet,
        balanceWei: '5000000000000000000000',
        balanceDgv: '5000.0',
        historyComplete: true,
        transactions: []
      };
      expect(app.dgvUsdEstimatedValue).toBe('≈ $1,250.00');

      app.adresseWallet = '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75';
      expect(app.dgvUsdEstimatedValue).toBeNull();
      app.activeNetworkKey = 'ethereum-sepolia';
      expect(app.dgvUsdEstimatedValue).toBeNull();
      fixture.destroy();
    } finally {
      globalThis.DIGEVRA_CONFIG = config;
    }
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('displays a matching stale snapshot and keeps network actions disabled', async () => {
    const config = globalThis.DIGEVRA_CONFIG;
    globalThis.DIGEVRA_CONFIG = {
      deploymentMode: 'demo',
      chainId: 20261019,
      rpcUrl: '',
      indexerApiUrl: '',
      walletUrl: null,
      explorerUrl: null,
      dgvUsdIndicativeRate: 0.25
    };
    localStorage.removeItem('digevra_connected_address');
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    vi.spyOn(app, 'changerReseau').mockResolvedValue(undefined);
    app.walletConnecte = true;
    app.vueActive = 'wallet';
    app.adresseWallet = '0x35b4336eF00eD099e030D29f925f2C69FD86b912';
    app.snapshot = {
      schemaVersion: 1,
      chainId: 20261019,
      genesisHash: '0xb6448c0fac400f410a13813a9757faec163bb41d9a75e454466ba2c3116ed04e',
      lastBlockNumber: 30698,
      lastBlockHash: `0x${'a'.repeat(64)}`,
      syncedAt: '2026-01-01T00:00:00.000Z',
      address: app.adresseWallet,
      balanceWei: '5000000000000000000000',
      balanceDgv: '5000.0',
      historyComplete: true,
      transactions: []
    };
    fixture.detectChanges();
    await fixture.whenStable();
    app.soldeDgvDisplay = '5000.0';
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(app.snapshotVisible).toBe(true);
    expect(app.walletConnecte).toBe(true);
    expect(compiled.querySelector('.v3-balance-number')?.textContent)
      .toContain('5 000');
    expect(compiled.querySelector('.v3-snapshot-stale')?.textContent)
      .toContain('Données non actualisées');
    expect(compiled.querySelector('.v3-balance-fiat')?.textContent)
      .toContain('≈ $1,250.00');
    expect(compiled.querySelector('.v3-balance-fiat small')?.textContent)
      .toContain('Valeur indicative');
    expect(compiled.querySelector('.v3-action:not(.v3-coming-soon)')?.hasAttribute('disabled'))
      .toBe(true);
    expect(app.rpcConnected).toBe(false);
    fixture.destroy();
    globalThis.DIGEVRA_CONFIG = config;
  });

  it('does not expose a snapshot for a different selected address or network', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.adresseWallet = '0x35b4336eF00eD099e030D29f925f2C69FD86b912';
    app.snapshot = {
      schemaVersion: 1,
      chainId: 20261019,
      genesisHash: '0xb6448c0fac400f410a13813a9757faec163bb41d9a75e454466ba2c3116ed04e',
      lastBlockNumber: 30698,
      lastBlockHash: `0x${'a'.repeat(64)}`,
      syncedAt: '2026-01-01T00:00:00.000Z',
      address: '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75',
      balanceWei: '5000000000000000000000',
      balanceDgv: '5000.0',
      historyComplete: true,
      transactions: []
    };
    expect(app.snapshotVisible).toBe(false);
    app.snapshot.address = app.adresseWallet;
    app.activeNetworkKey = 'ethereum-sepolia';
    expect(app.snapshotVisible).toBe(false);
    fixture.destroy();
  });

  it('renders the DIGEVRA auth screen with all welcome options', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.auth-card h1')?.textContent)
      .toContain('WELCOME TO DIGEVRA');
    expect(compiled.querySelector('.auth-logo')?.getAttribute('src'))
      .toBe('digevra-logo.png');
    expect(compiled.querySelector('.auth-illustration')).toBeNull();
    expect(compiled.querySelector('.auth-card .auth-intro')?.textContent)
      .toContain('Votre passerelle vers un nouvel écosystème financier décentralisé.');
    expect(compiled.querySelector('.welcome-screen')).toBeNull();
    expect(compiled.querySelectorAll('.auth-options > .auth-primary, .auth-options > .auth-secondary'))
      .toHaveLength(2);
    expect(compiled.querySelector('.auth-login-prompt')?.textContent)
      .toContain('Déjà un compte ?');
    expect(compiled.querySelector('.auth-login-link')?.textContent)
      .toContain('Se connecter');
    expect(compiled.querySelector('.auth-back')).toBeNull();
    const settingsButton = compiled.querySelector(
      '.auth-settings-button'
    ) as HTMLButtonElement | null;
    expect(settingsButton?.textContent).toContain('Paramètres');
    settingsButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(compiled.querySelector('#auth-settings-panel')?.hasAttribute('hidden'))
      .toBe(false);
    expect(compiled.querySelector('.auth-settings-rpc-status')?.textContent)
      .toContain('Indisponible');
    expect(compiled.querySelector('.auth-settings-indexer-status')?.textContent)
      .toContain('Connecté');
    expect(compiled.querySelectorAll(
      '#auth-settings-panel input, #auth-settings-panel textarea'
    )).toHaveLength(0);
    fixture.destroy();
  });

  it('uses the DIGEVRA mark in the wallet header and balance card', () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.walletConnecte = true;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.v3-brand-logo')?.getAttribute('src'))
      .toBe('digevra-mark.png');
    expect(compiled.querySelector('.v3-balance-art')?.getAttribute('src'))
      .toBe('digevra-mark.png');
    fixture.destroy();
  });

  it('opens the configured local Explorer from the Wallet', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    app.walletConnecte = true;
    fixture.detectChanges();

    const explorerButton = fixture.nativeElement.querySelector(
      '.v3-explorer-banner button'
    ) as HTMLButtonElement | null;
    expect(explorerButton?.textContent).toContain('Explorer maintenant');
    explorerButton?.click();

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

  it('preserves the legacy vault while adding watch, private-key, and selected mnemonic accounts', async () => {
    const storageKeys = [
      'digevra_vault_v1',
      WALLET_ACCOUNTS_STORAGE_KEY,
      SELECTED_WALLET_STORAGE_KEY
    ];
    const previousStorage = new Map(
      storageKeys.map((key) => [key, localStorage.getItem(key)])
    );
    const password = 'multi-wallet test password only';
    const primary = new Wallet(`0x${'2'.repeat(64)}`);
    const encryptedPrimary = await primary.encrypt(password);
    const privateKey = `0x${'1'.repeat(64)}`;
    const importedPrivateWallet = new Wallet(privateKey);
    const testPhrase = 'test test test test test test test test test test test junk';
    const phraseAccount0 = new Wallet(`0x${'3'.repeat(64)}`);
    const phraseAccount1 = new Wallet(`0x${'4'.repeat(64)}`);
    const phraseDerivation = vi.spyOn(HDNodeWallet, 'fromPhrase')
      .mockImplementation((_phrase, _password, path) =>
        (path?.endsWith('/0') ? phraseAccount0 : phraseAccount1) as unknown as HDNodeWallet
      );
    localStorage.setItem('digevra_vault_v1', encryptedPrimary);
    localStorage.removeItem(WALLET_ACCOUNTS_STORAGE_KEY);
    localStorage.removeItem(SELECTED_WALLET_STORAGE_KEY);

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const networkService = TestBed.inject(NetworkService);
    const indexerService = TestBed.inject(IndexerService);
    const provider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 20261019n }),
      destroy: vi.fn()
    };
    vi.mocked(networkService.getNativeBalance).mockImplementation(
      async (_provider, address) => address.toLowerCase() ===
        importedPrivateWallet.address.toLowerCase()
        ? '2.5'
        : '1.25'
    );
    (app as unknown as { rpcProvider: typeof provider }).rpcProvider = provider;
    app.rpcConnected = true;
    try {
      app.authPassword = password;
      await app.deverrouiller();
      expect(app.vaultUnlocked).toBe(true);
      expect(app.walletAccounts).toHaveLength(1);
      expect(app.walletAccounts[0].address).toBe(primary.address);
      expect(app.adresseWallet).toBe(primary.address);

      app.ouvrirGestionnairePortefeuilles();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.wallet-manager-panel'))
        .toBeTruthy();

      app.ouvrirAjoutPortefeuille('watch');
      app.walletNameInput = 'Lecture seule';
      app.walletAddressInput = '0x0000000000000000000000000000000000000022';
      await app.ajouterPortefeuille();
      app.rpcConnected = true;
      (app as unknown as { rpcProvider: typeof provider }).rpcProvider = provider;
      await app.chargerSoldePortefeuilles();
      const watch = app.walletAccounts.find((account) => account.kind === 'watch');
      expect(watch).toBeTruthy();
      expect(networkService.getNativeBalance).toHaveBeenCalled();
      expect(watch?.balanceDgv).toBe('1.25');
      expect(app.activeWalletReadOnly).toBe(true);
      app.ouvrirEnvoi();
      expect(app.panneauTransfert).toBe('aucun');
      expect(app.messageTransaction).toContain('lecture seule');

      app.ouvrirAjoutPortefeuille('private-key');
      app.walletNameInput = 'Clé de test';
      app.walletPrivateKeyInput = privateKey;
      app.previsualiserClePrivee();
      expect(app.walletPrivateKeyPreview).toBe(importedPrivateWallet.address);
      app.walletVaultPassword = password;
      await app.ajouterPortefeuille();
      const privateAccount = app.walletAccounts.find(
        (account) => account.kind === 'private-key'
      );
      expect(privateAccount?.address).toBe(importedPrivateWallet.address);
      expect(privateAccount?.balanceDgv).toBe('2.5');
      expect(app.adresseWallet).toBe(importedPrivateWallet.address);

      app.ouvrirAjoutPortefeuille('mnemonic');
      app.walletNameInput = 'Récupération de test';
      app.walletMnemonicInput = testPhrase;
      app.previsualiserPhrase();
      expect(app.walletMnemonicPreviews.map((entry) => entry.address))
        .toContain(phraseAccount0.address);
      expect(app.walletMnemonicPreviews.map((entry) => entry.address))
        .toContain(phraseAccount1.address);
      app.walletMnemonicPreviews.forEach((entry) => {
        entry.selected = entry.index < 2;
      });
      app.walletVaultPassword = password;
      await app.ajouterPortefeuille();
      const mnemonicAccounts = app.walletAccounts.filter(
        (account) => account.kind === 'mnemonic'
      );
      expect(mnemonicAccounts.map((account) => account.address))
        .toEqual([phraseAccount0.address, phraseAccount1.address]);
      expect(app.walletAccounts).toHaveLength(5);
      expect(app.walletAccounts.find(
        (account) => account.id === PRIMARY_WALLET_ID
      )?.address).toBe(primary.address);
      expect(app.selectedWalletId).toBe(mnemonicAccounts[0].id);
      expect(app.adresseWallet).toBe(phraseAccount0.address);

      const persisted = readStoredWalletAccounts(localStorage);
      expect(persisted).toHaveLength(5);
      expect(persisted.find((account) => account.kind === 'watch')?.encryptedJson)
        .toBeUndefined();
      expect(persisted.filter(
        (account) => account.kind === 'private-key' || account.kind === 'mnemonic'
      ).every((account) => Boolean(account.encryptedJson))).toBe(true);
      const persistedText = localStorage.getItem(WALLET_ACCOUNTS_STORAGE_KEY) ?? '';
      expect(persistedText).not.toContain(privateKey);
      expect(persistedText).not.toContain(testPhrase);
      expect(localStorage.getItem('digevra_vault_v1')).toBe(encryptedPrimary);
      expect(localStorage.getItem(SELECTED_WALLET_STORAGE_KEY))
        .toBe(mnemonicAccounts[0].id);

      await app.selectionnerPortefeuille(PRIMARY_WALLET_ID);
      expect(app.adresseWallet).toBe(primary.address);
      await app.selectionnerPortefeuille(watch!.id);
      expect(app.activeWalletReadOnly).toBe(true);
      await app.chargerHistorique(0);
      expect(indexerService.getAddressTransactions)
        .toHaveBeenLastCalledWith(watch!.address, 10, 0);

      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.wallet-manager-trigger'))
        .toBeTruthy();
      expect(fixture.nativeElement.textContent).toContain('Lecture seule');
      app.verrouiller();
      expect(app.vaultUnlocked).toBe(false);
      expect(app.walletAccounts).toHaveLength(0);
      expect(app.walletPrivateKeyInput).toBe('');
      expect(app.walletMnemonicInput).toBe('');
      expect(localStorage.getItem('digevra_vault_v1')).toBe(encryptedPrimary);

      app.authPassword = password;
      await app.deverrouiller();
      expect(app.vaultUnlocked).toBe(true);
      expect(app.selectedWalletId).toBe(watch!.id);
      await app.selectionnerPortefeuille(privateAccount!.id);
      expect(app.adresseWallet).toBe(importedPrivateWallet.address);
      await app.selectionnerPortefeuille(mnemonicAccounts[1].id);
      expect(app.adresseWallet).toBe(phraseAccount1.address);
    } finally {
      fixture.destroy();
      phraseDerivation.mockRestore();
      for (const [key, value] of previousStorage) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }
  }, 30000);

  it('renders the wallet home sections in the requested order with four tactile actions', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.walletConnecte = true;
    app.adresseWallet = '0x1111111111111111111111111111111111111111';

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const orderedSections = [
      compiled.querySelector('.v3-topbar'),
      compiled.querySelector('.v3-balance'),
      compiled.querySelector('.v3-actions'),
      compiled.querySelector('.v3-recent'),
      compiled.querySelector('.v3-explorer-banner'),
      compiled.querySelector('.v3-mobile-nav')
    ];
    expect(orderedSections.every((section) => section !== null)).toBe(true);
    for (let index = 0; index < orderedSections.length - 1; index += 1) {
      expect(
        orderedSections[index]!.compareDocumentPosition(orderedSections[index + 1]!)
          & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(compiled.querySelector('.v3-network')).toBeNull();
    expect(compiled.querySelector('.v3-explorer-banner')).toBeTruthy();
    expect(compiled.querySelector('.v3-greeting')?.textContent)
      .toContain('Bienvenue sur DIGEVRA.');
    expect(compiled.querySelector('.v3-balance-toggle')).toBeTruthy();
    expect(compiled.querySelector('.network-pill')).toBeNull();
    expect(compiled.querySelector('.v3-content')?.textContent)
      .not.toContain(app.adresseWallet);

    expect(compiled.querySelectorAll('.v3-actions .v3-action')).toHaveLength(4);
    expect(compiled.querySelector('.v3-coming-soon[aria-label="Swapper, bientôt disponible"]'))
      .toBeTruthy();
    expect(compiled.querySelector('.v3-coming-soon[aria-label="Acheter, bientôt disponible"]'))
      .toBeTruthy();
    expect(Array.from(compiled.querySelectorAll('.v3-mobile-nav button'))
      .map((button) => button.textContent?.trim()))
      .toEqual(['⌂Accueil', '◷Portefeuille', '◇NFT', '•••Plus']);
    fixture.destroy();
  });

  it('shows an accessible coming-soon message for the NFT navigation item', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.afficherBientotDisponible('NFT');

    expect(app.messageNavigation).toBe('NFT — bientôt disponible.');
    fixture.destroy();
  });

  it('shows an accessible notification status from the header action', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.afficherNotifications();

    expect(app.messageNavigation).toBe('Aucune nouvelle notification.');
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
    const transaction = {
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
    } satisfies IndexedTransaction;
    const receivedTransaction = {
      ...transaction,
      hash: `0x${'b'.repeat(64)}`,
      from: '0x3333333333333333333333333333333333333333',
      to: app.adresseWallet,
      valueDgv: '1.2'
    } satisfies IndexedTransaction;
    app.transactions = [transaction, receivedTransaction];

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const recent = fixture.nativeElement.querySelector('.v3-recent') as HTMLElement;
    expect(recent.querySelectorAll('.v3-tx')).toHaveLength(2);
    expect(recent.textContent).toContain('Envoi');
    expect(recent.textContent).toContain('-0.01 DGV');
    expect(recent.textContent).toMatch(/bloc 123/i);
    expect(recent.textContent).toContain('Frais : 0.000000000021 DGV');
    expect(recent.querySelector('.v3-tx-icon.sent')).toBeTruthy();
    expect(recent.querySelector('.v3-tx-value.sent')).toBeTruthy();
    expect(recent.querySelector('.v3-tx-icon.received')).toBeTruthy();
    expect(recent.querySelector('.v3-tx-value.received')?.textContent)
      .toContain('+1.2 DGV');
    expect(recent.textContent).toContain('Confirmée');
    const endpoints = recent.querySelectorAll('.v3-tx-address');
    expect(endpoints).toHaveLength(4);
    expect(endpoints[0].textContent).toContain('De');
    expect(endpoints[0].textContent).toContain('0x111111');
    expect(endpoints[1].textContent).toContain('Vers');
    expect(endpoints[1].textContent).toContain('0x222222');
    expect(endpoints[2].textContent).toContain('0x333333');
    expect(endpoints[3].textContent).toContain('0x111111');

    vi.mocked(TestBed.inject(IndexerService).getAddressTransactions)
      .mockResolvedValue({
        items: [transaction],
        pagination: { limit: 10, offset: 0, total: 1, hasMore: false },
        indexer: {
          state: 'ready',
          startBlock: 0,
          lastIndexedBlock: 123,
          chainHead: 123,
          historyComplete: true
        }
      });

    app.vueActive = 'activite';
    await app.chargerHistorique();
    fixture.detectChanges();
    const historyEndpoints = fixture.nativeElement.querySelectorAll(
      '.activity-addresses code'
    );
    expect(historyEndpoints).toHaveLength(2);
    expect(historyEndpoints[0].textContent).toContain('0x111111');
    expect(historyEndpoints[1].textContent).toContain('0x222222');
    fixture.destroy();
  });

  it('masks the balance display without changing its source value', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.walletConnecte = true;
    fixture.detectChanges();
    await fixture.whenStable();

    const toggle = fixture.nativeElement.querySelector(
      '.v3-balance-toggle'
    ) as HTMLButtonElement;
    const sourceBalance = app.soldeDgvDisplay;
    toggle.click();
    fixture.detectChanges();
    expect(app.soldeMasque).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Afficher le solde');
    expect(fixture.nativeElement.querySelector('.v3-balance-number')
      ?.textContent).toContain('••••••');

    toggle.click();
    fixture.detectChanges();
    expect(app.soldeMasque).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Masquer le solde');
    expect(app.soldeDgvDisplay).toBe(sourceBalance);
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
    app.vaultExists = false;
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
      genesisHash: config.genesisHash ?? null,
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
      getBlock: vi.fn().mockResolvedValue({
        hash: NETWORKS['digevra-local'].genesisHash
      }),
      getCode: vi.fn().mockResolvedValue('0x'),
      destroy: vi.fn()
    };
    vi.spyOn(networkService, 'connect').mockResolvedValue({
      provider: provider as never,
      chainId: 20261019,
      blockNumber: 127,
      genesisHash: NETWORKS['digevra-local'].genesisHash ?? null,
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
