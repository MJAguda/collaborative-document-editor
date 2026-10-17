import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './auth.ts';

export type DB = BetterSqlite3.Database;

// Public demo credentials (listed in README); not a secret.
export const SEED_PASSWORD = 'demo1234';
const SEED_USERS = [
  { email: 'alice@example.com', name: 'Alice' },
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'carol@example.com', name: 'Carol' },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS shares (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (document_id, user_id)
);`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  if (!db.prepare('SELECT 1 FROM users').get()) {
    const insert = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)');
    for (const u of SEED_USERS) insert.run(u.email, u.name, hashPassword(SEED_PASSWORD));
  }
  return db;
}
