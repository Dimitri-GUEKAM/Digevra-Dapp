import { afterEach, describe, expect, it, vi } from 'vitest';
import { MULTICHAIN_NETWORK_BY_ID } from '../config/networks';
import {
  BitcoinApiAdapter,
  isBitcoinMainnetAddress
} from './bitcoin.adapter';

describe('BitcoinApiAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts Bitcoin mainnet address formats and rejects testnet prefixes', () => {
    expect(isBitcoinMainnetAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(true);
    expect(isBitcoinMainnetAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toBe(true);
    expect(isBitcoinMainnetAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(false);
    expect(isBitcoinMainnetAddress('bc1mixedCASE')).toBe(false);
  });

  it('returns an actual zero balance from the API as zero BTC', async () => {
    const request: typeof fetch = async () => new Response(JSON.stringify({
      chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }
    }), { status: 200 });
    const adapter = new BitcoinApiAdapter(request);

    await expect(adapter.getNativeBalance(
      MULTICHAIN_NETWORK_BY_ID['bitcoin'],
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'
    )).resolves.toBe('0.0');
  });

  it('keeps network errors distinct from a zero balance', async () => {
    const request: typeof fetch = async () => new Response('{}', { status: 503 });
    const adapter = new BitcoinApiAdapter(request);

    await expect(adapter.getNativeBalance(
      MULTICHAIN_NETWORK_BY_ID['bitcoin'],
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'
    )).rejects.toThrow('API Bitcoin indisponible (HTTP 503).');
  });
});
