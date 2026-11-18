import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'ethers';
import {
  EXPECTED_CHAIN_ID,
  EXPECTED_SENDER,
  parseArguments,
  runTransfer
} from './transfer-dgv.mjs';
import {
  RECIPIENT_9000,
  TRANSFER_9000_AMOUNT
} from './transfer-9000-dgv.mjs';

test('fixes the 9000 DGV transfer to the requested existing wallet', () => {
  assert.equal(TRANSFER_9000_AMOUNT, parseEther('9000'));
  assert.equal(
    parseArguments(['--to', RECIPIENT_9000], EXPECTED_SENDER).recipient,
    RECIPIENT_9000
  );
});

test('simulates 9000 DGV without requesting a signing secret or broadcasting', async () => {
  let signerPromptCount = 0;
  let head = 200;
  const provider = {
    getNetwork: async () => ({ chainId: EXPECTED_CHAIN_ID }),
    getBlockNumber: async () => head++,
    getBalance: async (address) => address.toLowerCase() === EXPECTED_SENDER.toLowerCase()
      ? parseEther('9979.078999998473211')
      : 0n,
    getFeeData: async () => ({
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      gasPrice: 1_000n
    }),
    estimateGas: async () => 21_000n
  };
  const result = await runTransfer(
    parseArguments(['--to', RECIPIENT_9000], EXPECTED_SENDER),
    {
      provider,
      expectedSender: EXPECTED_SENDER,
      amount: TRANSFER_9000_AMOUNT,
      requireSignerForSimulation: false,
      waitForProgress: async (_provider, initialBlock) => initialBlock + 1,
      loadSigner: async () => {
        signerPromptCount += 1;
        throw new Error('simulation must not request the signing secret');
      },
      confirm: async () => assert.fail('simulation must not ask for send confirmation'),
      write: () => {}
    }
  );

  assert.equal(result.sent, false);
  assert.equal(result.plan.amount, parseEther('9000'));
  assert.equal(result.plan.senderBalance, parseEther('9979.078999998473211'));
  assert.equal(result.plan.recipientBalanceBefore, 0n);
  assert.equal(result.plan.estimatedFee, 25_200_000n);
  assert.equal(signerPromptCount, 0);
});

test('send mode verifies the locally loaded signer against the fixed source before proceeding', async () => {
  let sendCount = 0;
  let signerPromptCount = 0;
  let head = 200;
  const provider = {
    getNetwork: async () => ({ chainId: EXPECTED_CHAIN_ID }),
    getBlockNumber: async () => head++,
    getBalance: async () => parseEther('10000'),
    getFeeData: async () => ({
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      gasPrice: 1_000n
    }),
    estimateGas: async () => 21_000n
  };
  const signer = {
    connect() { return this; },
    getAddress: async () => '0x1111111111111111111111111111111111111111',
    sendTransaction: async () => { sendCount += 1; }
  };

  await assert.rejects(
    runTransfer(
      parseArguments(['--to', RECIPIENT_9000, '--send'], EXPECTED_SENDER),
      {
        provider,
        expectedSender: EXPECTED_SENDER,
        amount: TRANSFER_9000_AMOUNT,
        requireSignerForSimulation: false,
        waitForProgress: async (_provider, initialBlock) => initialBlock + 1,
        loadSigner: async () => {
          signerPromptCount += 1;
          return signer;
        },
        write: () => {}
      }
    ),
    /ne correspond pas à l’adresse expéditrice/
  );
  assert.equal(signerPromptCount, 1);
  assert.equal(sendCount, 0);
});
