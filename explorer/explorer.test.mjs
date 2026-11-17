import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('shows an honest demo dashboard without requesting fictitious blockchain data', async () => {
  const dom = new JSDOM(
    '<a id="wallet-link"></a><form id="search-form"><input id="search-input"></form><div id="global-message" hidden></div><section id="content"></section>',
    { url: 'https://dimitri-guekam.github.io/Digevra-Dapp/explorer/' }
  );
  const previousGlobals = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    fetch: globalThis.fetch,
    DIGEVRA_CONFIG: globalThis.DIGEVRA_CONFIG
  };
  let fetchCount = 0;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error('Demo page must not request blockchain data.');
  };
  globalThis.DIGEVRA_CONFIG = {
    deploymentMode: 'demo',
    chainId: 20261019,
    rpcUrl: '',
    indexerApiUrl: '',
    walletUrl: 'https://dimitri-guekam.github.io/Digevra-Dapp/',
    explorerUrl: 'https://dimitri-guekam.github.io/Digevra-Dapp/explorer/'
  };

  try {
    await import('./explorer.js?demo-mode-regression');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const content = document.querySelector('#content').textContent;
    assert.match(content, /Mode démonstration/);
    assert.match(content, /Aucun historique fictif n’est affiché/);
    assert.match(content, /Envoi de transactionsDésactivé/);
    assert.equal(fetchCount, 0);
    assert.equal(
      document.querySelector('#wallet-link').href,
      'https://dimitri-guekam.github.io/Digevra-Dapp/'
    );
  } finally {
    dom.window.close();
    for (const [name, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('renders block details with a working transactions link', async () => {
  const dom = new JSDOM(
    '<form id="search-form"><input id="search-input"></form><div id="global-message" hidden></div><section id="content"></section>',
    { url: 'http://localhost:4201/#/block/27640' }
  );
  const previousGlobals = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    fetch: globalThis.fetch,
    DIGEVRA_CONFIG: globalThis.DIGEVRA_CONFIG
  };
  const block = {
    number: 27640,
    hash: `0x${'a'.repeat(64)}`,
    parentHash: `0x${'b'.repeat(64)}`,
    timestamp: 1794831435,
    transactionCount: 1,
    transactions: []
  };

  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.fetch = async () => new Response(JSON.stringify(block), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  try {
    await import('./explorer.js?block-route-regression');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(document.querySelector('#content').textContent, /Bloc 27\s*640/);
    assert.equal(document.querySelector('#global-message').hidden, true);
    assert.equal(
      document.querySelector('#content a[href="#/transactions"]').textContent,
      'Voir tout →'
    );
  } finally {
    dom.window.close();
    for (const [name, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
