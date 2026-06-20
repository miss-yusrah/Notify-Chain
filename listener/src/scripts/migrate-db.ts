#!/usr/bin/env ts-node
/**
 * Database migration script
 * Run this to initialize or update the database schema
 * 
 * Usage:
 *   npm run migrate
 *   or
 *   ts-node src/scripts/migrate-db.ts
 */

import { initializeDatabase } from '../database/database';
import logger from '../utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  try {
    logger.info('Starting database migration...');

    const dbPath = process.env.DATABASE_PATH || './data/notifications.db';
    const db = await initializeDatabase(dbPath);

    logger.info('Database migration completed successfully', { dbPath });

    // Verify tables exist
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );

    logger.info('Database tables:', { tables: tables.map((t) => t.name) });

    await db.close();
    process.exit(0);
  } catch (error) {
    logger.error('Database migration failed', { error });
    process.exit(1);
  }
}

migrate();
