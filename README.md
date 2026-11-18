# DappFrontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.2.

## DIGEVRA V3 on GitHub Pages

The existing `Digevra-Dapp` repository deploys the Angular Wallet at
`https://dimitri-guekam.github.io/Digevra-Dapp/` and the independent static
Explorer at
`https://dimitri-guekam.github.io/Digevra-Dapp/explorer/`. Explorer routes use
URL fragments, so transaction and block detail links survive direct opening and
browser refresh on GitHub Pages.

The checked-in `public/digevra-config.js` currently selects `live` mode through
a temporary Cloudflare Quick Tunnel to the local, restricted Explorer proxy.
The proxy serves RPC and read-only indexer requests over HTTPS; the RPC accepts
only allowlisted methods and limits signed transaction broadcasts to six per
client per minute. The tunnel URL is temporary, has no uptime guarantee, and
depends on this PC, Besu, and the indexer remaining online. It is not permanent
infrastructure. If the tunnel restarts and its URL changes, update both
`rpcUrl` and `indexerApiUrl` in `public/digevra-config.js`, verify the HTTPS
endpoints, then rebuild and publish Pages. When the PC is off or the tunnel is
disconnected, Pages remains available but live balances, indexer history, and
transaction broadcasts do not.

The Pages build rejects missing, non-HTTPS, loopback, and private-network
endpoints in live mode; demo mode must keep both backend URLs empty. Never
publish admin RPC endpoints, keys, or credentials.

The wallet's USD estimate reads `dgvUsdIndicativeRate` from
`public/digevra-config.js`. It is currently configured to `0.25` (indicative
USD per DGV), an internal demonstration rate rather than an official market
quote. For example, 5,000 DGV is calculated as `$1,250.00`. Update that single
configuration value to change the rate. The display is labeled **Valeur
indicative** and is calculated from the selected wallet's live DGV balance or
its clearly stale verified snapshot; it is hidden with the balance privacy
toggle and is not shown for Sepolia.

### Public DIGEVRA snapshots and offline display

The wallet caches verified DIGEVRA data in browser storage, separately keyed by
Chain ID and wallet address. When the RPC is unavailable, the dashboard may show
that address's last complete snapshot with a visible **Données non actualisées**
label, synchronization time, and block number. It does not treat the snapshot as
live data, enable network actions, or use it for Sepolia. Browser storage is
device-local; viewing data on another device requires a manually published
static snapshot on Pages.

Only addresses listed in `public/snapshots/digevra/manifest.json` may be
published. That file is a public allowlist: authorize an address only after
deciding that its balance, transaction history, and verified sender/recipient
addresses may be public. Generate a snapshot from the running DIGEVRA RPC and a
ready, fully synchronized indexer:

```powershell
node .\scripts\update-digevra-snapshot.mjs --address 0x35b4336eF00eD099e030D29f925f2C69FD86b912
```

The script checks Chain ID `20261019`, the configured genesis hash, indexer
health and completeness, block hash, transaction contents and sender/recipient,
address relevance, duplicate hashes, block timestamps, and transaction receipts
before atomically writing
`public/snapshots/digevra/<address>.json`. It is read-only and does not publish,
commit, or send a transaction. Review the generated public JSON, then publish
only through a separately authorized Pages workflow. Never put keys or
recovery phrases in the snapshot. Sender and recipient addresses are public
blockchain data but remain identifying public activity; review them before
publishing.

To start a new temporary Cloudflare Quick Tunnel after verifying the local
services, run:

```powershell
.\scripts\start-digevra-test-tunnel.ps1
```

It checks Besu, genesis, indexer, and Explorer before forwarding HTTPS traffic to
the Explorer's rate-limited RPC proxy. The proxy permits only allowlisted reads,
fee estimation, and broadcasting already-signed transactions; it never receives
wallet keys, and administrative RPC methods are not allowed. The tunnel URL is
temporary, changes, and depends on the PC remaining on; it is not a production
endpoint or a replacement for persistently hosted Besu nodes. Besu is not
exposed directly.

Build and validate the same artifact used by GitHub Actions:

```powershell
npm ci
npx tsc -p tsconfig.spec.json --noEmit
npm test -- --watch=false
npm run test:explorer
npm run test:indexer
npm run test:snapshot-generator
npm run build:pages
```

The Pages workflow runs on pushes to `develop` and via manual dispatch. The
artifact is written to `dist/dapp-frontend/browser`.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Envoyer du DGV natif depuis le Wallet

Sur DIGEVRA Local, l’envoi natif utilise une transaction EVM `to` + `value`.
Le portefeuille doit être déverrouillé localement et son adresse doit
correspondre exactement à l’EOA qui détient les fonds. Avant d’afficher le
récapitulatif, l’interface vérifie le Chain ID, l’absence de code de contrat sur
l’expéditeur, le solde réel et les frais estimés. « Confirmer et envoyer » est
une étape distincte; après signature, le Wallet attend un reçu réussi et
actualise le solde.

Une adresse Smart Contract Wallet, une session DApp et un actif ERC-20 ne sont
pas utilisés pour ce transfert natif. Leur méthode d’exécution ou leur contrat
doit être vérifié avant de les prendre en charge.

## Préparer un transfert DGV local

Le script distinct `scripts/transfer-9000-dgv.mjs` prépare exactement
9 000 DGV vers le portefeuille DIGEVRA existant indiqué dans le script.
L’exécution par défaut est une simulation en lecture seule : elle vérifie le
Chain ID, les blocs, les soldes et les frais sans demander de clé privée et sans
diffuser de transaction.

```powershell
node .\scripts\transfer-9000-dgv.mjs --to 0x35b4336eF00eD099e030D29f925f2C69FD86b912
```

Après vérification manuelle et autorisation explicite, `--send` demande la clé
uniquement dans la console locale, sans écho, vérifie que l’adresse dérivée est
`0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75`, puis exige la confirmation
exacte `ENVOYER 9000 DGV À 0x35b4336eF00eD099e030D29f925f2C69FD86b912` avant
signature et diffusion. La commande d’envoi n’est pas exécutée par défaut.

Le script `scripts/transfer-dgv.mjs` est en simulation par défaut. Il demande une
adresse destinataire complète (`--to`), vérifie le RPC, le Chain ID, la
progression des blocs, l’adresse du signataire, le solde et les frais. Le secret
est demandé localement avec saisie masquée; il n’est accepté ni en argument, ni
dans une variable d’environnement, et n’est jamais imprimé.

```powershell
node scripts/transfer-dgv.mjs --to 0xADRESSE_COMPLETE_DU_WALLET
```

Le script privilégie un keystore chiffré existant :

```powershell
node scripts/transfer-dgv.mjs --to 0xADRESSE_COMPLETE_DU_WALLET --keystore C:\chemin\vers\keystore.json
```

La simulation n’envoie aucune transaction. Pour le transfert vers l’adresse
confirmée `0x35b4336eF00eD099e030D29f925f2C69FD86b912`, la commande de mode réel
est :

```powershell
node .\scripts\transfer-dgv.mjs --to 0x35b4336eF00eD099e030D29f925f2C69FD86b912 --send
```

Les options `--send` et `--broadcast` activent toutes deux le mode d’envoi, sans
changer la simulation par défaut. Le script prépare exactement 10 000 DGV et
le mode `--send` exige la saisie locale masquée de la clé, puis affiche le
récapitulatif actualisé et demande de saisir exactement
`ENVOYER 10000 DGV À 0x35b4336eF00eD099e030D29f925f2C69FD86b912` avant signature
et diffusion. La commande n’a pas été exécutée dans le cadre de cette
préparation. Un keystore chiffré existant peut remplacer la saisie de clé avec
`--keystore C:\chemin\vers\keystore.json`.

Les keystores, clés et fichiers secrets sont exclus de Git par `.gitignore`.
Les tests des scripts se lancent avec
`node --test scripts/transfer-*-dgv.test.mjs`; ils utilisent uniquement des
fournisseurs simulés, sans diffusion réseau.

## DIGEVRA Indexer (historique blockchain)

L’indexeur en lecture seule indexe les blocs et transferts natifs DIGEVRA dans
SQLite, récupère reçus et frais depuis Besu, reprend après redémarrage et
contrôle les réorganisations de chaîne. Il ne contient aucune clé et n’appelle
aucune méthode RPC administrative. Il requiert Node.js 22.13 ou supérieur.

Dans une fenêtre PowerShell, depuis le dossier du projet :

```powershell
$env:DIGEVRA_RPC_URL = 'http://127.0.0.1:9545'
$env:INDEXER_API_HOST = '127.0.0.1'
$env:INDEXER_API_PORT = '3001'
node .\indexer\main.mjs
```

Le RPC doit répondre et annoncer le Chain ID `20261019`. La base persistante est
créée dans `indexer\data\digevra.sqlite`. Pour reprendre uniquement depuis un
bloc précis, définissez `INDEXER_START_BLOCK` avant le démarrage; dans ce cas,
l’API indiquera `historyComplete: false`, même lorsque l’indexeur a rejoint la
tête de chaîne. L’historique n’est exhaustif qu’après indexation depuis le bloc
genesis et synchronisation jusqu’au dernier bloc.

Dans une deuxième fenêtre PowerShell, démarrez Angular :

```powershell
npm start
```

Dans une troisième fenêtre, démarrez DIGEVRA Explorer (interface indépendante
sur `http://localhost:4201`, réutilisant l’API du même indexeur) :

```powershell
npm run start:explorer
```

En développement, `proxy.conf.cjs` transmet `/api` à l’indexeur local et
`/besu-rpc` à Besu. Les routes de lecture disponibles sont :

- `GET /api/health` et `GET /api/stats`
- `GET /api/blocks?limit=25&offset=0`, `GET /api/blocks/:number` et
  `GET /api/blocks/hash/:hash`
- `GET /api/transactions?limit=25&offset=0`
- `GET /api/transactions/:hash`
- `GET /api/address/:address` et
  `GET /api/address/:address/transactions?limit=25&offset=0`

Les limites de pagination sont validées et plafonnées à 100 éléments par page.
Les montants et frais sont conservés sans perte de précision en wei. Sont
indexés les transferts natifs à valeur positive; les appels de contrats,
transferts ERC-20 et traces de transferts internes ne sont pas présentés comme
des transferts natifs. L’interface indique explicitement une indisponibilité,
une synchronisation en cours ou un historique partiel au lieu de déclarer à
tort qu’il n’existe aucune transaction.

DIGEVRA Explorer est une application indépendante servie sur
`http://localhost:4201`. Son serveur ne crée pas de base de données : il relaie
les requêtes GET vers l’indexeur et n’autorise via `/rpc` que `eth_chainId`,
`eth_blockNumber` et `eth_getBalance`. Les méthodes RPC d’écriture et les
requêtes HTTP d’écriture vers l’API sont refusées. Pour le lancement local,
l’indexeur et Besu doivent être accessibles sur les ports indiqués ci-dessus.
Les liens Wallet/Explorer partagent `explorer/routes.js` et utilisent des
fragments `#/transaction/:hash`, `#/block/:number` et `#/address/:address`.
Le fragment reste côté navigateur après une actualisation, ce qui évite les
réécritures de chemin requises par un hébergement statique tel que GitHub Pages.
Pour remplacer l’URL locale de l’Explorer, définir
`window.DIGEVRA_EXPLORER_URL` avant le démarrage du Wallet.

Les tests backend isolés, sans connexion à Besu ni transaction diffusée :

```powershell
node --test .\indexer\indexer.test.mjs .\indexer\api.test.mjs
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
