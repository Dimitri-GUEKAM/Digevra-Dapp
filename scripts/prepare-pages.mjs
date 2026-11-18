import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist/dapp-frontend/browser');
const explorerOutput = resolve(output, 'explorer');
const explorerFiles = [
  'index.html',
  'explorer.js',
  'routes.js',
  'styles.css'
];

await access(resolve(output, 'index.html'));
await access(resolve(output, 'digevra-config.js'));
await mkdir(explorerOutput, { recursive: true });

for (const file of explorerFiles) {
  await copyFile(
    resolve(root, 'explorer', file),
    resolve(explorerOutput, file)
  );
}

const walletHtml = await readFile(resolve(output, 'index.html'), 'utf8');
const explorerHtml = await readFile(resolve(explorerOutput, 'index.html'), 'utf8');
const config = await readFile(resolve(output, 'digevra-config.js'), 'utf8');
const configVersion = createHash('sha256').update(config).digest('hex').slice(0, 12);

function versionConfigScript(html, source) {
  const script = new RegExp(`<script src="${source}"></script>`, 'g');
  if ((html.match(script) ?? []).length !== 1) {
    throw new Error(`Expected exactly one runtime config script reference to ${source}.`);
  }
  return html.replace(script, `<script src="${source}?v=${configVersion}"></script>`);
}

const versionedWalletHtml = versionConfigScript(walletHtml, 'digevra-config.js');
const versionedExplorerHtml = versionConfigScript(explorerHtml, '../digevra-config.js');
await Promise.all([
  writeFile(resolve(output, 'index.html'), versionedWalletHtml),
  writeFile(resolve(explorerOutput, 'index.html'), versionedExplorerHtml)
]);

function readStringProperty(name) {
  const value = config.match(new RegExp(`\\b${name}:\\s*'([^']*)'`));
  if (!value) {
    throw new Error(`Pages runtime configuration is missing ${name}.`);
  }
  return value[1];
}

function assertPublicHttpsEndpoint(value, name) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid public HTTPS URL.`);
  }

  const hostname = endpoint.hostname.toLowerCase();
  const address = hostname.replace(/^\[|\]$/g, '');
  const privateIpv4 = isIP(address) === 4 && (() => {
    const [first, second, third] = address.split('.').map(Number);
    return first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && (third === 0 || third === 2)) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && (second === 18 || second === 19 || second === 51 && third === 100)) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224;
  })();
  const privateIpv6 = isIP(address) === 6 && (
    address === '::' ||
    address === '::1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe8') ||
    address.startsWith('fe9') ||
    address.startsWith('fea') ||
    address.startsWith('feb') ||
    address.startsWith('ff') ||
    !/^[23]/.test(address) ||
    address.startsWith('2001:db8:')
  );

  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    privateIpv4 ||
    privateIpv6
  ) {
    throw new Error(`${name} must be a public HTTPS endpoint, not a local or private address.`);
  }
}

if (!versionedWalletHtml.includes('<base href="/Digevra-Dapp/">')) {
  throw new Error('Wallet build has an unexpected GitHub Pages base href.');
}
if (!versionedExplorerHtml.includes('href="./styles.css"') ||
    !versionedExplorerHtml.includes('src="./explorer.js"')) {
  throw new Error('Explorer assets must use relative paths for GitHub Pages.');
}
if (!versionedWalletHtml.includes(`digevra-config.js?v=${configVersion}`) ||
    !versionedExplorerHtml.includes(`../digevra-config.js?v=${configVersion}`)) {
  throw new Error('Runtime configuration references must be cache-busted by content hash.');
}
if (!/\bchainId:\s*20261019\b/.test(config)) {
  throw new Error('Pages runtime configuration must use Chain ID 20261019.');
}

const deploymentMode = readStringProperty('deploymentMode');
const rpcUrl = readStringProperty('rpcUrl');
const indexerApiUrl = readStringProperty('indexerApiUrl');

if (deploymentMode === 'demo') {
  if (rpcUrl || indexerApiUrl) {
    throw new Error('Demo mode must not contain live RPC or indexer endpoints.');
  }
} else if (deploymentMode === 'live') {
  assertPublicHttpsEndpoint(rpcUrl, 'rpcUrl');
  assertPublicHttpsEndpoint(indexerApiUrl, 'indexerApiUrl');
} else {
  throw new Error('Pages deploymentMode must be either demo or live.');
}

console.log(`GitHub Pages artifact prepared: ${output}`);
