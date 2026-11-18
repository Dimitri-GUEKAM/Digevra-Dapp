import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAndSerializeTransaction } from './update-digevra-snapshot.mjs';

const address = '0x35b4336eF00eD099e030D29f925f2C69FD86b912';
const sender = '0xEe0a8b0441A0559760eC384313fcAf8cC582Bb75';
const hash = `0x${'a'.repeat(64)}`;
const item = {
  hash,
  blockNumber: 30698,
  transactionIndex: 0,
  timestamp: 1795011072,
  status: 1,
  valueWei: '5000000000000000000000',
  gasUsed: '21000',
  effectiveGasPriceWei: '1000',
  feeWei: '21000000'
};
const chain = {
  transaction: {
    hash,
    from: sender,
    to: address,
    blockNumber: '0x77ea',
    transactionIndex: '0x0',
    value: `0x${BigInt(item.valueWei).toString(16)}`,
    chainId: `0x${(20261019).toString(16)}`
  },
  receipt: {
    transactionHash: hash,
    blockNumber: '0x77ea',
    transactionIndex: '0x0',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x3e8',
    status: '0x1'
  },
  block: {
    number: '0x77ea',
    timestamp: `0x${item.timestamp.toString(16)}`
  }
};

describe('update-digevra-snapshot transaction verification', () => {
  it('serializes the transaction fields verified by Besu', () => {
    const transaction = verifyAndSerializeTransaction(item, chain, address);
    assert.deepEqual(transaction, {
      hash,
      from: sender,
      to: address,
      chainId: 20261019,
      blockNumber: 30698,
      transactionIndex: 0,
      direction: 'incoming',
      valueWei: '5000000000000000000000',
      valueDgv: '5000.0',
      gasUsed: '21000',
      effectiveGasPriceWei: '1000',
      feeWei: '21000000',
      feeDgv: '0.000000000021',
      status: 1,
      timestamp: 1795011072
    });
  });

  it('rejects transaction values that disagree with Besu', () => {
    assert.throws(
      () => verifyAndSerializeTransaction({ ...item, valueWei: '1' }, chain, address),
      /do not match Besu transaction/
    );
  });

  it('rejects transactions from another chain', () => {
    assert.throws(
      () => verifyAndSerializeTransaction(item, {
        ...chain,
        transaction: { ...chain.transaction, chainId: '0x1' }
      }, address),
      /belongs to Chain ID/
    );
  });
});
