import { explorerHash, explorerRoutePath } from './routes.js';

const content = document.querySelector('#content');
const message = document.querySelector('#global-message');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const walletLink = document.querySelector('#wallet-link');
const PAGE_SIZE = 10;
const runtimeConfig = globalThis.DIGEVRA_CONFIG ?? {};
const localDevelopment = location.port === '4201';
const configuredIndexerUrl = runtimeConfig.indexerApiUrl?.trim().replace(/\/+$/, '');
const indexerBaseUrl = configuredIndexerUrl || (localDevelopment ? '/api' : '');
const rpcEndpoint = runtimeConfig.rpcUrl?.trim() || (localDevelopment ? '/rpc' : '');

if (walletLink) {
  const configuredWalletUrl = runtimeConfig.walletUrl?.trim();
  if (configuredWalletUrl) {
    walletLink.href = configuredWalletUrl;
  } else if (localDevelopment) {
    const localWalletUrl = new URL(location.href);
    localWalletUrl.port = '4200';
    localWalletUrl.pathname = '/';
    localWalletUrl.search = '';
    localWalletUrl.hash = '';
    walletLink.href = localWalletUrl.toString();
  } else {
    walletLink.hidden = true;
  }
}

const api = async (path) => {
  if (!indexerBaseUrl) {
    throw new Error(
      'API d’indexation indisponible : ce déploiement de démonstration n’est connecté à aucun backend HTTPS.'
    );
  }
  const response = await fetch(`${indexerBaseUrl}${path}`, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `API indisponible (HTTP ${response.status}).`);
  if (!payload || typeof payload !== 'object') throw new Error('Réponse JSON invalide de l’indexeur.');
  return payload;
};

const rpc = async (method, params = []) => {
  if (!rpcEndpoint) {
    throw new Error(
      'RPC Besu indisponible : aucun endpoint HTTPS n’est configuré pour ce déploiement de démonstration.'
    );
  }
  const response = await fetch(rpcEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message ?? payload?.error ?? `RPC indisponible (${response.status}).`);
  return payload.result;
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const short = (value, left = 12, right = 8) =>
  value && value.length > left + right + 3 ? `${value.slice(0, left)}…${value.slice(-right)}` : value ?? '—';
const date = (seconds) => Number.isFinite(Number(seconds))
  ? new Date(Number(seconds) * 1000).toLocaleString()
  : '—';
const number = (value) => Number(value ?? 0).toLocaleString();
const link = (href, label, title = label) =>
  `<a class="hash-link mono" href="#${escapeHtml(href)}" title="${escapeHtml(title)}">${escapeHtml(label)}</a>`;
const status = (value) => `<span class="status ${value === 1 ? '' : 'failed'}">${value === 1 ? 'Confirmée' : 'Échouée'}</span>`;
const txHashLink = (hash) => link(explorerRoutePath('transaction', hash), short(hash), hash);
const blockLink = (block) => link(explorerRoutePath('block', block), number(block));
const addressLink = (address) => link(explorerRoutePath('address', address), short(address), address);
const wei = (value) => {
  try {
    const amount = BigInt(value);
    const whole = amount / 10n ** 18n;
    const fraction = (amount % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return '—';
  }
};

function showLoading(title = 'Chargement des données vérifiées…') {
  message.hidden = true;
  content.innerHTML = `<div class="panel loading">${escapeHtml(title)}</div>`;
}

function showError(error) {
  content.innerHTML = '';
  message.textContent = error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
  message.hidden = false;
}

function statsCards(data) {
  return `<div class="stats-grid">
    <article class="stat-card"><span class="stat-label">Dernier bloc RPC</span><strong class="stat-value">${number(data.chainHead)}</strong><small class="stat-hint">Hauteur lue depuis Besu</small></article>
    <article class="stat-card"><span class="stat-label">Blocs indexés</span><strong class="stat-value">${number(data.indexedBlocks)}</strong><small class="stat-hint">Depuis le bloc ${number(data.indexedFrom)}</small></article>
    <article class="stat-card"><span class="stat-label">Transactions natives indexées</span><strong class="stat-value">${number(data.indexedTransactions)}</strong><small class="stat-hint">Transferts à valeur positive</small></article>
    <article class="stat-card"><span class="stat-label">Indexeur</span><strong class="stat-value">${data.rpcConnected ? 'Connecté' : 'Déconnecté'}</strong><small class="stat-hint">${escapeHtml(data.state)} · ${data.historyComplete ? 'historique exhaustif' : 'historique partiel'}</small></article>
  </div>`;
}

function blockRows(blocks) {
  if (!blocks.length) return '<tr><td colspan="4" class="empty">Aucun bloc indexé disponible.</td></tr>';
  return blocks.map((block) => `<tr>
    <td>${blockLink(block.number)}</td><td>${link(explorerRoutePath('block', block.number), short(block.hash), block.hash)}</td>
    <td>${number(block.transactionCount)}</td><td>${date(block.timestamp)}</td>
  </tr>`).join('');
}

function txRows(transactions) {
  if (!transactions.length) return '<tr><td colspan="6" class="empty">Aucune transaction native indexée.</td></tr>';
  return transactions.map((tx) => `<tr>
    <td>${txHashLink(tx.hash)}</td><td>${addressLink(tx.from)}</td><td>${addressLink(tx.to)}</td>
    <td class="amount">${escapeHtml(tx.valueDgv)} DGV</td><td>${blockLink(tx.blockNumber)}</td><td>${status(tx.status)}</td>
  </tr>`).join('');
}

function tablePanel(title, route, headers, rows) {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2><a class="text-link" href="${explorerHash(route)}">Voir tout →</a></div>
    <div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

async function renderDashboard() {
  if (!indexerBaseUrl || !rpcEndpoint) {
    content.innerHTML = `<section class="panel demo-state" role="status">
      <h2>Mode démonstration</h2>
      <p>Aucun RPC Besu ni indexeur HTTPS public n’est configuré.</p>
      <p>Les blocs, soldes et transactions réels ne sont pas disponibles ici. Aucun historique fictif n’est affiché.</p>
      <div class="stats-grid">
        <article class="stat-card"><span class="stat-label">Chain ID attendu</span><strong class="stat-value">20261019</strong><small class="stat-hint">Non vérifié auprès d’un RPC</small></article>
        <article class="stat-card"><span class="stat-label">RPC Besu</span><strong class="stat-value">Indisponible</strong><small class="stat-hint">Endpoint HTTPS non configuré</small></article>
        <article class="stat-card"><span class="stat-label">Indexeur</span><strong class="stat-value">Indisponible</strong><small class="stat-hint">API HTTPS non configurée</small></article>
        <article class="stat-card"><span class="stat-label">Envoi de transactions</span><strong class="stat-value">Désactivé</strong><small class="stat-hint">Aucun réseau configuré</small></article>
      </div>
    </section>`;
    return;
  }
  showLoading();
  const [stats, blocks, transactions, chainId, head] = await Promise.all([
    api('/stats'), api(`/blocks?limit=5&offset=0`), api(`/transactions?limit=5&offset=0`),
    rpc('eth_chainId'), rpc('eth_blockNumber')
  ]);
  const actualChain = Number(BigInt(chainId));
  const actualHead = Number(BigInt(head));
  content.innerHTML = `
    <div class="page-heading"><div><h2 class="page-title">Vue d’ensemble</h2><p class="subtle">Données de l’indexeur local et du RPC Besu.</p></div><div class="network-badge"><span class="live-dot ${actualChain === 20261019 ? '' : 'offline'}"></span><span><strong>${actualChain === 20261019 ? 'RPC vérifié' : 'Chain ID inattendu'}</strong><small>Chain ID réel ${actualChain}</small></span></div></div>
    ${statsCards({ ...stats, chainHead: actualHead })}
    <div class="columns">
      ${tablePanel('Blocs récents', 'blocks', ['Bloc', 'Hash', 'Transactions', 'Horodatage'], blockRows(blocks.items))}
      ${tablePanel('Transactions récentes', 'transactions', ['Hash', 'Expéditeur', 'Destinataire', 'Montant', 'Bloc', 'Statut'], txRows(transactions.items))}
    </div>
    ${!stats.historyComplete ? '<p class="message">L’indexeur n’a pas encore confirmé un historique complet depuis le bloc genesis.</p>' : ''}
  `;
}

function pagination(page, total, kind, query = '') {
  const current = Math.floor(page / PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return `<nav class="pager" aria-label="Pagination">
    <button data-page="${Math.max(0, current - 1)}" ${current === 0 ? 'disabled' : ''}>Précédent</button>
    <span>Page ${current + 1} / ${pages} · ${number(total)} résultats</span>
    <button data-page="${current + 1}" ${current + 1 >= pages ? 'disabled' : ''}>Suivant</button>
  </nav>`;
}

async function renderBlocks(page = 0) {
  showLoading('Chargement des blocs indexés…');
  const data = await api(`/blocks?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
  content.innerHTML = `<div class="page-heading"><div><h2 class="page-title">Blocs</h2><p class="subtle">Blocs canoniques enregistrés dans l’indexeur.</p></div></div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Numéro</th><th>Hash</th><th>Hash parent</th><th>Transactions</th><th>Horodatage</th></tr></thead><tbody>${data.items.length ? data.items.map((block) => `<tr><td>${blockLink(block.number)}</td><td>${link(explorerRoutePath('block', block.number), short(block.hash), block.hash)}</td><td class="mono">${escapeHtml(short(block.parentHash))}</td><td>${number(block.transactionCount)}</td><td>${date(block.timestamp)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Aucun bloc indexé.</td></tr>'}</tbody></table></div>${pagination(data.pagination.offset, data.pagination.total, 'blocks')}</section>`;
  content.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
    location.hash = explorerRoutePath('blocks', button.dataset.page);
  }));
}

async function renderTransactions(page = 0) {
  showLoading('Chargement des transactions indexées…');
  const data = await api(`/transactions?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
  content.innerHTML = `<div class="page-heading"><div><h2 class="page-title">Transactions natives</h2><p class="subtle">Transferts natifs issus des blocs et reçus Besu.</p></div></div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Hash</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Bloc</th><th>Horodatage</th><th>Statut</th></tr></thead><tbody>${data.items.length ? data.items.map((tx) => `<tr><td>${txHashLink(tx.hash)}</td><td>${addressLink(tx.from)}</td><td>${addressLink(tx.to)}</td><td class="amount">${escapeHtml(tx.valueDgv)} DGV</td><td>${escapeHtml(tx.feeDgv)} DGV</td><td>${blockLink(tx.blockNumber)}</td><td>${date(tx.timestamp)}</td><td>${status(tx.status)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Aucune transaction native indexée.</td></tr>'}</tbody></table></div>${pagination(data.pagination.offset, data.pagination.total, 'transactions')}</section>`;
  content.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
    location.hash = explorerRoutePath('transactions', button.dataset.page);
  }));
}

function detailRows(pairs) {
  return `<div class="details-grid">${pairs.map(([label, value]) => `<div class="detail-row"><div class="detail-label">${escapeHtml(label)}</div><div class="detail-value">${value}</div></div>`).join('')}</div>`;
}

async function renderTransaction(hash) {
  showLoading('Chargement de la transaction indexée…');
  const tx = await api(`/transactions/${encodeURIComponent(hash)}`);
  content.innerHTML = `<div class="page-heading"><div><h2 class="page-title">Détails de la transaction</h2><p class="subtle mono">${escapeHtml(tx.hash)}</p></div>${status(tx.status)}</div>
    <section class="panel address-card">${detailRows([
      ['Hash', `<span class="mono">${escapeHtml(tx.hash)}</span>`],
      ['Statut du reçu', status(tx.status)],
      ['Bloc', blockLink(tx.blockNumber)],
      ['Index dans le bloc', escapeHtml(tx.transactionIndex)],
      ['Expéditeur', addressLink(tx.from)],
      ['Destinataire', addressLink(tx.to)],
      ['Montant', `<strong>${escapeHtml(tx.valueDgv)} DGV</strong>`],
      ['Frais réellement consommés', `${escapeHtml(tx.feeDgv)} DGV`],
      ['Gas utilisé', escapeHtml(tx.gasUsed)],
      ['Prix effectif du gas', `${escapeHtml(wei(tx.effectiveGasPriceWei))} DGV/gas`],
      ['Horodatage du bloc', escapeHtml(date(tx.timestamp))]
    ])}</section>`;
}

async function renderBlock(numberOrHash) {
  showLoading('Chargement du bloc indexé…');
  const block = await api(`/blocks/${encodeURIComponent(numberOrHash)}`);
  content.innerHTML = `<div class="page-heading"><div><h2 class="page-title">Bloc ${number(block.number)}</h2><p class="subtle">Données canoniques de l’indexeur.</p></div></div>
    <section class="panel address-card">${detailRows([
      ['Numéro', escapeHtml(block.number)],
      ['Hash', `<span class="mono">${escapeHtml(block.hash)}</span>`],
      ['Hash parent', `<span class="mono">${escapeHtml(block.parentHash)}</span>`],
      ['Horodatage', escapeHtml(date(block.timestamp))],
      ['Transactions dans le bloc', escapeHtml(block.transactionCount)]
    ])}</section>
    ${tablePanel('Transferts natifs indexés', 'transactions', ['Hash', 'Expéditeur', 'Destinataire', 'Montant', 'Statut'], txRows(block.transactions ?? []))}`;
}

async function renderAddress(address, page = 0) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('Adresse EVM invalide.');
  showLoading('Lecture du solde sur Besu et chargement de l’historique…');
  const [transactions, summary, balanceHex] = await Promise.all([
    api(`/address/${encodeURIComponent(address)}/transactions?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
    api(`/address/${encodeURIComponent(address)}`),
    rpc('eth_getBalance', [address, 'latest'])
  ]);
  const balance = wei(BigInt(balanceHex).toString());
  const incomingRows = transactions.items;
  content.innerHTML = `<div class="page-heading"><div><h2 class="page-title">Adresse</h2><p class="subtle mono">${escapeHtml(address)}</p></div></div>
    <section class="panel address-card"><div class="stat-label">Solde natif actuel (Besu RPC)</div><div class="balance">${escapeHtml(balance)} DGV</div><div class="subtle">Entrantes : ${number(summary.incomingTransactions)} · Sortantes : ${number(summary.outgoingTransactions)}</div></section>
    <section class="panel" style="margin-top:18px"><div class="panel-head"><h2>Historique de l’adresse</h2></div><div class="table-wrap"><table><thead><tr><th>Hash</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Bloc</th><th>Statut</th></tr></thead><tbody>${txRows(incomingRows)}</tbody></table></div>${pagination(transactions.pagination.offset, transactions.pagination.total, 'address')}</section>`;
  content.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
    location.hash = `${explorerRoutePath('address', address)}/${encodeURIComponent(button.dataset.page)}`;
  }));
}

async function universalSearch(value) {
  const query = value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
    location.hash = explorerRoutePath('address', query);
    return;
  }
  if (/^\d+$/.test(query)) {
    location.hash = explorerRoutePath('block', query);
    return;
  }
  if (/^0x[a-fA-F0-9]{64}$/.test(query)) {
    try {
      await api(`/transactions/${query}`);
      location.hash = explorerRoutePath('transaction', query);
      return;
    } catch {
      const block = await api(`/blocks/hash/${query}`);
      location.hash = explorerRoutePath('block', block.number);
      return;
    }
  }
  throw new Error('Entrez une adresse EVM, un hash 0x de 32 octets ou un numéro de bloc.');
}

async function renderRoute() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  const route = parts[0] ?? '';
  const page = Number(parts[1] ?? 0);
  try {
    message.hidden = true;
    if (!route) await renderDashboard();
    else if (route === 'blocks' && Number.isSafeInteger(page) && page >= 0) await renderBlocks(page);
    else if (route === 'transactions' && Number.isSafeInteger(page) && page >= 0) await renderTransactions(page);
    else if (route === 'block' && parts[1]) await renderBlock(parts[1]);
    else if (route === 'transaction' && parts[1]) await renderTransaction(parts[1]);
    else if (route === 'address' && parts[1]) await renderAddress(parts[1], Number(parts[2] ?? 0));
    else throw new Error('Page Explorer introuvable.');
  } catch (error) {
    showError(error);
  }
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  universalSearch(searchInput.value).catch(showError);
});
window.addEventListener('hashchange', () => void renderRoute());
void renderRoute();
