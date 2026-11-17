export class BlockchainIndexer {
  constructor({ rpc, store, chainId, startBlock = 0 }) {
    this.rpc = rpc;
    this.store = store;
    this.chainId = chainId;
    this.startBlock = startBlock;
    this.status = {
      state: 'starting',
      rpcConnected: false,
      chainId: null,
      startBlock,
      indexedFrom: startBlock,
      lastIndexedBlock: null,
      chainHead: null,
      historyComplete: false,
      error: null,
      updatedAt: new Date().toISOString()
    };
    this.timer = null;
    this.running = false;
  }

  async syncOnce() {
    if (this.running) return this.status;
    this.running = true;
    this.status.state = 'syncing';
    this.status.error = null;
    this.status.updatedAt = new Date().toISOString();
    try {
      const actualChainId = await this.rpc.getChainId();
      this.status.chainId = actualChainId;
      if (actualChainId !== this.chainId) {
        this.status.rpcConnected = false;
        throw new Error(`Unexpected Chain ID ${actualChainId}; expected ${this.chainId}.`);
      }

      this.status.rpcConnected = true;
      const chainHead = await this.rpc.getBlockNumber();
      this.status.chainHead = chainHead;
      let tip = this.store.getTip();

      if (tip && this.store.getIndexedFrom(this.startBlock) !== this.startBlock) {
        throw new Error('Configured start block differs from the persisted index range.');
      }

      if (tip) {
        tip = await this.reconcileCanonicalChain(tip);
      }

      let nextBlock = tip ? tip.number + 1 : this.startBlock;
      while (nextBlock <= chainHead) {
        const block = await this.rpc.getBlock(nextBlock);
        if (!block || Number(BigInt(block.number)) !== nextBlock) {
          throw new Error(`RPC did not return expected block ${nextBlock}.`);
        }

        const nativeTransactions = [];
        for (let index = 0; index < block.transactions.length; index += 1) {
          const transaction = block.transactions[index];
          const value = BigInt(transaction.value);
          if (value <= 0n || !transaction.to || !transaction.from) continue;

          const receipt = await this.rpc.getTransactionReceipt(transaction.hash);
          if (!receipt || receipt.blockHash?.toLowerCase() !== block.hash.toLowerCase()) {
            throw new Error(`Receipt for ${transaction.hash} is missing or belongs to a different block.`);
          }
          const gasUsed = BigInt(receipt.gasUsed);
          const effectiveGasPrice = BigInt(
            receipt.effectiveGasPrice ?? transaction.gasPrice ?? '0x0'
          );
          if (effectiveGasPrice <= 0n || receipt.status === undefined) {
            throw new Error(`Receipt for ${transaction.hash} has incomplete fee or status data.`);
          }

          nativeTransactions.push({
            hash: transaction.hash,
            transactionIndex: Number(BigInt(transaction.transactionIndex ?? `0x${index.toString(16)}`)),
            from: transaction.from,
            to: transaction.to,
            valueWei: value.toString(),
            gasUsed: gasUsed.toString(),
            effectiveGasPriceWei: effectiveGasPrice.toString(),
            feeWei: (gasUsed * effectiveGasPrice).toString(),
            status: Number(BigInt(receipt.status)) === 1 ? 1 : 0
          });
        }

        this.store.saveBlock({
          number: nextBlock,
          hash: block.hash,
          parentHash: block.parentHash,
          timestamp: Number(BigInt(block.timestamp)),
          transactions: block.transactions
        }, nativeTransactions);
        this.status.lastIndexedBlock = nextBlock;
        this.status.updatedAt = new Date().toISOString();
        nextBlock += 1;
      }

      const tipAfterSync = this.store.getTip();
      this.status.lastIndexedBlock = tipAfterSync?.number ?? null;
      this.status.indexedFrom = this.store.getIndexedFrom(this.startBlock);
      const caughtUp = tipAfterSync?.number === chainHead;
      this.status.historyComplete = this.startBlock === 0 && caughtUp;
      this.status.state = caughtUp ? 'ready' : 'syncing';
      return this.status;
    } catch (error) {
      this.status.state = 'degraded';
      this.status.error = error instanceof Error ? error.message : 'Unknown indexer error.';
      this.status.updatedAt = new Date().toISOString();
      throw error;
    } finally {
      this.running = false;
    }
  }

  async reconcileCanonicalChain(tip) {
    const remoteTip = await this.rpc.getBlock(tip.number);
    if (remoteTip?.hash?.toLowerCase() === tip.hash.toLowerCase()) {
      return tip;
    }

    for (let number = tip.number - 1; number >= this.startBlock; number -= 1) {
      const storedHash = this.store.getBlockHash(number);
      const remoteBlock = await this.rpc.getBlock(number);
      if (storedHash && remoteBlock?.hash?.toLowerCase() === storedHash.toLowerCase()) {
        this.store.rollbackFrom(number + 1);
        return this.store.getTip();
      }
    }

    if (this.startBlock !== 0) {
      throw new Error('Chain reorganization predates configured start block; index range must be rebuilt.');
    }

    this.store.rollbackFrom(0);
    this.status.lastIndexedBlock = null;
    return null;
  }

  start(pollIntervalMs, onError = () => {}) {
    if (this.timer) return;
    const poll = async () => {
      try {
        await this.syncOnce();
      } catch (error) {
        onError(error);
      }
    };
    void poll();
    this.timer = setInterval(() => void poll(), pollIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
