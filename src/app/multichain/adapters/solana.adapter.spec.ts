import { describe, expect, it, vi } from 'vitest';
import { MULTICHAIN_NETWORK_BY_ID } from '../config/networks';
import { isSolanaPublicKey, SolanaRpcAdapter } from './solana.adapter';

describe('SolanaRpcAdapter', () => {
  it('recognizes 32-byte mainnet public keys and rejects malformed addresses', () => {
    expect(isSolanaPublicKey('11111111111111111111111111111111')).toBe(true);
    expect(isSolanaPublicKey('not-a-solana-address')).toBe(false);
  });

  it('returns a verified zero balance from a successful JSON-RPC response', async () => {
    const request: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { context: { slot: 1 }, value: 0 }
    }), { status: 200 }));
    const adapter = new SolanaRpcAdapter(request);

    await expect(adapter.getNativeBalance(
      MULTICHAIN_NETWORK_BY_ID['solana'],
      '11111111111111111111111111111111'
    )).resolves.toBe('0.0');
    expect(request).toHaveBeenCalledOnce();
  });

  it('preserves lamport precision for balances beyond JavaScript safe integers', async () => {
    const request: typeof fetch = vi.fn(async () => new Response(
      '{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":90071992547409930}}',
      { status: 200 }
    ));
    const adapter = new SolanaRpcAdapter(request);

    await expect(adapter.getNativeBalance(
      MULTICHAIN_NETWORK_BY_ID['solana'],
      '11111111111111111111111111111111'
    )).resolves.toBe('90071992.54740993');
  });

  it('reports RPC failure without converting it into a zero balance', async () => {
    const request: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32005, message: 'rate limited' }
    }), { status: 200 }));
    const adapter = new SolanaRpcAdapter(request);

    await expect(adapter.getNativeBalance(
      MULTICHAIN_NETWORK_BY_ID['solana'],
      '11111111111111111111111111111111'
    )).rejects.toThrow('Erreur RPC Solana : rate limited');
  });
});
