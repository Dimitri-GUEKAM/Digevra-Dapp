import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { stdin, stdout } from 'node:process';
import {
  formatEther,
  getAddress,
  isAddress,
  JsonRpcProvider,
  parseEther,
  Wallet
} from 'ethers';

export const RPC_URL = 'http://127.0.0.1:9545';
export const EXPECTED_CHAIN_ID = 20261019n;
export const EXPECTED_SENDER = '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75';
export const TRANSFER_AMOUNT = parseEther('10000');
export const BLOCK_PROGRESS_TIMEOUT_MS = 30_000;
export const BLOCK_POLL_INTERVAL_MS = 2_000;

export function parseArguments(argv, expectedSender = EXPECTED_SENDER) {
  const parsed = { recipient: '', keystorePath: '', broadcast: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--broadcast' || argument === '--send') {
      parsed.broadcast = true;
      continue;
    }

    if (argument === '--to' || argument === '--keystore') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} nécessite une valeur.`);
      }
      index += 1;
      if (argument === '--to') {
        parsed.recipient = value;
      } else {
        parsed.keystorePath = value;
      }
      continue;
    }

    throw new Error(`Option inconnue : ${argument}`);
  }

  if (!parsed.recipient || !isAddress(parsed.recipient)) {
    throw new Error('Fournissez une adresse complète et valide avec --to.');
  }
  parsed.recipient = getAddress(parsed.recipient);

  if (parsed.recipient.toLowerCase() === expectedSender.toLowerCase()) {
    throw new Error('Le destinataire doit être différent de l’expéditeur.');
  }

  return parsed;
}

export async function waitForBlockProgress(
  provider,
  initialBlock,
  {
    timeoutMs = BLOCK_PROGRESS_TIMEOUT_MS,
    pollIntervalMs = BLOCK_POLL_INTERVAL_MS,
    now = Date.now,
    sleep = (duration) => new Promise((resolveSleep) => setTimeout(resolveSleep, duration))
  } = {}
) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const currentBlock = await provider.getBlockNumber();
    if (currentBlock > initialBlock) {
      return currentBlock;
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }

  throw new Error('Aucun nouveau bloc détecté dans le délai imparti; transfert interdit.');
}

export async function prepareTransfer(
  provider,
  signer,
  recipient,
  {
    waitForProgress = waitForBlockProgress,
    verifiedBlockProgress,
    expectedSender = EXPECTED_SENDER,
    amount = TRANSFER_AMOUNT
  } = {}
) {
  if (!isAddress(recipient)) {
    throw new Error('Adresse destinataire complète invalide.');
  }
  recipient = getAddress(recipient);

  const signerAddress = getAddress(await signer.getAddress());
  if (signerAddress.toLowerCase() !== expectedSender.toLowerCase()) {
    throw new Error('La clé locale ne correspond pas à l’adresse expéditrice attendue.');
  }
  if (recipient.toLowerCase() === signerAddress.toLowerCase()) {
    throw new Error('Le destinataire doit être différent de l’expéditeur.');
  }

  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Chain ID inattendu : reçu ${network.chainId}, attendu ${EXPECTED_CHAIN_ID}.`
    );
  }

  let latestBlock;
  if (verifiedBlockProgress) {
    if (verifiedBlockProgress.latestBlock <= verifiedBlockProgress.initialBlock) {
      throw new Error('La production de nouveaux blocs n’a pas été vérifiée; transfert interdit.');
    }
    latestBlock = await provider.getBlockNumber();
    if (latestBlock < verifiedBlockProgress.latestBlock) {
      throw new Error('La hauteur RPC a reculé depuis le contrôle des blocs; transfert interdit.');
    }
  } else {
    const initialBlock = await provider.getBlockNumber();
    latestBlock = await waitForProgress(provider, initialBlock);
    if (latestBlock <= initialBlock) {
      throw new Error('La production de nouveaux blocs n’a pas été vérifiée; transfert interdit.');
    }
  }

  const [senderBalance, recipientBalanceBefore, feeData, gasLimit] = await Promise.all([
    provider.getBalance(signerAddress),
    provider.getBalance(recipient),
    provider.getFeeData(),
    provider.estimateGas({
      from: signerAddress,
      to: recipient,
      value: amount
    })
  ]);

  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maxFeePerGas === null || maxFeePerGas === undefined || maxFeePerGas <= 0n) {
    throw new Error('Le RPC n’a pas fourni de frais réseau estimables; transfert interdit.');
  }

  const priorityFeePerGas = feeData.maxPriorityFeePerGas;
  if (
    feeData.maxFeePerGas !== null &&
    feeData.maxFeePerGas !== undefined &&
    (priorityFeePerGas === null || priorityFeePerGas === undefined)
  ) {
    throw new Error('Le RPC n’a pas fourni les frais EIP-1559 complets; transfert interdit.');
  }

  const bufferedGasLimit = (gasLimit * 120n + 99n) / 100n;
  const estimatedFee = bufferedGasLimit * maxFeePerGas;
  const totalRequired = amount + estimatedFee;
  if (senderBalance < totalRequired) {
    throw new Error('Solde expéditeur insuffisant pour le montant et les frais estimés.');
  }

  return {
    signerAddress,
    recipient,
    senderBalance,
    recipientBalanceBefore,
    latestBlock,
    chainId: network.chainId,
    gasLimit: bufferedGasLimit,
    maxFeePerGas,
    priorityFeePerGas,
    legacyGasPrice: feeData.maxFeePerGas == null ? feeData.gasPrice : null,
    estimatedFee,
    totalRequired,
    amount
  };
}

function promptHidden(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Une console interactive est requise pour la saisie masquée du secret.');
  }

  stdout.write(label);
  return new Promise((resolvePrompt, rejectPrompt) => {
    let value = '';
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          rejectPrompt(new Error('Saisie annulée.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolvePrompt(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

export async function loadSigner(keystorePath) {
  if (keystorePath) {
    let keystore;
    try {
      keystore = await readFile(resolve(keystorePath), 'utf8');
    } catch {
      throw new Error('Impossible de lire le keystore indiqué.');
    }

    const password = await promptHidden('Mot de passe du keystore (saisie masquée) : ');
    try {
      return await Wallet.fromEncryptedJson(keystore, password);
    } catch {
      throw new Error('Keystore illisible ou mot de passe incorrect.');
    }
  }

  const privateKey = await promptHidden('Clé privée de l’expéditeur (saisie masquée, jamais affichée) : ');
  try {
    return new Wallet(privateKey);
  } catch {
    throw new Error('La clé saisie n’est pas une clé privée EVM valide.');
  }
}

export function printSummary(plan, broadcast, write = (message) => stdout.write(message)) {
  write('\n');
  write('DIGEVRA — récapitulatif du transfert\n');
  write(`Mode : ${broadcast ? 'ENVOI après confirmation explicite' : 'SIMULATION — aucune transaction diffusée'}\n`);
  write(`Expéditeur : ${plan.signerAddress}\n`);
  write(`Destinataire : ${plan.recipient}\n`);
  write(`Chain ID : ${plan.chainId}\n`);
  write(`Dernier bloc observé : ${plan.latestBlock} (progression vérifiée)\n`);
  write(`Solde expéditeur : ${formatEther(plan.senderBalance)} DGV\n`);
  write(`Solde destinataire avant : ${formatEther(plan.recipientBalanceBefore)} DGV\n`);
  write(`Montant exact : ${formatEther(plan.amount)} DGV\n`);
  write(`Limite de gas estimée : ${plan.gasLimit.toString()}\n`);
  write(`Frais estimés (plafond) : ${formatEther(plan.estimatedFee)} DGV\n`);
  write(`Solde expéditeur requis (montant + frais) : ${formatEther(plan.totalRequired)} DGV\n`);
}

async function confirmBroadcast(recipient, amount = TRANSFER_AMOUNT) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Envoi refusé : confirmation interactive explicite requise.');
  }

  const confirmation = createInterface({ input: stdin, output: stdout });
  try {
    const amountText = formatEther(amount).replace(/\.0$/, '');
    const requiredText = `ENVOYER ${amountText} DGV À ${recipient}`;
    const answer = await confirmation.question(
      `Pour diffuser la transaction, saisissez exactement : ${requiredText}\n> `
    );
    if (answer !== requiredText) {
      throw new Error('Confirmation incorrecte; aucune transaction diffusée.');
    }
  } finally {
    confirmation.close();
  }
}

export async function executeTransfer({
  provider,
  signer,
  plan,
  confirm = (to, amount) => confirmBroadcast(to, amount),
  write = (message) => stdout.write(message)
}) {
  await confirm(plan.recipient, plan.amount);
  const transaction = await signer.sendTransaction({
    to: plan.recipient,
    value: plan.amount,
    gasLimit: plan.gasLimit,
    ...(plan.legacyGasPrice !== null
      ? { gasPrice: plan.legacyGasPrice }
      : {
          maxFeePerGas: plan.maxFeePerGas,
          maxPriorityFeePerGas: plan.priorityFeePerGas
        })
  });

  write(`Transaction diffusée : ${transaction.hash}\n`);
  const receipt = await transaction.wait(1);
  if (
    !receipt ||
    receipt.status !== 1 ||
    transaction.from.toLowerCase() !== plan.signerAddress.toLowerCase() ||
    transaction.to?.toLowerCase() !== plan.recipient.toLowerCase() ||
    transaction.value !== plan.amount
  ) {
    throw new Error('Reçu absent ou transaction confirmée différente du transfert demandé.');
  }

  const recipientBalanceAfter = await provider.getBalance(plan.recipient);
  const recipientBalanceIncrease = recipientBalanceAfter - plan.recipientBalanceBefore;
  if (recipientBalanceIncrease < plan.amount) {
    throw new Error('Le solde destinataire n’a pas augmenté du montant transféré après confirmation.');
  }
  write(`Transaction confirmée dans le bloc ${receipt.blockNumber}.\n`);
  write(`Augmentation du solde destinataire : ${formatEther(recipientBalanceIncrease)} DGV\n`);
  write(`Solde destinataire après confirmation : ${formatEther(recipientBalanceAfter)} DGV\n`);
  return { transaction, receipt, recipientBalanceAfter, recipientBalanceIncrease };
}

export async function runTransfer(
  args,
  {
    provider,
    loadSigner: getSigner = loadSigner,
    waitForProgress = waitForBlockProgress,
    confirm,
    write = (message) => stdout.write(message),
    expectedSender = EXPECTED_SENDER,
    amount = TRANSFER_AMOUNT,
    requireSignerForSimulation = true
  }
) {
  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Chain ID inattendu : reçu ${network.chainId}, attendu ${EXPECTED_CHAIN_ID}.`
    );
  }

  const initialBlock = await provider.getBlockNumber();
  const latestBlock = await waitForProgress(provider, initialBlock);
  const loadedSigner = args.broadcast || requireSignerForSimulation
    ? await getSigner(args.keystorePath)
    : { getAddress: async () => expectedSender };
  const signer = typeof loadedSigner.connect === 'function'
    ? loadedSigner.connect(provider)
    : loadedSigner;
  const plan = await prepareTransfer(provider, signer, args.recipient, {
    verifiedBlockProgress: { initialBlock, latestBlock },
    expectedSender,
    amount
  });

  printSummary(plan, args.broadcast, write);
  if (!args.broadcast) {
    return { plan, sent: false };
  }

  await executeTransfer({ provider, signer, plan, confirm, write });
  return { plan, sent: true };
}

async function main(argv) {
  const args = parseArguments(argv);
  const provider = new JsonRpcProvider(RPC_URL);

  try {
    await runTransfer(args, { provider });
  } finally {
    provider.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    stdout.write(`Arrêt sécurisé : ${error instanceof Error ? error.message : 'erreur inattendue'}\n`);
    process.exitCode = 1;
  });
}
