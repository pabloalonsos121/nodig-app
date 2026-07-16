import jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'dev-insecure-secret-change-me-in-production-please-0000000000';
const COOKIE_NAME = 'nodig_token';
const ADMIN_COOKIE = 'nodig_admin';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn(
    '[nodig] WARNING: JWT_SECRET is not set. Set it in production so sessions survive restarts and stay secure.'
  );
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

// kind: 'org' | 'donor'
export function issueSession(res, kind, id) {
  const token = jwt.sign({ kind, id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, cookieOpts());
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Populates req.user = { kind, id } | null. Never throws.
export function sessionMiddleware(req, res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload && (payload.kind === 'org' || payload.kind === 'donor')) {
        req.user = { kind: payload.kind, id: payload.id };
      }
    } catch {
      // invalid / expired token — treat as signed out
    }
  }
  next();
}

export function requireOrg(req, res, next) {
  if (!req.user || req.user.kind !== 'org') {
    return res.status(401).json({ error: 'Sign in as an organization to do that.' });
  }
  next();
}

export function requireDonor(req, res, next) {
  if (!req.user || req.user.kind !== 'donor') {
    return res.status(401).json({ error: 'Sign in as a donor to do that.' });
  }
  next();
}

// ================= Admin session (separate, password-gated) =================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nodig-admin';

export function issueAdminSession(res) {
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(ADMIN_COOKIE, token, { ...cookieOpts(), maxAge: 1000 * 60 * 60 * 24 * 7 });
}

export function clearAdminSession(res) {
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
}

export function checkAdminPassword(password) {
  return typeof password === 'string' && password.length > 0 && password === ADMIN_PASSWORD;
}

export function requireAdmin(req, res, next) {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload && payload.admin === true) return next();
    } catch {
      // fall through
    }
  }
  return res.status(401).json({ error: 'Admin sign in required.' });
}
