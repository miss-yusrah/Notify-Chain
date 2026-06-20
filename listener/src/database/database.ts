import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * SQLite Database Service
 * Handles all database operations with promise-based interface
 */
export class Database {
  private db: sqlite3.Database | null = null;
  private dbPath: string;
  private isInitialized: boolean = false;

  constructor(dbPath: string = './data/notifications.db') {
    this.dbPath = dbPath;
  }

  /**
   * Initialize database connection and run migrations
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Database already initialized');
      return;
    }

    try {
      // Ensure data directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info('Created database directory', { path: dbDir });
      }

      // Open database connection
      await this.connect();

      // Run schema migrations
      await this.runMigrations();

      this.isInitialized = true;
      logger.info('Database initialized successfully', { path: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize database', { error, path: this.dbPath });
      throw error;
    }
  }

  /**
   * Connect to SQLite database
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Failed to connect to database', { error: err, path: this.dbPath });
          reject(err);
        } else {
          logger.info('Connected to SQLite database', { path: this.dbPath });
          // Enable foreign keys
          this.db!.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      });
    });
  }

  /**
   * Run database migrations from schema.sql
   */
  private async runMigrations(): Promise<void> {
    const schemaPath = path.join(__dirname, 'schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Execute the schema as one script so trigger bodies with semicolons work.
    await this.exec(schema);

    logger.info('Database migrations completed');
  }

  /**
   * Execute a SQL query that modifies data (INSERT, UPDATE, DELETE)
   */
  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (err) {
        if (err) {
          logger.error('Database run error', { sql, params, error: err });
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * Execute a SQL query that returns a single row (SELECT)
   */
  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database get error', { sql, params, error: err });
          reject(err);
        } else {
          resolve(row as T);
        }
      });
    });
  }

  /**
   * Execute a SQL query that returns multiple rows (SELECT)
   */
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database all error', { sql, params, error: err });
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  /**
   * Execute a SQL script that may contain multiple statements.
   */
  async exec(sql: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.exec(sql, (err) => {
        if (err) {
          logger.error('Database exec error', { sql, error: err });
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Execute multiple statements in a transaction
   */
  async transaction(callback: () => Promise<void>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      await this.run('BEGIN TRANSACTION');
      await callback();
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      logger.error('Transaction rolled back', { error });
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) {
          logger.error('Failed to close database', { error: err });
          reject(err);
        } else {
          logger.info('Database connection closed');
          this.db = null;
          this.isInitialized = false;
          resolve();
        }
      });
    });
  }

  /**
   * Get database connection status
   */
  isConnected(): boolean {
    return this.isInitialized && this.db !== null;
  }
}

// Singleton instance
let dbInstance: Database | null = null;

/**
 * Get or create database singleton instance
 */
export function getDatabase(dbPath?: string): Database {
  if (!dbInstance) {
    const finalPath = dbPath || process.env.DATABASE_PATH || './data/notifications.db';
    dbInstance = new Database(finalPath);
  }
  return dbInstance;
}

/**
 * Initialize database (should be called on application startup)
 */
export async function initializeDatabase(dbPath?: string): Promise<Database> {
  const db = getDatabase(dbPath);
  await db.initialize();
  return db;
}
