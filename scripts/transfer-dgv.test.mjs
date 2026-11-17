import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'ethers';
import {
  EXPECTED_SENDER,
  TRANSFER_AMOUNT,
  executeTransfer,
  parseArguments,
  prepareTransfer,
  runTransfer
} from './transfer-dgv.mjs';

const recipient = '0x1111111111111111111111111111111111111111';

test('requires a full, valid, explicit recipient address', () => {
  assert.throws(() => parseArguments([]), /adresse complète et valide/);
  assert.throws(() => parseArguments(['--to', '0x1234']), /adresse complète et valide/);
  assert.throws(
    () => parseArguments(['--to', EXPECTED_SENDER]),
    /différent de l’expéditeur/
  );
  assert.equal(parseArguments(['--to', recipient]).recipient, recipient);
});

test('parses simulation as the default and real sending only as an explicit flag', () => {
  assert.equal(parseArguments(['--to', recipient]).broadcast, false);
  assert.equal(parseArguments(['--to', recipient, '--broadcast']).broadcast, true);
  assert.equal(parseArguments(['--to', recipient, '--send']).broadcast, true);
});

test('simulation checks the transfer plan without requesting confirmation or broadcasting', async () => {
  let signerLoads = 0;
  let confirmations = 0;
  let broadcasts = 0;
  let blockReads = 0;
  const provider = {
    getNetwork: async () => ({ chainId: 20261019n }),
    getBlockNumber: async () => (blockReads++ === 0 ? 100 : 102),
    getBalance: async (address) => address.toLowerCase() === EXPECTED_SENDER.toLowerCase()
      ? parseEther('500')
      : parseEther('2'),
    getFeeData: async () => ({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      gasPrice: null
    }),
    estimateGas: async () => 21_000n
  };
  const signer = {
    connect: () => signer,
    getAddress: async () => EXPECTED_SENDER,
    sendTransaction: async () => {
      broadcasts += 1;
      throw new Error('simulation must not broadcast');
    }
  };
  const output = [];
  const result = await runTransfer(
    parseArguments(['--to', recipient]),
    {
      provider,
      loadSigner: async () => {
        signerLoads += 1;
        return signer;
      },
      waitForProgress: async (_provider, initialBlock) => initialBlock + 1,
      confirm: async () => {
        confirmations += 1;
      },
      write: (message) => output.push(message)
    }
  );

  assert.equal(result.sent, false);
  assert.equal(result.plan.amount, TRANSFER_AMOUNT);
  assert.equal(signerLoads, 1);
  assert.equal(confirmations, 0);
  assert.equal(broadcasts, 0);
  assert.match(output.join(''), /SIMULATION — aucune transaction diffusée/);
});

test('prepares exactly 100 DGV when chain, block progress, and funds are verified', async () => {
  const provider = {
    getNetwork: async () => ({ chainId: 20261019n }),
    getBlockNumber: async () => 100,
    getBalance: async (address) => address.toLowerCase() === EXPECTED_SENDER.toLowerCase()
      ? parseEther('500')
      : parseEther('2'),
    getFeeData: async () => ({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      gasPrice: null
    }),
    estimateGas: async () => 21_000n
  };
  const signer = { getAddress: async () => EXPECTED_SENDER };
  const plan = await prepareTransfer(provider, signer, recipient, {
    waitForProgress: async (_provider, initialBlock) => initialBlock + 1
  });

  assert.equal(plan.amount, TRANSFER_AMOUNT);
  assert.equal(plan.chainId, 20261019n);
  assert.equal(plan.latestBlock, 101);
  assert.equal(plan.gasLimit, 25_200n);
  assert.equal(plan.estimatedFee, 50_400_000_000_000n);
});

test('refuses a signer that does not match the fixed sender', async () => {
  const provider = { getNetwork: async () => ({ chainId: 20261019n }) };
  const signer = { getAddress: async () => recipient };
  await assert.rejects(
    prepareTransfer(provider, signer, recipient),
    /ne correspond pas à l’adresse expéditrice/
  );
});

test('refuses the wrong chain ID before estimating a transfer', async () => {
  const provider = { getNetwork: async () => ({ chainId: 1n }) };
  const signer = { getAddress: async () => EXPECTED_SENDER };
  await assert.rejects(
    prepareTransfer(provider, signer, recipient),
    /Chain ID inattendu/
  );
});

test('refuses a transfer when blocks do not progress', async () => {
  const provider = {
    getNetwork: async () => ({ chainId: 20261019n }),
    getBlockNumber: async () => 100
  };
  const signer = { getAddress: async () => EXPECTED_SENDER };
  await assert.rejects(
    prepareTransfer(provider, signer, recipient, {
      waitForProgress: async (_provider, initialBlock) => initialBlock
    }),
    /production de nouveaux blocs/
  );
});

test('refuses insufficient amount-plus-fee balance', async () => {
  const provider = {
    getNetwork: async () => ({ chainId: 20261019n }),
    getBlockNumber: async () => 101,
    getBalance: async () => parseEther('100'),
    getFeeData: async () => ({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      gasPrice: null
    }),
    estimateGas: async () => 21_000n
  };
  const signer = { getAddress: async () => EXPECTED_SENDER };
  await assert.rejects(
    prepareTransfer(provider, signer, recipient, {
      waitForProgress: async (_provider, initialBlock) => initialBlock + 1
    }),
    /insuffisant/
  );
});

test('does not send if explicit confirmation is rejected', async () => {
  const signer = { sendTransaction: async () => assert.fail('must not send') };
  const plan = { recipient, amount: TRANSFER_AMOUNT };
  await assert.rejects(
    executeTransfer({
      provider: {},
      signer,
      plan,
      confirm: async () => {
        throw new Error('not confirmed');
      }
    }),
    /not confirmed/
  );
});

test('sends exactly 100 DGV after confirmation and verifies the recipient balance increase', async () => {
  const balanceBefore = parseEther('2');
  const provider = {
    getBalance: async () => balanceBefore + TRANSFER_AMOUNT
  };
  const transaction = {
    hash: `0x${'a'.repeat(64)}`,
    from: EXPECTED_SENDER,
    to: recipient,
    value: TRANSFER_AMOUNT,
    wait: async (confirmations) => {
      assert.equal(confirmations, 1);
      return { status: 1, blockNumber: 123 };
    }
  };
  const signer = {
    sendTransaction: async (request) => {
      assert.equal(request.to, recipient);
      assert.equal(request.value, parseEther('100'));
      return transaction;
    }
  };

  const result = await executeTransfer({
    provider,
    signer,
    plan: {
      signerAddress: EXPECTED_SENDER,
      recipient,
      amount: TRANSFER_AMOUNT,
      gasLimit: 25_200n,
      legacyGasPrice: 1_000n,
      recipientBalanceBefore: balanceBefore
    },
    confirm: async (confirmedRecipient) => {
      assert.equal(confirmedRecipient, recipient);
    },
    write: () => {}
  });

  assert.equal(result.receipt.status, 1);
  assert.equal(result.recipientBalanceIncrease, TRANSFER_AMOUNT);
});

test('reports a confirmed transfer if the recipient balance has not increased sufficiently', async () => {
  const transaction = {
    hash: `0x${'b'.repeat(64)}`,
    from: EXPECTED_SENDER,
    to: recipient,
    value: TRANSFER_AMOUNT,
    wait: async () => ({ status: 1, blockNumber: 124 })
  };
  await assert.rejects(
    executeTransfer({
      provider: { getBalance: async () => parseEther('1') },
      signer: { sendTransaction: async () => transaction },
      plan: {
        signerAddress: EXPECTED_SENDER,
        recipient,
        amount: TRANSFER_AMOUNT,
        gasLimit: 25_200n,
        legacyGasPrice: 1_000n,
        recipientBalanceBefore: parseEther('1')
      },
      confirm: async () => {},
      write: () => {}
    }),
    /n’a pas augmenté du montant transféré/
  );
});
