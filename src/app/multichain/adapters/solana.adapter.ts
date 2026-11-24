import { formatUnits } from 'ethers';
import { ChainAdapter } from './chain-adapter';
import {
  MultiChainNetworkConfig,
  TokenConfig
} from '../models/network';

const SOLANA_BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function isSolanaPublicKey(address: string): boolean {
  const value = address.trim();
  if (value.length < 32 || value.length > 44) return false;
  let decoded = 0n;
  for (const character of value) {
    const digit = SOLANA_BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let byteLength = 0;
  while (decoded > 0n) {
    byteLength += 1;
    decoded >>= 8n;
  }
  const leadingZeroBytes = [...value].findIndex((character) => character !== '1');
  return byteLength + (leadingZeroBytes < 0 ? value.length : leadingZeroBytes) === 32;
}

export class SolanaRpcAdapter implements ChainAdapter {
  constructor(private readonly request: typeof fetch = fetch) {}

  isValidAddress(address: string): boolean {
    return isSolanaPublicKey(address);
  }

  async getNativeBalance(
    network: MultiChainNetworkConfig,
    address: string
  ): Promise<string> {
    this.assertAddress(address);
    const result = await this.callRpc(network, 'getBalance', [
      address.trim(),
      { commitment: 'confirmed' }
    ]);
    if (!result || typeof result !== 'object' ||
      !isLamportValue((result as Record<string, unknown>)['value'])) {
      throw new Error('Réponse de solde Solana invalide.');
    }
    return formatUnits(
      BigInt((result as Record<string, unknown>)['value'] as string | number),
      network.nativeAsset.decimals
    );
  }

  async getTokenBalance(
    network: MultiChainNetworkConfig,
    address: string,
    token: TokenConfig
  ): Promise<string> {
    this.assertAddress(address);
    if (token.standard !== 'spl' || !isSolanaPublicKey(token.address)) {
      throw new Error(`Mint SPL invalide pour ${token.symbol}.`);
    }
    const result = await this.callRpc(network, 'getTokenAccountsByOwner', [
      address.trim(),
      { mint: token.address },
      { encoding: 'jsonParsed', commitment: 'confirmed' }
    ]);
    if (!isTokenAccountResult(result)) {
      throw new Error(`Réponse de solde SPL invalide pour ${token.symbol}.`);
    }
    let total = 0n;
    for (const account of result.value) {
      total += BigInt(account.account.data.parsed.info.tokenAmount.amount);
    }
    return formatUnits(total, token.decimals);
  }

  private assertAddress(address: string): void {
    if (!this.isValidAddress(address)) {
      throw new Error('Adresse Solana Mainnet-beta invalide.');
    }
  }

  private async callRpc(
    network: MultiChainNetworkConfig,
    method: string,
    params: unknown[]
  ): Promise<unknown> {
    if (!network.rpcUrl.trim()) {
      throw new Error(`RPC non configuré pour ${network.name}.`);
    }
    const response = await this.request(network.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params
      })
    });
    if (!response.ok) {
      throw new Error(`RPC Solana indisponible (HTTP ${response.status}).`);
    }
    const responseText = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(responseText) as unknown;
    } catch {
      throw new Error('Réponse JSON-RPC Solana invalide.');
    }
    if (!isRpcResponse(body)) {
      throw new Error('Réponse JSON-RPC Solana invalide.');
    }
    if (body.error) {
      throw new Error(`Erreur RPC Solana : ${body.error.message}`);
    }
    if (
      method === 'getBalance' &&
      body.result &&
      typeof body.result === 'object'
    ) {
      const rawLamports = responseText.match(/"value"\s*:\s*(\d+)/)?.[1];
      if (rawLamports) {
        return {
          ...(body.result as Record<string, unknown>),
          value: rawLamports
        };
      }
    }
    return body.result;
  }
}

function isRpcResponse(value: unknown): value is {
  result?: unknown;
  error?: { message: string };
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (!candidate['error'] ||
    (typeof candidate['error'] === 'object' &&
      typeof (candidate['error'] as Record<string, unknown>)['message'] === 'string')) &&
    ('result' in candidate || 'error' in candidate);
}

function isLamportValue(value: unknown): value is string | number {
  return typeof value === 'string'
    ? /^\d+$/.test(value)
    : Number.isSafeInteger(value) && Number(value) >= 0;
}

function isTokenAccountResult(value: unknown): value is {
  value: Array<{
    account: {
      data: {
        parsed: {
          info: {
            tokenAmount: {
              amount: string;
            };
          };
        };
      };
    };
  }>;
} {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>)['value'])) {
    return false;
  }
  return ((value as { value: unknown[] }).value).every((item) => {
    if (!item || typeof item !== 'object') return false;
    const account = (item as Record<string, unknown>)['account'];
    if (!account || typeof account !== 'object') return false;
    const data = (account as Record<string, unknown>)['data'];
    if (!data || typeof data !== 'object') return false;
    const parsed = (data as Record<string, unknown>)['parsed'];
    if (!parsed || typeof parsed !== 'object') return false;
    const info = (parsed as Record<string, unknown>)['info'];
    if (!info || typeof info !== 'object') return false;
    const tokenAmount = (info as Record<string, unknown>)['tokenAmount'];
    return !!tokenAmount &&
      typeof tokenAmount === 'object' &&
      /^\d+$/.test(String((tokenAmount as Record<string, unknown>)['amount']));
  });
}
