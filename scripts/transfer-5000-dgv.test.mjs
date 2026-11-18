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
  RECIPIENT_5000,
  TRANSFER_5000_AMOUNT
} from './transfer-5000-dgv.mjs';

test('fixes the 5000 DGV transfer to the requested existing wallet', () => {
  assert.equal(TRANSFER_5000_AMOUNT, parseEther('5000'));
  assert.equal(
    parseArguments(['--to', RECIPIENT_5000], EXPECTED_SENDER).recipient,
    RECIPIENT_5000
  );
});

test('simulates 5000 DGV without requesting a signing secret or broadcasting', async () => {
  let signerPromptCount = 0;
  let head = 30473;
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
    parseArguments(['--to', RECIPIENT_5000], EXPECTED_SENDER),
    {
      provider,
      expectedSender: EXPECTED_SENDER,
      amount: TRANSFER_5000_AMOUNT,
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
  assert.equal(result.plan.amount, parseEther('5000'));
  assert.equal(result.plan.senderBalance, parseEther('9979.078999998473211'));
  assert.equal(result.plan.recipientBalanceBefore, 0n);
  assert.equal(result.plan.estimatedFee, 25_200_000n);
  assert.equal(signerPromptCount, 0);
});
