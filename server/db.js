import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'nodig.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// node:sqlite has no db.transaction() helper (unlike better-sqlite3), so wrap
// BEGIN/COMMIT/ROLLBACK ourselves. `fn` runs synchronously; returning commits,
// throwing rolls back. Single-process + synchronous, so no nesting to worry about.
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ================= Schema =================
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    city          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    initials      TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'organization',
    approved      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS donors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'donor',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS needs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK (type IN ('item', 'volunteer')),
    urgency     TEXT    NOT NULL CHECK (urgency IN ('Critical', 'High', 'Adequate')),
    description TEXT    NOT NULL,
    claimed_by  INTEGER REFERENCES donors(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    need_id     INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
    sender_role TEXT    NOT NULL CHECK (sender_role IN ('org', 'donor')),
    sender_id   INTEGER NOT NULL,
    text        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_needs_org      ON needs(org_id);
  CREATE INDEX IF NOT EXISTS idx_needs_claimed  ON needs(claimed_by);
  CREATE INDEX IF NOT EXISTS idx_messages_need  ON messages(need_id);
`);

// ================= Seed data (only on first run) =================
// Mirrors the prototype's seed set. Seed organizations are pre-approved so the
// public browse isn't empty on a fresh install. New signups default to
// approved = 0 (see routes) and stay hidden until a human approves them.
const orgCount = db.prepare('SELECT COUNT(*) AS c FROM organizations').get().c;
if (orgCount === 0) {
  const demoHash = bcrypt.hashSync('demo123', 10);
  const insertOrg = db.prepare(
    `INSERT INTO organizations (name, city, email, password_hash, initials, approved)
     VALUES (@name, @city, @email, @password_hash, @initials, 1)`
  );
  const seedOrgs = [
    { name: 'Foyer Saint-Jean', city: 'Brussels', email: 'contact@foyerstjean.be', initials: 'FS' },
    { name: 'Abri de Nuit Waterloo', city: 'Waterloo', email: 'contact@abriwaterloo.be', initials: 'AW' },
    { name: 'Leuven Community Kitchen', city: 'Leuven', email: 'contact@leuvenkitchen.be', initials: 'LK' },
  ];
  const orgIds = [];
  transaction(() => {
    for (const o of seedOrgs) {
      const info = insertOrg.run({ ...o, password_hash: demoHash });
      orgIds.push(info.lastInsertRowid);
    }
    const insertNeed = db.prepare(
      `INSERT INTO needs (org_id, title, type, urgency, description)
       VALUES (@org_id, @title, @type, @urgency, @description)`
    );
    const seedNeeds = [
      { org: 0, title: 'Toothbrushes and toothpaste', type: 'item', urgency: 'Critical', description: '40 hygiene kits needed for new arrivals this week.' },
      { org: 0, title: 'Evening meal servers', type: 'volunteer', urgency: 'Adequate', description: '2 volunteers, Tue/Thu 6-8pm.' },
      { org: 1, title: 'Warm blankets', type: 'item', urgency: 'High', description: 'Cold snap expected, need 20 blankets.' },
      { org: 1, title: 'Intake desk support', type: 'volunteer', urgency: 'Critical', description: 'No coverage for Friday evening shift.' },
      { org: 2, title: 'Canned vegetables', type: 'item', urgency: 'Adequate', description: 'Stock is fine, small donations welcome.' },
      { org: 2, title: 'Weekend cooking help', type: 'volunteer', urgency: 'High', description: 'Short-staffed Saturdays, 3 volunteers needed.' },
    ];
    for (const n of seedNeeds) {
      insertNeed.run({
        org_id: orgIds[n.org],
        title: n.title,
        type: n.type,
        urgency: n.urgency,
        description: n.description,
      });
    }
  });
  console.log('Seeded database with demo organizations and needs (login: any seed email / demo123).');
}

export default db;
