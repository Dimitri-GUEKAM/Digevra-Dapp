import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function formatWei(wei) {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export class IndexStore {
  constructor(filename) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        number INTEGER PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        parent_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        transaction_count INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS indexed_transactions (
        hash TEXT PRIMARY KEY,
        block_number INTEGER NOT NULL REFERENCES blocks(number) ON DELETE CASCADE,
        transaction_index INTEGER NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        value_wei TEXT NOT NULL,
        gas_used TEXT NOT NULL,
        effective_gas_price_wei TEXT NOT NULL,
        fee_wei TEXT NOT NULL,
        status INTEGER NOT NULL CHECK (status IN (0, 1)),
        timestamp INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS transactions_block_order
        ON indexed_transactions(block_number DESC, transaction_index DESC);
      CREATE INDEX IF NOT EXISTS transactions_from_address
        ON indexed_transactions(lower(from_address), block_number DESC);
      CREATE INDEX IF NOT EXISTS transactions_to_address
        ON indexed_transactions(lower(to_address), block_number DESC);
      CREATE TABLE IF NOT EXISTS index_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
  }

  getTip() {
    return this.db.prepare(
      'SELECT number, hash FROM blocks ORDER BY number DESC LIMIT 1'
    ).get() ?? null;
  }

  getBlockHash(number) {
    return this.db.prepare('SELECT hash FROM blocks WHERE number = ?').get(number)?.hash ?? null;
  }

  rollbackFrom(number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM blocks WHERE number >= ?').run(number);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  saveBlock(block, transactions) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO blocks(number, hash, parent_hash, timestamp, transaction_count)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(number) DO UPDATE SET
          hash = excluded.hash,
          parent_hash = excluded.parent_hash,
          timestamp = excluded.timestamp,
          transaction_count = excluded.transaction_count
      `).run(
        block.number,
        block.hash.toLowerCase(),
        block.parentHash.toLowerCase(),
        block.timestamp,
        block.transactions.length
      );

      const insertTransaction = this.db.prepare(`
        INSERT INTO indexed_transactions(
          hash, block_number, transaction_index, from_address, to_address,
          value_wei, gas_used, effective_gas_price_wei, fee_wei, status, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hash) DO UPDATE SET
          block_number = excluded.block_number,
          transaction_index = excluded.transaction_index,
          from_address = excluded.from_address,
          to_address = excluded.to_address,
          value_wei = excluded.value_wei,
          gas_used = excluded.gas_used,
          effective_gas_price_wei = excluded.effective_gas_price_wei,
          fee_wei = excluded.fee_wei,
          status = excluded.status,
          timestamp = excluded.timestamp
      `);

      for (const transaction of transactions) {
        insertTransaction.run(
          transaction.hash.toLowerCase(),
          block.number,
          transaction.transactionIndex,
          transaction.from.toLowerCase(),
          transaction.to.toLowerCase(),
          transaction.valueWei,
          transaction.gasUsed,
          transaction.effectiveGasPriceWei,
          transaction.feeWei,
          transaction.status,
          block.timestamp
        );
      }

      this.db.prepare(`
        INSERT INTO index_metadata(key, value) VALUES ('indexed_from', ?)
        ON CONFLICT(key) DO NOTHING
      `).run(String(block.number));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getIndexedFrom(defaultValue = 0) {
    const value = this.db.prepare(
      "SELECT value FROM index_metadata WHERE key = 'indexed_from'"
    ).get()?.value;
    return value === undefined ? defaultValue : Number(value);
  }

  getCounts() {
    return {
      indexedBlocks: Number(this.db.prepare('SELECT COUNT(*) AS count FROM blocks').get().count),
      indexedTransactions: Number(
        this.db.prepare('SELECT COUNT(*) AS count FROM indexed_transactions').get().count
      )
    };
  }

  listBlocks(limit, offset) {
    const items = this.db.prepare(`
      SELECT number, hash, parent_hash AS parentHash, timestamp, transaction_count AS transactionCount
      FROM blocks ORDER BY number DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM blocks').get().count);
    return { items, total };
  }

  getBlock(number) {
    const block = this.db.prepare(`
      SELECT number, hash, parent_hash AS parentHash, timestamp, transaction_count AS transactionCount
      FROM blocks WHERE number = ?
    `).get(number);
    if (!block) return null;

    block.transactions = this.db.prepare(`
      SELECT * FROM indexed_transactions WHERE block_number = ?
      ORDER BY transaction_index ASC
    `).all(number).map(mapTransaction);
    return block;
  }

  getBlockByHash(hash) {
    const block = this.db.prepare(`
      SELECT number, hash, parent_hash AS parentHash, timestamp, transaction_count AS transactionCount
      FROM blocks WHERE hash = ?
    `).get(hash.toLowerCase());
    if (!block) return null;

    block.transactions = this.db.prepare(`
      SELECT * FROM indexed_transactions WHERE block_number = ?
      ORDER BY transaction_index ASC
    `).all(block.number).map(mapTransaction);
    return block;
  }

  listTransactions({ limit, offset, address, blockNumber } = {}) {
    const filters = [];
    const parameters = [];
    if (address) {
      filters.push('(lower(from_address) = ? OR lower(to_address) = ?)');
      parameters.push(address.toLowerCase(), address.toLowerCase());
    }
    if (blockNumber !== undefined) {
      filters.push('block_number = ?');
      parameters.push(blockNumber);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = Number(this.db.prepare(
      `SELECT COUNT(*) AS count FROM indexed_transactions ${where}`
    ).get(...parameters).count);
    const rows = this.db.prepare(`
      SELECT * FROM indexed_transactions ${where}
      ORDER BY block_number DESC, transaction_index DESC LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset);
    return { items: rows.map(mapTransaction), total: count };
  }

  getTransaction(hash) {
    const row = this.db.prepare(
      'SELECT * FROM indexed_transactions WHERE hash = ?'
    ).get(hash.toLowerCase());
    return row ? mapTransaction(row) : null;
  }

  getAddressSummary(address) {
    const canonical = address.toLowerCase();
    const incoming = Number(this.db.prepare(
      'SELECT COUNT(*) AS count FROM indexed_transactions WHERE lower(to_address) = ?'
    ).get(canonical).count);
    const outgoing = Number(this.db.prepare(
      'SELECT COUNT(*) AS count FROM indexed_transactions WHERE lower(from_address) = ?'
    ).get(canonical).count);
    return { address, incomingTransactions: incoming, outgoingTransactions: outgoing };
  }

  close() {
    this.db.close();
  }
}

function mapTransaction(row) {
  return {
    hash: row.hash,
    blockNumber: row.block_number,
    transactionIndex: row.transaction_index,
    from: row.from_address,
    to: row.to_address,
    valueWei: row.value_wei,
    valueDgv: formatWei(row.value_wei),
    gasUsed: row.gas_used,
    effectiveGasPriceWei: row.effective_gas_price_wei,
    feeWei: row.fee_wei,
    feeDgv: formatWei(row.fee_wei),
    status: row.status,
    timestamp: row.timestamp
  };
}
