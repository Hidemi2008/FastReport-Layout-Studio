import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function openDb(file = process.env.DB_FILE || resolve(root, 'data/dav.db')) {
  try {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync(resolve(root, 'db/schema.sql'), 'utf8'));
    return db;
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'database_open_failed', database: file === ':memory:' ? file : '[configured]', error: error.message }));
    throw new Error('Não foi possível abrir o banco local.', { cause: error });
  }
}
