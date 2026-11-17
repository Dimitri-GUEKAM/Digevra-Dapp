import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
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

if (!walletHtml.includes('<base href="/Digevra-Dapp/">')) {
  throw new Error('Wallet build has an unexpected GitHub Pages base href.');
}
if (!explorerHtml.includes('href="./styles.css"') ||
    !explorerHtml.includes('src="./explorer.js"')) {
  throw new Error('Explorer assets must use relative paths for GitHub Pages.');
}
if (!/deploymentMode:\s*'demo'/.test(config) ||
    !/chainId:\s*20261019/.test(config) ||
    !/rpcUrl:\s*''/.test(config) ||
    !/indexerApiUrl:\s*''/.test(config)) {
  throw new Error('Pages must remain in demo mode until HTTPS backends are configured.');
}
if (/https?:\/\/(localhost|127\.0\.0\.1)/i.test(config)) {
  throw new Error('Public runtime configuration must not contain local endpoints.');
}

console.log(`GitHub Pages artifact prepared: ${output}`);
