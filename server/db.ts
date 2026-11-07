import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DATA_DIR = path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'agentdom.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  crowns INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  province TEXT NOT NULL,
  title TEXT NOT NULL,
  bio TEXT NOT NULL,
  instructions TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  look INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  owner_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  province TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  eta_minutes INTEGER NOT NULL,
  sample_brief TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decrees (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  commission_id TEXT,
  province TEXT NOT NULL,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '[]',
  revision_note TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  rating INTEGER,
  review TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  routed_by TEXT NOT NULL,
  ip TEXT,
  route_reason TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  eta_minutes INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL,
  started_at TEXT,
  delivered_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS decrees_status ON decrees(status, created_at);
CREATE INDEX IF NOT EXISTS decrees_user ON decrees(user_id, created_at);
CREATE INDEX IF NOT EXISTS decrees_agent ON decrees(agent_id, status);
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS banners (
  id TEXT PRIMARY KEY,
  no INTEGER UNIQUE NOT NULL,
  province TEXT NOT NULL,
  side TEXT NOT NULL,
  kind TEXT NOT NULL,
  size TEXT NOT NULL,
  price_per_day INTEGER NOT NULL,
  renter_id TEXT,
  title TEXT,
  image_url TEXT,
  until TEXT
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  province TEXT NOT NULL,
  text TEXT NOT NULL,
  agent_id TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
`);

export const now = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 14)}`;

// Run several statements in one transaction.
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export type Row = Record<string, any>;
