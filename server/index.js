import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import db from './db.js';
import {
  issueSession,
  clearSession,
  sessionMiddleware,
  requireOrg,
  requireDonor,
  issueAdminSession,
  clearAdminSession,
  checkAdminPassword,
  requireAdmin,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(sessionMiddleware);

// ================= Helpers =================
function initialsFor(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Serialize a joined need row for the client. `viewerDonorId` lets us compute
// claimedByMe without ever leaking which donor claimed a need.
function serializeNeed(row, viewerDonorId) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    urgency: row.urgency,
    description: row.description,
    createdAt: row.created_at,
    claimed: row.claimed_by !== null,
    claimedByMe: viewerDonorId != null && row.claimed_by === viewerDonorId,
    org: {
      id: row.org_id,
      name: row.org_name,
      city: row.org_city,
      initials: row.org_initials,
    },
  };
}

const NEED_SELECT = `
  SELECT n.*, o.name AS org_name, o.city AS org_city,
         o.initials AS org_initials, o.approved AS org_approved
  FROM needs n
  JOIN organizations o ON o.id = n.org_id
`;

function currentDonorId(req) {
  return req.user && req.user.kind === 'donor' ? req.user.id : null;
}

// ================= Auth routes =================
app.post('/api/auth/signup', (req, res) => {
  const role = req.body?.role;
  const name = (req.body?.name || '').trim();
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';

  if (role !== 'org' && role !== 'donor') {
    return res.status(400).json({ error: 'Invalid account type.' });
  }
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Fill in every field before continuing.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Choose a password of at least 6 characters.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  if (role === 'org') {
    const city = (req.body?.city || '').trim();
    if (!city) return res.status(400).json({ error: 'Choose a city.' });
    const exists = db
      .prepare('SELECT id FROM organizations WHERE lower(email) = ?')
      .get(email);
    if (exists) {
      return res
        .status(409)
        .json({ error: 'An organization with that email already exists.' });
    }
    const info = db
      .prepare(
        `INSERT INTO organizations (name, city, email, password_hash, initials, approved)
         VALUES (?, ?, ?, ?, ?, 0)`
      )
      .run(name, city, email, hash, initialsFor(name));
    issueSession(res, 'org', info.lastInsertRowid);
    return res.json({
      user: {
        kind: 'org',
        id: info.lastInsertRowid,
        name,
        city,
        initials: initialsFor(name),
        approved: false,
      },
    });
  }

  // donor
  const exists = db.prepare('SELECT id FROM donors WHERE lower(email) = ?').get(email);
  if (exists) {
    return res.status(409).json({ error: 'A donor account with that email already exists.' });
  }
  const info = db
    .prepare('INSERT INTO donors (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, hash);
  issueSession(res, 'donor', info.lastInsertRowid);
  return res.json({
    user: { kind: 'donor', id: info.lastInsertRowid, name, initials: initialsFor(name) },
  });
});

app.post('/api/auth/login', (req, res) => {
  const role = req.body?.role;
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';

  if (role !== 'org' && role !== 'donor') {
    return res.status(400).json({ error: 'Invalid account type.' });
  }
  const genericError = { error: "That email and password don't match an account." };

  if (role === 'org') {
    const org = db.prepare('SELECT * FROM organizations WHERE lower(email) = ?').get(email);
    if (!org || !bcrypt.compareSync(password, org.password_hash)) {
      return res.status(401).json(genericError);
    }
    issueSession(res, 'org', org.id);
    return res.json({
      user: {
        kind: 'org',
        id: org.id,
        name: org.name,
        city: org.city,
        initials: org.initials,
        approved: !!org.approved,
      },
    });
  }

  const donor = db.prepare('SELECT * FROM donors WHERE lower(email) = ?').get(email);
  if (!donor || !bcrypt.compareSync(password, donor.password_hash)) {
    return res.status(401).json(genericError);
  }
  issueSession(res, 'donor', donor.id);
  return res.json({
    user: { kind: 'donor', id: donor.id, name: donor.name, initials: initialsFor(donor.name) },
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  if (req.user.kind === 'org') {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.id);
    if (!org) return res.json({ user: null });
    return res.json({
      user: {
        kind: 'org',
        id: org.id,
        name: org.name,
        city: org.city,
        initials: org.initials,
        approved: !!org.approved,
      },
    });
  }
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.user.id);
  if (!donor) return res.json({ user: null });
  return res.json({
    user: { kind: 'donor', id: donor.id, name: donor.name, initials: initialsFor(donor.name) },
  });
});

// ================= Public browse =================
app.get('/api/cities', (req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT o.city AS city
       FROM organizations o
       WHERE o.approved = 1
       ORDER BY o.city`
    )
    .all();
  res.json({ cities: rows.map((r) => r.city) });
});

// Public list: only needs from approved organizations.
app.get('/api/needs', (req, res) => {
  const rows = db
    .prepare(`${NEED_SELECT} WHERE o.approved = 1 ORDER BY n.created_at DESC, n.id DESC`)
    .all();
  const donorId = currentDonorId(req);
  res.json({ needs: rows.map((r) => serializeNeed(r, donorId)) });
});

// Single need. Visible if the org is approved, or the viewer is the owning org
// (so orgs can preview / edit their own not-yet-approved needs).
app.get('/api/needs/:id', (req, res) => {
  const row = db.prepare(`${NEED_SELECT} WHERE n.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Need not found.' });
  const isOwner = req.user?.kind === 'org' && req.user.id === row.org_id;
  if (!row.org_approved && !isOwner) {
    return res.status(404).json({ error: 'Need not found.' });
  }
  res.json({ need: serializeNeed(row, currentDonorId(req)) });
});

// ================= Organization: manage own needs =================
app.get('/api/my/needs', requireOrg, (req, res) => {
  const rows = db
    .prepare(`${NEED_SELECT} WHERE n.org_id = ? ORDER BY n.created_at DESC, n.id DESC`)
    .all(req.user.id);
  res.json({ needs: rows.map((r) => serializeNeed(r, null)) });
});

function validateNeedInput(body) {
  const title = (body?.title || '').trim();
  const type = body?.type;
  const urgency = body?.urgency;
  const description = (body?.description || '').trim() || 'No further details provided.';
  if (!title) return { error: 'Give the need a title.' };
  if (type !== 'item' && type !== 'volunteer') return { error: 'Choose a valid type.' };
  if (!['Critical', 'High', 'Adequate'].includes(urgency)) {
    return { error: 'Choose a valid urgency.' };
  }
  return { data: { title, type, urgency, description } };
}

app.post('/api/needs', requireOrg, (req, res) => {
  const { data, error } = validateNeedInput(req.body);
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare(
      `INSERT INTO needs (org_id, title, type, urgency, description)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.user.id, data.title, data.type, data.urgency, data.description);
  const row = db.prepare(`${NEED_SELECT} WHERE n.id = ?`).get(info.lastInsertRowid);
  res.json({ need: serializeNeed(row, null) });
});

app.put('/api/needs/:id', requireOrg, (req, res) => {
  const need = db.prepare('SELECT * FROM needs WHERE id = ?').get(req.params.id);
  if (!need) return res.status(404).json({ error: 'Need not found.' });
  if (need.org_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own needs.' });
  }
  const { data, error } = validateNeedInput(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(
    'UPDATE needs SET title = ?, type = ?, urgency = ?, description = ? WHERE id = ?'
  ).run(data.title, data.type, data.urgency, data.description, need.id);
  const row = db.prepare(`${NEED_SELECT} WHERE n.id = ?`).get(need.id);
  res.json({ need: serializeNeed(row, null) });
});

app.delete('/api/needs/:id', requireOrg, (req, res) => {
  const need = db.prepare('SELECT * FROM needs WHERE id = ?').get(req.params.id);
  if (!need) return res.status(404).json({ error: 'Need not found.' });
  if (need.org_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own needs.' });
  }
  db.prepare('DELETE FROM needs WHERE id = ?').run(need.id);
  res.json({ ok: true });
});

// ================= Donor: claim / release =================
app.post('/api/needs/:id/claim', requireDonor, (req, res) => {
  const claim = db.transaction((needId, donorId) => {
    const need = db
      .prepare(
        `SELECT n.*, o.approved AS org_approved FROM needs n
         JOIN organizations o ON o.id = n.org_id WHERE n.id = ?`
      )
      .get(needId);
    if (!need) return { status: 404, body: { error: 'Need not found.' } };
    if (!need.org_approved) return { status: 404, body: { error: 'Need not found.' } };
    if (need.claimed_by !== null) {
      return { status: 409, body: { error: 'This need has already been claimed.' } };
    }
    db.prepare('UPDATE needs SET claimed_by = ? WHERE id = ?').run(donorId, needId);
    return { status: 200 };
  })(req.params.id, req.user.id);

  if (claim.status !== 200) return res.status(claim.status).json(claim.body);
  const row = db.prepare(`${NEED_SELECT} WHERE n.id = ?`).get(req.params.id);
  res.json({ need: serializeNeed(row, req.user.id) });
});

app.post('/api/needs/:id/release', requireDonor, (req, res) => {
  const need = db.prepare('SELECT * FROM needs WHERE id = ?').get(req.params.id);
  if (!need) return res.status(404).json({ error: 'Need not found.' });
  if (need.claimed_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only release your own claim.' });
  }
  db.prepare('UPDATE needs SET claimed_by = NULL WHERE id = ?').run(need.id);
  const row = db.prepare(`${NEED_SELECT} WHERE n.id = ?`).get(need.id);
  res.json({ need: serializeNeed(row, req.user.id) });
});

app.get('/api/my/claims', requireDonor, (req, res) => {
  const rows = db
    .prepare(`${NEED_SELECT} WHERE n.claimed_by = ? ORDER BY n.created_at DESC, n.id DESC`)
    .all(req.user.id);
  res.json({ needs: rows.map((r) => serializeNeed(r, req.user.id)) });
});

// ================= Per-need chat =================
function needVisibleTo(req, needId) {
  const row = db.prepare(`${NEED_SELECT} WHERE n.id = ?`).get(needId);
  if (!row) return null;
  const isOwner = req.user?.kind === 'org' && req.user.id === row.org_id;
  if (!row.org_approved && !isOwner) return null;
  return row;
}

app.get('/api/needs/:id/messages', (req, res) => {
  const need = needVisibleTo(req, req.params.id);
  if (!need) return res.status(404).json({ error: 'Need not found.' });
  const rows = db
    .prepare('SELECT * FROM messages WHERE need_id = ? ORDER BY created_at ASC, id ASC')
    .all(need.id);

  // Resolve sender display names in bulk.
  const donorNames = new Map();
  const donorRows = db.prepare('SELECT id, name FROM donors').all();
  donorRows.forEach((d) => donorNames.set(d.id, d.name));

  const messages = rows.map((m) => ({
    id: m.id,
    from: m.sender_role, // 'org' | 'donor'
    senderName:
      m.sender_role === 'org' ? need.org_name : donorNames.get(m.sender_id) || 'Donor',
    text: m.text,
    createdAt: m.created_at,
  }));
  res.json({ messages });
});

app.post('/api/needs/:id/messages', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Sign in to send a message.' });
  }
  const need = needVisibleTo(req, req.params.id);
  if (!need) return res.status(404).json({ error: 'Need not found.' });

  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (text.length > 2000) return res.status(400).json({ error: 'Message is too long.' });

  let senderRole;
  if (req.user.kind === 'org') {
    // Only the organization that owns the need may reply as the org.
    if (req.user.id !== need.org_id) {
      return res.status(403).json({ error: 'You can only reply on your own needs.' });
    }
    senderRole = 'org';
  } else {
    senderRole = 'donor';
  }

  const info = db
    .prepare(
      'INSERT INTO messages (need_id, sender_role, sender_id, text) VALUES (?, ?, ?, ?)'
    )
    .run(need.id, senderRole, req.user.id, text);
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  const senderName =
    senderRole === 'org'
      ? need.org_name
      : db.prepare('SELECT name FROM donors WHERE id = ?').get(req.user.id)?.name || 'Donor';
  res.json({
    message: {
      id: m.id,
      from: senderRole,
      senderName,
      text: m.text,
      createdAt: m.created_at,
    },
  });
});

// ================= Admin (manual organization approval) =================
app.post('/api/admin/login', (req, res) => {
  if (!checkAdminPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }
  issueAdminSession(res);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  clearAdminSession(res);
  res.json({ ok: true });
});

app.get('/api/admin/orgs', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.name, o.city, o.email, o.approved, o.created_at,
              (SELECT COUNT(*) FROM needs n WHERE n.org_id = o.id) AS need_count
       FROM organizations o
       ORDER BY o.approved ASC, o.created_at DESC, o.id DESC`
    )
    .all();
  res.json({
    orgs: rows.map((o) => ({
      id: o.id,
      name: o.name,
      city: o.city,
      email: o.email,
      approved: !!o.approved,
      createdAt: o.created_at,
      needCount: o.need_count,
    })),
  });
});

app.post('/api/admin/orgs/:id/approval', requireAdmin, (req, res) => {
  const approved = req.body?.approved ? 1 : 0;
  const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found.' });
  db.prepare('UPDATE organizations SET approved = ? WHERE id = ?').run(approved, org.id);
  res.json({ ok: true, approved: !!approved });
});

// ================= Static frontend =================
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Nodig running on http://localhost:${PORT}`);
});
