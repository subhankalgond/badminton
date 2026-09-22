import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, ENTRY_FEE } from './config.js';
import { normalizeKey, normalizeText } from '../public/js/validate.js';

export const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(DATA_DIR, 'app.db');

export const REGISTRATION_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
};

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
};

export const REJECTION_REASONS = [
  { code: 'fake_payment_screenshot', label: 'Fake payment screenshot', paymentFailed: true },
  { code: 'payment_not_received', label: 'Payment not received', paymentFailed: true },
  { code: 'incorrect_payment_amount', label: 'Incorrect payment amount', paymentFailed: true },
  { code: 'screenshot_unclear', label: 'Screenshot unclear', paymentFailed: false },
  { code: 'different_college', label: 'Different college', paymentFailed: false },
  { code: 'duplicate_registration', label: 'Duplicate registration', paymentFailed: false },
  { code: 'other', label: 'Other', paymentFailed: false },
];

export class DuplicateRegistrationError extends Error {}

const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_name TEXT NOT NULL,
    team_name_norm TEXT NOT NULL,
    player1_name TEXT NOT NULL,
    player1_name_norm TEXT NOT NULL,
    player1_email TEXT NOT NULL,
    player1_email_norm TEXT NOT NULL,
    player1_college TEXT NOT NULL,
    player1_college_norm TEXT NOT NULL,
    player2_name TEXT NOT NULL,
    player2_name_norm TEXT NOT NULL,
    player2_email TEXT NOT NULL,
    player2_email_norm TEXT NOT NULL,
    player2_college TEXT NOT NULL,
    player2_college_norm TEXT NOT NULL,
    payment_amount INTEGER NOT NULL DEFAULT 300,
    payment_screenshot_file TEXT NOT NULL DEFAULT '',
    payment_screenshot_mime TEXT NOT NULL DEFAULT '',
    payment_screenshot_size INTEGER NOT NULL DEFAULT 0,
    payment_screenshot_url TEXT NOT NULL DEFAULT '',
    payment_status TEXT NOT NULL DEFAULT 'PENDING',
    registration_status TEXT NOT NULL DEFAULT 'PENDING',
    rejection_reason TEXT NOT NULL DEFAULT '',
    verified_by TEXT NOT NULL DEFAULT '',
    verified_at TEXT NOT NULL DEFAULT '',
    rejected_by TEXT NOT NULL DEFAULT '',
    rejected_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS registrations_team_active
    ON registrations(team_name_norm)
    WHERE registration_status <> 'REJECTED';

  CREATE INDEX IF NOT EXISTS registrations_status
    ON registrations(registration_status);
  CREATE INDEX IF NOT EXISTS registrations_player1_email
    ON registrations(player1_email_norm);
  CREATE INDEX IF NOT EXISTS registrations_player2_email
    ON registrations(player2_email_norm);

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    session_epoch INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Small migration for databases created before session epochs existed.
const adminColumns = db.prepare('PRAGMA table_info(admins)').all();
if (!adminColumns.some((column) => column.name === 'session_epoch')) {
  db.exec('ALTER TABLE admins ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0');
}

const NORMALISED_COLUMNS = new Set([
  'team_name_norm',
  'player1_name_norm',
  'player1_email_norm',
  'player1_college_norm',
  'player2_name_norm',
  'player2_email_norm',
  'player2_college_norm',
  'payment_screenshot_file',
]);

/** Remove internal helper columns from a record before it leaves the server. */
function toAdminRecord(row) {
  if (!row) return null;
  const record = {};
  for (const [key, value] of Object.entries(row)) {
    if (NORMALISED_COLUMNS.has(key)) continue;
    record[key] = value;
  }
  return record;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Insert a registration. Duplicate checking and the insert run inside one
 * write transaction so two simultaneous submissions cannot both pass.
 */
export function createRegistration(values, screenshot) {
  const now = nowIso();
  const teamNameNorm = normalizeKey(values.team_name);
  const p1EmailNorm = normalizeKey(values.player1_email);
  const p2EmailNorm = normalizeKey(values.player2_email);
  const p1NameNorm = normalizeKey(values.player1_name);
  const p2NameNorm = normalizeKey(values.player2_name);

  db.exec('BEGIN IMMEDIATE');
  try {
    const teamDuplicate = db
      .prepare(
        `SELECT id FROM registrations
         WHERE registration_status <> 'REJECTED' AND team_name_norm = ?
         LIMIT 1`
      )
      .get(teamNameNorm);
    if (teamDuplicate) {
      throw new DuplicateRegistrationError(
        'A team named "' +
          values.team_name +
          '" is already registered. Duplicate team names are not allowed, please contact the organizer if you need a change.'
      );
    }

    const pairDuplicate = db
      .prepare(
        `SELECT id FROM registrations
         WHERE registration_status <> 'REJECTED'
           AND ((player1_name_norm = ? AND player2_name_norm = ?)
             OR (player1_name_norm = ? AND player2_name_norm = ?))
         LIMIT 1`
      )
      .get(p1NameNorm, p2NameNorm, p2NameNorm, p1NameNorm);
    if (pairDuplicate) {
      throw new DuplicateRegistrationError(
        'This pair of players is already registered as a team. Duplicate registrations are not allowed.'
      );
    }

    const emailDuplicate = db
      .prepare(
        `SELECT player1_email, player1_email_norm, player2_email, player2_email_norm
         FROM registrations
         WHERE registration_status <> 'REJECTED'
           AND (player1_email_norm IN (?, ?) OR player2_email_norm IN (?, ?))
         LIMIT 1`
      )
      .get(p1EmailNorm, p2EmailNorm, p1EmailNorm, p2EmailNorm);

    if (emailDuplicate) {
      const usedEmail =
        emailDuplicate.player1_email_norm === p1EmailNorm ||
        emailDuplicate.player1_email_norm === p2EmailNorm
          ? emailDuplicate.player1_email
          : emailDuplicate.player2_email;
      throw new DuplicateRegistrationError(
        'The email address ' +
          usedEmail +
          ' is already used in another registration. Each player can be part of only one team.'
      );
    }

    let info;
    try {
      info = db
        .prepare(
          `INSERT INTO registrations (
            team_name, team_name_norm,
            player1_name, player1_name_norm, player1_email, player1_email_norm, player1_college, player1_college_norm,
            player2_name, player2_name_norm, player2_email, player2_email_norm, player2_college, player2_college_norm,
            payment_amount, payment_screenshot_file, payment_screenshot_mime, payment_screenshot_size, payment_screenshot_url,
            payment_status, registration_status, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          values.team_name,
          teamNameNorm,
          values.player1_name,
          p1NameNorm,
          values.player1_email,
          p1EmailNorm,
          values.player1_college,
          normalizeKey(values.player1_college),
          values.player2_name,
          p2NameNorm,
          values.player2_email,
          p2EmailNorm,
          values.player2_college,
          normalizeKey(values.player2_college),
          ENTRY_FEE,
          screenshot.fileName,
          screenshot.mimeType,
          screenshot.size,
          '',
          PAYMENT_STATUS.PENDING,
          REGISTRATION_STATUS.PENDING,
          now,
          now
        );
    } catch (error) {
      const message = String(error && error.message ? error.message : '');
      if (message.includes('UNIQUE') || message.includes('constraint')) {
        throw new DuplicateRegistrationError(
          'A registration with the same team details already exists. Duplicate registrations are not allowed.'
        );
      }
      throw error;
    }

    const id = Number(info.lastInsertRowid);
    const screenshotUrl = '/api/admin/registrations/' + id + '/screenshot';
    db.prepare('UPDATE registrations SET payment_screenshot_url = ? WHERE id = ?').run(
      screenshotUrl,
      id
    );

    db.exec('COMMIT');
    return { id, paymentScreenshotUrl: screenshotUrl };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getRegistration(id) {
  const row = db.prepare('SELECT * FROM registrations WHERE id = ?').get(Number(id));
  return toAdminRecord(row);
}

export function getRegistrationRaw(id) {
  return db.prepare('SELECT * FROM registrations WHERE id = ?').get(Number(id));
}

/**
 * List registrations with optional status filter and free text search.
 * Search covers team name, both player names, both colleges and both emails.
 */
export function listRegistrations({ status, q } = {}) {
  const clauses = [];
  const params = [];

  if (status && status !== 'ALL') {
    clauses.push('registration_status = ?');
    params.push(status);
  }

  const query = normalizeKey(q);
  if (query) {
    const like = '%' + query.replace(/[%_]/g, (match) => '\\' + match) + '%';
    clauses.push(
      `(team_name_norm LIKE ? ESCAPE '\\'
        OR player1_name_norm LIKE ? ESCAPE '\\'
        OR player2_name_norm LIKE ? ESCAPE '\\'
        OR player1_college_norm LIKE ? ESCAPE '\\'
        OR player2_college_norm LIKE ? ESCAPE '\\'
        OR player1_email_norm LIKE ? ESCAPE '\\'
        OR player2_email_norm LIKE ? ESCAPE '\\')`
    );
    for (let index = 0; index < 7; index += 1) params.push(like);
  }

  const sql =
    'SELECT * FROM registrations' +
    (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') +
    ` ORDER BY CASE registration_status
        WHEN 'PENDING' THEN 0
        WHEN 'ACCEPTED' THEN 1
        ELSE 2
      END, id DESC`;

  return db.prepare(sql).all(...params).map(toAdminRecord);
}

/** Counts come straight from the database, they are never hardcoded. */
export function getStats() {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN registration_status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN registration_status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN registration_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN payment_status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_payments
       FROM registrations`
    )
    .get();

  return {
    total: Number(row.total || 0),
    pending: Number(row.pending || 0),
    accepted: Number(row.accepted || 0),
    rejected: Number(row.rejected || 0),
    verified_payments: Number(row.verified_payments || 0),
  };
}

export function acceptRegistration(id, adminUsername) {
  const now = nowIso();
  const info = db
    .prepare(
      `UPDATE registrations SET
         registration_status = ?,
         payment_status = ?,
         rejection_reason = '',
         rejected_by = '',
         rejected_at = '',
         verified_by = ?,
         verified_at = ?,
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      REGISTRATION_STATUS.ACCEPTED,
      PAYMENT_STATUS.VERIFIED,
      adminUsername,
      now,
      now,
      Number(id)
    );

  return info.changes > 0;
}

export function rejectRegistration(id, adminUsername, reasonText, paymentFailed) {
  const now = nowIso();
  const info = db
    .prepare(
      `UPDATE registrations SET
         registration_status = ?,
         payment_status = ?,
         rejection_reason = ?,
         rejected_by = ?,
         rejected_at = ?,
         verified_by = '',
         verified_at = '',
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      REGISTRATION_STATUS.REJECTED,
      paymentFailed ? PAYMENT_STATUS.REJECTED : PAYMENT_STATUS.PENDING,
      reasonText,
      adminUsername,
      now,
      now,
      Number(id)
    );

  return info.changes > 0;
}

export function findAdminByUsername(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username));
}

export function countAdmins() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM admins').get();
  return Number(row.count || 0);
}

/**
 * Drop every organizer account except the given one, so a username that was
 * used before can never sign in again.
 * @returns {number} number of accounts removed
 */
export function deleteAdminsExcept(username) {
  const info = db.prepare('DELETE FROM admins WHERE username <> ?').run(String(username));
  return Number(info.changes || 0);
}

/**
 * Invalidate every session token issued for this account. Tokens carry the
 * epoch they were issued with, so signing out really ends the session instead
 * of only dropping the cookie in the browser.
 */
export function bumpAdminSessionEpoch(username) {
  db.prepare('UPDATE admins SET session_epoch = session_epoch + 1, updated_at = ? WHERE username = ?').run(
    nowIso(),
    String(username)
  );
}

export function upsertAdmin(username, passwordHash) {
  const now = nowIso();
  const existing = findAdminByUsername(username);
  if (existing) {
    db.prepare('UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      passwordHash,
      now,
      existing.id
    );
    return;
  }
  db.prepare(
    'INSERT INTO admins (username, password_hash, created_at, updated_at) VALUES (?,?,?,?)'
  ).run(username, passwordHash, now, now);
}

export function closeDatabase() {
  try {
    db.close();
  } catch {
    /* nothing useful to do while shutting down */
  }
}

export { normalizeText };
