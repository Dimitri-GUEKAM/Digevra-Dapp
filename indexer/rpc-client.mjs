export class JsonRpcClient {
  #id = 0;

  constructor(url, fetchImpl = fetch) {
    this.url = url;
    this.fetchImpl = fetchImpl;
  }

  async request(method, params = []) {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.#id,
        method,
        params
      }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status} for ${method}.`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw new Error(`RPC ${method} failed: ${payload.error.message ?? 'unknown error'}`);
    }
    if (!Object.hasOwn(payload, 'result')) {
      throw new Error(`RPC ${method} returned no result.`);
    }

    return payload.result;
  }

  async getChainId() {
    return Number(BigInt(await this.request('eth_chainId')));
  }

  async getBlockNumber() {
    return Number(BigInt(await this.request('eth_blockNumber')));
  }

  getBlock(number) {
    return this.request('eth_getBlockByNumber', [`0x${number.toString(16)}`, true]);
  }

  getTransactionReceipt(hash) {
    return this.request('eth_getTransactionReceipt', [hash]);
  }
}
