import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JsonRpcProvider, parseEther } from 'ethers';
import {
  EXPECTED_SENDER,
  loadSigner,
  parseArguments,
  RPC_URL,
  runTransfer
} from './transfer-dgv.mjs';

export const TRANSFER_5000_AMOUNT = parseEther('5000');
export const RECIPIENT_5000 = '0x35b4336eF00eD099e030D29f925f2C69FD86b912';

async function main(argv) {
  const args = parseArguments(argv, EXPECTED_SENDER);
  if (args.recipient !== RECIPIENT_5000) {
    throw new Error(`Le destinataire doit être ${RECIPIENT_5000}.`);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  try {
    await runTransfer(args, {
      provider,
      loadSigner,
      expectedSender: EXPECTED_SENDER,
      amount: TRANSFER_5000_AMOUNT,
      requireSignerForSimulation: false
    });
  } finally {
    provider.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `Arrêt sécurisé : ${error instanceof Error ? error.message : 'erreur inattendue'}\n`
    );
    process.exitCode = 1;
  });
}
