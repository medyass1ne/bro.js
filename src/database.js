/**
 * Base Database Adapter Contract for bro.js
 * Standardizes lifecycle, health checks, and transactions across different DB providers.
 */
export class BaseDatabaseAdapter {
  constructor(config = {}) {
    this.config = config;
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initializes the connection pool.
   * Expected to set this.pool and this.isConnected = true
   */
  async connect() {
    throw new Error('connect() must be implemented by the database adapter');
  }

  /**
   * Checks if the database is ready for queries.
   * @returns {Promise<boolean>}
   */
  async isReady() {
    return this.isConnected;
  }

  /**
   * Gracefully shuts down the connection pool with a deadline.
   * @param {number} deadlineMs Timeout in milliseconds
   */
  async shutdown(deadlineMs = 5000) {
    if (!this.isConnected) return;
    
    return Promise.race([
      this._performShutdown(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database shutdown timeout exceeded')), deadlineMs))
    ]);
  }

  async _performShutdown() {
    throw new Error('_performShutdown() must be implemented by the database adapter');
  }

  /**
   * Executes a callback within a managed transaction.
   * @param {Function} callback (trx) => Promise<any>
   */
  async healthCheck() {
    return await this.isReady();
  }

  async transaction(callback) {
    throw new Error('transaction() must be implemented by the database adapter');
  }
}

/**
 * Example Adapter for PostgreSQL (pg)
 */
export class PostgresAdapter extends BaseDatabaseAdapter {
  async connect() {
    let pg;
    try {
      pg = await import('pg');
    } catch (e) {
      throw new Error('Please install pg to use PostgresAdapter');
    }
    this.pool = new (pg.default?.Pool || pg.Pool)(this.config);
    await this.pool.query('SELECT 1');
    this.isConnected = true;
    return this.pool;
  }
  
  async _performShutdown() {
    if (this.pool) await this.pool.end();
    this.isConnected = false;
  }

  async isReady() {
    if (!this.isConnected || !this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async transaction(callback) {
    if (!this.isConnected || !this.pool) throw new Error('DB not connected');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
