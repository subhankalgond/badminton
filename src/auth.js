import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DATA_DIR,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from './config.js';
import {
  bumpAdminSessionEpoch,
  countAdmins,
  deleteAdminsExcept,
  findAdminByUsername,
  upsertAdmin,
} from './db.js';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

const SECRET_FILE = path.join(DATA_DIR, 'session-secret.key');

function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_FILE)) {
    const stored = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (stored.length >= 32) return stored;
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

const SESSION_SECRET = loadSessionSecret();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    })
    .toString('hex');
  return ['scrypt', SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p, salt, hash].join('$');
}

export function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, salt, expected] = parts;
  let actual;
  try {
    actual = crypto
      .scryptSync(password, salt, expected.length / 2, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      })
      .toString('hex');
  } catch {
    return false;
  }

  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function randomPassword() {
  // Readable, unambiguous characters only.
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

/**
 * Make sure the organizer account exists and is the only account that can sign
 * in. The password comes from ADMIN_PASSWORD, normally set in the gitignored
 * .env file, so it is never stored in the repository. With no password set, a
 * random one is generated on first start and printed once.
 *
 * Any account left over from a previous username is deleted, so an old login
 * stops working the moment the credentials change.
 */
export function ensureAdminAccount(log = console.log) {
  if (ADMIN_PASSWORD) {
    upsertAdmin(ADMIN_USERNAME, hashPassword(ADMIN_PASSWORD));
    deleteAdminsExcept(ADMIN_USERNAME);
    return { username: ADMIN_USERNAME, generated: false };
  }

  if (countAdmins() === 0) {
    const password = randomPassword();
    upsertAdmin(ADMIN_USERNAME, hashPassword(password));
    log('');
    log('==========================================================');
    log(' Organizer dashboard: /admin');
    log(' Username: ' + ADMIN_USERNAME);
    log(' Password: ' + password);
    log(' Shown once. Add ADMIN_PASSWORD to a .env file in the');
    log(' project root to choose your own password instead.');
    log('==========================================================');
    log('');
    return { username: ADMIN_USERNAME, generated: true };
  }

  return { username: ADMIN_USERNAME, generated: false };
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

export function createSessionToken(username, epoch) {
  const payload = Buffer.from(
    JSON.stringify({
      u: username,
      e: Number(epoch) || 0,
      exp: Date.now() + SESSION_TTL_MS,
    })
  ).toString('base64url');
  return payload + '.' + sign(payload);
}

export function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length) return null;
  if (!crypto.timingSafeEqual(given, wanted)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!data || typeof data.u !== 'string' || typeof data.exp !== 'number') return null;
  if (Date.now() > data.exp) return null;
  return { username: data.u, epoch: Number(data.e) || 0 };
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  // A signed token is not enough: the account must still exist and the token
  // must belong to the current session epoch (bumped on every sign out).
  const admin = findAdminByUsername(payload.username);
  if (!admin) return null;
  if (Number(admin.session_epoch || 0) !== payload.epoch) return null;

  return { username: admin.username, epoch: payload.epoch };
}

/** End the signed in session on the server as well as in the browser. */
export function revokeSession(req) {
  const session = getSession(req);
  if (!session) return;
  bumpAdminSessionEpoch(session.username);
}

function cookieOptions(req) {
  // Only mark the cookie Secure when the request really arrived over HTTPS,
  // so plain HTTP testing on a phone on the same network keeps working.
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure === true,
    path: '/',
  };
}

export function setSessionCookie(req, res, username, epoch) {
  res.cookie(SESSION_COOKIE, createSessionToken(username, epoch), {
    ...cookieOptions(req),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

/** Express middleware: reject unauthenticated requests to admin APIs. */
export function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ ok: false, message: 'Sign in to the admin dashboard first.' });
    return;
  }
  req.adminUsername = session.username;
  next();
}
