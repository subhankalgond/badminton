import fs from 'node:fs';
import { Pool } from 'pg';
import {
  DB_CONFIGURED,
  DB_CONNECTION_STRING,
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_PORT,
  DB_SCHEMA,
  DB_SCHEMA_VALID,
  DB_SSL,
  DB_SSL_CA_FILE,
  DB_TARGET,
  DB_USER,
  ENTRY_FEE,
} from './config.js';
import { normalizeKey, normalizeText } from '../public/js/validate.js';

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

/** Thrown when a team, a player or a pair of players is already registered. */
export class DuplicateRegistrationError extends Error {}

/** Thrown when the database cannot be configured, reached or set up. */
export class DatabaseConfigError extends Error {}

/*
 * Every table name is written with its schema in front of it, so a query can
 * never land in the wrong schema. The search path of the connection is
 * deliberately left alone, because it is set per session and a pool hands out
 * connections in whatever order it likes. DB_SCHEMA is 'public' in normal use;
 * the tests point it at a throwaway schema of their own.
 */
const T = {
  registrations: DB_SCHEMA + '.registrations',
  keys: DB_SCHEMA + '.registration_keys',
  admins: DB_SCHEMA + '.admins',
};

/* ------------------------------------------------------------------ schema */

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${T.registrations} (
     id SERIAL PRIMARY KEY,
     team_name VARCHAR(160) NOT NULL,
     team_name_norm VARCHAR(190) NOT NULL,
     player1_name VARCHAR(160) NOT NULL,
     player1_name_norm VARCHAR(190) NOT NULL,
     player1_email VARCHAR(190) NOT NULL,
     player1_email_norm VARCHAR(190) NOT NULL,
     player1_college VARCHAR(190) NOT NULL,
     player1_college_norm VARCHAR(190) NOT NULL,
     player1_mobile VARCHAR(15) NOT NULL DEFAULT '',
     player2_name VARCHAR(160) NOT NULL,
     player2_name_norm VARCHAR(190) NOT NULL,
     player2_email VARCHAR(190) NOT NULL,
     player2_email_norm VARCHAR(190) NOT NULL,
     player2_college VARCHAR(190) NOT NULL,
     player2_college_norm VARCHAR(190) NOT NULL,
     player2_mobile VARCHAR(15) NOT NULL DEFAULT '',
     payment_amount INTEGER NOT NULL DEFAULT ${ENTRY_FEE},
     payment_screenshot_file VARCHAR(190) NOT NULL DEFAULT '',
     payment_screenshot_mime VARCHAR(60) NOT NULL DEFAULT '',
     payment_screenshot_size INTEGER NOT NULL DEFAULT 0,
     payment_screenshot_data BYTEA,
     payment_screenshot_url VARCHAR(190) NOT NULL DEFAULT '',
     payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
     registration_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
     rejection_reason VARCHAR(400) NOT NULL DEFAULT '',
     verified_by VARCHAR(190) NOT NULL DEFAULT '',
     verified_at VARCHAR(40) NOT NULL DEFAULT '',
     rejected_by VARCHAR(190) NOT NULL DEFAULT '',
     rejected_at VARCHAR(40) NOT NULL DEFAULT '',
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS registrations_status
     ON ${T.registrations} (registration_status)`,

  `CREATE INDEX IF NOT EXISTS registrations_player1_email
     ON ${T.registrations} (player1_email_norm)`,

  `CREATE INDEX IF NOT EXISTS registrations_player2_email
     ON ${T.registrations} (player2_email_norm)`,

  /**
   * One row per thing that may exist only once among teams that are not
   * rejected: a team name, a player email, and a pair of players. A primary
   * key means the database itself refuses a duplicate, even when two people
   * submit at the same moment, which a SELECT check cannot do on its own.
   * Rejecting a team deletes its rows, so those players may register again.
   */
  `CREATE TABLE IF NOT EXISTS ${T.keys} (
     key_norm VARCHAR(191) PRIMARY KEY,
     registration_id INTEGER NOT NULL REFERENCES ${T.registrations}(id) ON DELETE CASCADE
   )`,

  `CREATE INDEX IF NOT EXISTS registration_keys_registration
     ON ${T.keys} (registration_id)`,

  `CREATE TABLE IF NOT EXISTS ${T.admins} (
     id SERIAL PRIMARY KEY,
     username VARCHAR(190) NOT NULL UNIQUE,
     password_hash VARCHAR(255) NOT NULL,
     session_epoch INTEGER NOT NULL DEFAULT 0,
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL
   )`,
];

/** Columns added after the first release, applied to an existing database. */
const COLUMN_MIGRATIONS = [
  ['registrations', 'player1_mobile', "VARCHAR(15) NOT NULL DEFAULT ''"],
  ['registrations', 'player2_mobile', "VARCHAR(15) NOT NULL DEFAULT ''"],
  ['registrations', 'payment_screenshot_data', 'BYTEA'],
  ['admins', 'session_epoch', 'INTEGER NOT NULL DEFAULT 0'],
];

const NORMALISED_COLUMNS = new Set([
  'team_name_norm',
  'player1_name_norm',
  'player1_email_norm',
  'player1_college_norm',
  'player2_name_norm',
  'player2_email_norm',
  'player2_college_norm',
  'payment_screenshot_file',
  'payment_screenshot_data',
]);

/* ------------------------------------------------------------- connection */

let pool = null;

function buildPool() {
  const connection = DB_CONNECTION_STRING
    ? { connectionString: DB_CONNECTION_STRING }
    : {
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
      };

  const settings = {
    ...connection,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
    application_name: 'badminton-registration',
    // A stuck query during the event should fail rather than hold a connection.
    statement_timeout: 60000,
  };

  if (DB_SSL) {
    settings.ssl = DB_SSL_CA_FILE
      ? { ca: fs.readFileSync(DB_SSL_CA_FILE, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  }

  return new Pool(settings);
}

/**
 * Turn a driver error into something that says what to do about it. Messages
 * such as "connect ETIMEDOUT" tell a first time deployer nothing.
 */
function describeConnectionError(error) {
  const code = String((error && error.code) || '');
  const message = String((error && error.message) || '');

  const hints = {
    '28P01':
      'The database refused that password. Copy the connection line again, including the password.',
    '28000':
      'The database refused that user. A shared pooler connection needs the user name that includes the project reference, for example postgres.abcdefgh.',
    '3D000':
      'That database does not exist on the server. Check DB_NAME, or the last part of the connection line.',
    '42501':
      'The database user is not allowed to do that. It needs to create tables and, for a test run, a schema.',
    ECONNREFUSED: 'Nothing is listening on that host and port. Check DB_HOST and DB_PORT.',
    ENOTFOUND: 'The database host name could not be resolved. Copy the whole connection line again.',
    EAI_AGAIN: 'The database host name could not be resolved. Copy the whole connection line again.',
    ETIMEDOUT: 'The connection timed out. The host may be unreachable or a firewall may block it.',
    EHOSTUNREACH: 'The database host is unreachable from this machine.',
  };

  let hint = hints[code] || '';

  if (!hint && message.includes('Tenant or user not found')) {
    hint =
      'The pooler could not match that host and user to a project. Copy the Session pooler line ' +
      'from the Connect dialog as it is, because the pooler host and the user name both contain ' +
      'the project reference.';
  }
  if (!hint && message.includes('certificate')) {
    hint =
      'The TLS connection could not be verified. Set DB_SSL=false, or set DB_SSL_CA to the certificate.';
  }
  if (!hint && message.includes('password authentication failed')) hint = hints['28P01'];
  if (!hint && message.includes('does not exist')) hint = hints['3D000'];
  if (!hint) hint = 'The database could not be reached.';

  const lines = [
    'Cannot connect to the PostgreSQL database.',
    '',
    'Target: ' + DB_TARGET,
    'Driver said: ' + (message || 'unknown error'),
    '',
    hint,
  ];

  if (!DB_SSL && !['localhost', '127.0.0.1', '::1'].includes(DB_HOST)) {
    lines.push('This looks like a hosted database, which needs TLS: set DB_SSL=true.');
  }

  return new DatabaseConfigError(lines.join('\n'));
}

function getPool() {
  if (!pool) {
    throw new DatabaseConfigError(
      'The database has not been started yet. initDatabase() must run before any query.'
    );
  }
  return pool;
}

/* ---------------------------------------------------------------- helpers */

function nowIso() {
  return new Date().toISOString();
}

/** Remove internal helper columns before a record leaves the server. */
function toAdminRecord(row) {
  if (!row) return null;
  const record = {};
  for (const [key, value] of Object.entries(row)) {
    if (NORMALISED_COLUMNS.has(key)) continue;
    record[key] = value;
  }
  return record;
}

/**
 * Keys that may exist only once among teams that are not rejected. They are
 * written in the same transaction as the registration, so the database refuses
 * a duplicate rather than trusting the check that ran a moment earlier.
 */
function keysFor(values) {
  const player1Name = normalizeKey(values.player1_name);
  const player2Name = normalizeKey(values.player2_name);
  const pair = [player1Name, player2Name].sort();

  return [
    'team|' + normalizeKey(values.team_name),
    'email|' + normalizeKey(values.player1_email),
    'email|' + normalizeKey(values.player2_email),
    'pair|' + pair[0] + '|' + pair[1],
  ];
}

function keysForRow(row) {
  if (!row) return [];
  const pair = [row.player1_name_norm, row.player2_name_norm].sort();
  return [
    'team|' + row.team_name_norm,
    'email|' + row.player1_email_norm,
    'email|' + row.player2_email_norm,
    'pair|' + pair[0] + '|' + pair[1],
  ];
}

async function writeKeys(executor, id, keys) {
  for (const key of keys) {
    await executor.query(
      `INSERT INTO ${T.keys} (key_norm, registration_id) VALUES ($1, $2)`,
      [key, Number(id)]
    );
  }
}

async function writeKeysIgnoringDuplicates(executor, id, keys) {
  for (const key of keys) {
    await executor.query(
      `INSERT INTO ${T.keys} (key_norm, registration_id) VALUES ($1, $2)
       ON CONFLICT (key_norm) DO NOTHING`,
      [key, Number(id)]
    );
  }
}

function isDuplicateError(error) {
  const code = String((error && error.code) || '');
  const message = String((error && error.message) || '');
  return code === '23505' || message.includes('duplicate key value');
}

/**
 * Give a clear message for the rule that was broken. The checks below run
 * before the insert so the player sees something specific rather than a
 * database error, and the primary key still catches the rare race.
 */
async function assertNoDuplicate(executor, values) {
  const p1NameNorm = normalizeKey(values.player1_name);
  const p2NameNorm = normalizeKey(values.player2_name);

  const teamRows = await executor.query(
    `SELECT registration_id FROM ${T.keys} WHERE key_norm = $1 LIMIT 1`,
    ['team|' + normalizeKey(values.team_name)]
  );
  if (teamRows.rowCount > 0) {
    throw new DuplicateRegistrationError(
      'A team named "' +
        values.team_name +
        '" is already registered. Duplicate team names are not allowed, please contact the organizer if you need a change.'
    );
  }

  const pair = [p1NameNorm, p2NameNorm].sort();
  const pairRows = await executor.query(
    `SELECT registration_id FROM ${T.keys} WHERE key_norm = $1 LIMIT 1`,
    ['pair|' + pair[0] + '|' + pair[1]]
  );
  if (pairRows.rowCount > 0) {
    throw new DuplicateRegistrationError(
      'This pair of players is already registered as a team. Duplicate registrations are not allowed.'
    );
  }

  const emails = [normalizeKey(values.player1_email), normalizeKey(values.player2_email)];
  for (const email of emails) {
    const emailRows = await executor.query(
      `SELECT registration_id FROM ${T.keys} WHERE key_norm = $1 LIMIT 1`,
      ['email|' + email]
    );
    if (emailRows.rowCount === 0) continue;

    const owner = await executor.query(
      `SELECT player1_email, player1_email_norm, player2_email, player2_email_norm
         FROM ${T.registrations} WHERE id = $1 LIMIT 1`,
      [emailRows.rows[0].registration_id]
    );
    const used =
      owner.rowCount > 0 &&
      (owner.rows[0].player1_email_norm === email || owner.rows[0].player2_email_norm === email)
        ? owner.rows[0].player1_email_norm === email
          ? owner.rows[0].player1_email
          : owner.rows[0].player2_email
        : email;

    throw new DuplicateRegistrationError(
      'The email address ' +
        used +
        ' is already used in another registration. Each player can be part of only one team.'
    );
  }
}

/** Update one registration and report whether the registration exists at all. */
async function updateExisting(sql, params, id) {
  const result = await getPool().query(sql, params);
  if (result.rowCount > 0) return true;

  // A repeated action changes nothing, so no row is reported as updated.
  // Confirm the registration exists before treating that as "not found".
  const exists = await getPool().query(`SELECT id FROM ${T.registrations} WHERE id = $1`, [
    Number(id),
  ]);
  return exists.rowCount > 0;
}

/* ------------------------------------------------------------------ setup */

async function tableExists(name) {
  const result = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2`,
    [DB_SCHEMA, name]
  );
  return Number(result.rows[0].count) > 0;
}

async function applyMigrations() {
  for (const [table, column, definition] of COLUMN_MIGRATIONS) {
    await getPool().query(
      'ALTER TABLE ' +
        DB_SCHEMA +
        '.' +
        table +
        ' ADD COLUMN IF NOT EXISTS ' +
        column +
        ' ' +
        definition
    );
  }
}

/**
 * Fill the duplicate protection rows for registrations that were stored before
 * that table existed. Only runs when the table is created for the first time.
 */
async function backfillKeys() {
  const result = await getPool().query(
    `SELECT id, team_name, player1_name, player1_email, player2_name, player2_email
       FROM ${T.registrations} WHERE registration_status <> 'REJECTED'`
  );
  for (const row of result.rows) {
    await writeKeysIgnoringDuplicates(getPool(), row.id, keysFor(row));
  }
  return result.rowCount;
}

/**
 * Connect, create the tables if they are missing and apply small migrations.
 * @returns {Promise<{version: string, database: string, schema: string, backfilled: number}>}
 */
export async function initDatabase() {
  if (!DB_CONFIGURED) {
    throw new DatabaseConfigError(
      [
        'The PostgreSQL database is not configured.',
        '',
        'Paste the connection line from Supabase into the .env file in the',
        'project root, or set it as an environment variable where the site is',
        'hosted. In Supabase: Connect > Session pooler > copy the URI, then',
        'replace [YOUR-PASSWORD] with your database password.',
        '',
        '  DB_URL=postgresql://postgres.project:password@host:5432/postgres',
        '',
        'Separate values are also accepted: DB_HOST, DB_PORT, DB_NAME,',
        'DB_USER and DB_PASSWORD.',
        '',
        'Registrations are stored in PostgreSQL and not on disk, so the site',
        'keeps its data even when the server restarts or is redeployed.',
      ].join('\n')
    );
  }

  if (!DB_SCHEMA_VALID) {
    throw new DatabaseConfigError(
      'DB_SCHEMA must be a plain lowercase name of letters, digits and underscores, up to 63 ' +
        'characters. It is "' +
        DB_SCHEMA +
        '".'
    );
  }

  pool = buildPool();

  // An idle connection dropped by a hosted database emits an error on the
  // pool. Without a listener that would end the process.
  pool.on('error', (error) => {
    console.error('[database] connection error:', error && error.message);
  });

  let server;
  try {
    server = await pool.query(
      "SELECT current_setting('server_version') AS version, current_database() AS database"
    );
  } catch (error) {
    throw describeConnectionError(error);
  }

  try {
    if (DB_SCHEMA !== 'public') {
      await pool.query('CREATE SCHEMA IF NOT EXISTS ' + DB_SCHEMA);
    }

    const keysTableExisted = await tableExists('registration_keys');

    for (const statement of TABLE_STATEMENTS) {
      await pool.query(statement);
    }
    await applyMigrations();

    let backfilled = 0;
    if (!keysTableExisted) {
      backfilled = await backfillKeys();
    }

    return {
      version: String(server.rows[0].version || ''),
      database: String(server.rows[0].database || ''),
      schema: DB_SCHEMA,
      backfilled,
    };
  } catch (error) {
    if (error instanceof DatabaseConfigError) throw error;
    throw describeConnectionError(error);
  }
}

export async function closeDatabase() {
  if (!pool) return;
  const closing = pool;
  pool = null;
  try {
    await closing.end();
  } catch {
    /* nothing useful to do while shutting down */
  }
}

/**
 * Run one statement against the database.
 *
 * Nothing in the web routes uses this. It exists for the database check tool
 * and the tests, so both can read back what was really stored.
 */
export async function queryDatabase(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

/* ------------------------------------------------------------ registrations */

/**
 * Insert a registration. The duplicate check and the insert run inside one
 * transaction, and the duplicate rows are written in the same transaction, so
 * two simultaneous submissions of the same team cannot both succeed.
 */
export async function createRegistration(values, screenshot) {
  const now = nowIso();
  const connection = await getPool().connect();

  try {
    await connection.query('BEGIN');
    await assertNoDuplicate(connection, values);

    const inserted = await connection.query(
      `INSERT INTO ${T.registrations} (
         team_name, team_name_norm,
         player1_name, player1_name_norm, player1_email, player1_email_norm, player1_college, player1_college_norm, player1_mobile,
         player2_name, player2_name_norm, player2_email, player2_email_norm, player2_college, player2_college_norm, player2_mobile,
         payment_amount, payment_screenshot_file, payment_screenshot_mime, payment_screenshot_size, payment_screenshot_data, payment_screenshot_url,
         payment_status, registration_status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING id`,
      [
        values.team_name,
        normalizeKey(values.team_name),
        values.player1_name,
        normalizeKey(values.player1_name),
        values.player1_email,
        normalizeKey(values.player1_email),
        values.player1_college,
        normalizeKey(values.player1_college),
        values.player1_mobile,
        values.player2_name,
        normalizeKey(values.player2_name),
        values.player2_email,
        normalizeKey(values.player2_email),
        values.player2_college,
        normalizeKey(values.player2_college),
        values.player2_mobile,
        ENTRY_FEE,
        screenshot.fileName,
        screenshot.mimeType,
        screenshot.size,
        screenshot.buffer,
        '',
        PAYMENT_STATUS.PENDING,
        REGISTRATION_STATUS.PENDING,
        now,
        now,
      ]
    );

    const id = Number(inserted.rows[0].id);
    const screenshotUrl = '/api/admin/registrations/' + id + '/screenshot';
    await connection.query(
      `UPDATE ${T.registrations} SET payment_screenshot_url = $1 WHERE id = $2`,
      [screenshotUrl, id]
    );

    await writeKeys(connection, id, keysFor(values));
    await connection.query('COMMIT');

    return { id, paymentScreenshotUrl: screenshotUrl };
  } catch (error) {
    try {
      await connection.query('ROLLBACK');
    } catch {
      /* the transaction is already finished */
    }
    if (error instanceof DuplicateRegistrationError) throw error;
    if (isDuplicateError(error)) {
      throw new DuplicateRegistrationError(
        'A registration with the same team name, player or pair of players already exists. Duplicate registrations are not allowed.'
      );
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function getRegistration(id) {
  const result = await getPool().query(`SELECT * FROM ${T.registrations} WHERE id = $1`, [
    Number(id),
  ]);
  return toAdminRecord(result.rows[0]);
}

/**
 * The payment screenshot itself. It is kept in the database, so it cannot be
 * lost by a restart on a host without a persistent disk.
 * @returns {Promise<{mime: string, size: number, data: Buffer}|null>}
 */
export async function getRegistrationScreenshot(id) {
  const result = await getPool().query(
    `SELECT payment_screenshot_mime, payment_screenshot_size, payment_screenshot_data
       FROM ${T.registrations} WHERE id = $1`,
    [Number(id)]
  );

  const row = result.rows[0];
  if (!row || !row.payment_screenshot_data) return null;

  const data = Buffer.isBuffer(row.payment_screenshot_data)
    ? row.payment_screenshot_data
    : Buffer.from(row.payment_screenshot_data);

  return {
    mime: row.payment_screenshot_mime || 'application/octet-stream',
    size: Number(row.payment_screenshot_size) || data.length,
    data,
  };
}

/**
 * List registrations with an optional status filter and free text search.
 * Search covers team name, both player names, both colleges and both emails.
 */
export async function listRegistrations({ status, q } = {}) {
  const clauses = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return '$' + params.length;
  };

  if (status && status !== 'ALL') {
    clauses.push('registration_status = ' + add(status));
  }

  const query = normalizeKey(q);
  if (query) {
    // PostgreSQL treats a backslash as the escape character in a LIKE pattern
    // by default, so an escaped %, _ or backslash stays literal.
    const like = '%' + query.replace(/[\\%_]/g, (match) => '\\' + match) + '%';
    const marks = [];
    for (let index = 0; index < 7; index += 1) marks.push(add(like));
    clauses.push(
      `(team_name_norm LIKE ${marks[0]}
        OR player1_name_norm LIKE ${marks[1]}
        OR player2_name_norm LIKE ${marks[2]}
        OR player1_college_norm LIKE ${marks[3]}
        OR player2_college_norm LIKE ${marks[4]}
        OR player1_email_norm LIKE ${marks[5]}
        OR player2_email_norm LIKE ${marks[6]})`
    );
  }

  const sql =
    `SELECT * FROM ${T.registrations}` +
    (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') +
    ` ORDER BY CASE registration_status
        WHEN 'PENDING' THEN 0
        WHEN 'ACCEPTED' THEN 1
        ELSE 2
      END, id DESC`;

  const result = await getPool().query(sql, params);
  return result.rows.map(toAdminRecord);
}

/** Counts come straight from the database, they are never hardcoded. */
export async function getStats() {
  const result = await getPool().query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE registration_status = 'PENDING')::int AS pending,
       COUNT(*) FILTER (WHERE registration_status = 'ACCEPTED')::int AS accepted,
       COUNT(*) FILTER (WHERE registration_status = 'REJECTED')::int AS rejected,
       COUNT(*) FILTER (WHERE payment_status = 'VERIFIED')::int AS verified_payments
     FROM ${T.registrations}`
  );

  const row = result.rows[0] || {};
  return {
    total: Number(row.total || 0),
    pending: Number(row.pending || 0),
    accepted: Number(row.accepted || 0),
    rejected: Number(row.rejected || 0),
    verified_payments: Number(row.verified_payments || 0),
  };
}

/**
 * Cheap round trip to the database. Used by the public health check, so the
 * keep awake ping reports the real state of the site and its database rather
 * than just that the web process is running. It also counts as activity for a
 * Supabase project, which is paused after a week without any.
 */
export async function checkDatabase() {
  const result = await getPool().query('SELECT 1 AS ok');
  return result.rowCount > 0 && Number(result.rows[0].ok) === 1;
}

export async function acceptRegistration(id, adminUsername) {
  const now = nowIso();
  const exists = await updateExisting(
    `UPDATE ${T.registrations} SET
       registration_status = $1,
       payment_status = $2,
       rejection_reason = '',
       rejected_by = '',
       rejected_at = '',
       verified_by = $3,
       verified_at = $4,
       updated_at = $5
     WHERE id = $6`,
    [
      REGISTRATION_STATUS.ACCEPTED,
      PAYMENT_STATUS.VERIFIED,
      adminUsername,
      now,
      now,
      Number(id),
    ],
    id
  );

  if (!exists) return false;

  // A team that was rejected has no duplicate protection rows. Accepting it
  // claims them again, unless another team already holds that name.
  const row = await getPool().query(
    `SELECT team_name_norm, player1_name_norm, player1_email_norm, player2_name_norm, player2_email_norm
       FROM ${T.registrations} WHERE id = $1`,
    [Number(id)]
  );
  if (row.rowCount > 0) {
    await writeKeysIgnoringDuplicates(getPool(), id, keysForRow(row.rows[0]));
  }

  return true;
}

export async function rejectRegistration(id, adminUsername, reasonText, paymentFailed) {
  const now = nowIso();
  const exists = await updateExisting(
    `UPDATE ${T.registrations} SET
       registration_status = $1,
       payment_status = $2,
       rejection_reason = $3,
       rejected_by = $4,
       rejected_at = $5,
       verified_by = '',
       verified_at = '',
       updated_at = $6
     WHERE id = $7`,
    [
      REGISTRATION_STATUS.REJECTED,
      paymentFailed ? PAYMENT_STATUS.REJECTED : PAYMENT_STATUS.PENDING,
      reasonText,
      adminUsername,
      now,
      now,
      Number(id),
    ],
    id
  );

  if (!exists) return false;

  // Free the team name, the emails and the pair, so the same players may
  // register again after a rejection.
  await getPool().query(`DELETE FROM ${T.keys} WHERE registration_id = $1`, [Number(id)]);
  return true;
}

/* ----------------------------------------------------------------- admins */

export async function findAdminByUsername(username) {
  const result = await getPool().query(`SELECT * FROM ${T.admins} WHERE username = $1`, [
    String(username),
  ]);
  return result.rows[0];
}

export async function countAdmins() {
  const result = await getPool().query(`SELECT COUNT(*)::int AS count FROM ${T.admins}`);
  return Number(result.rows[0].count || 0);
}

/**
 * Drop every organizer account except the given one, so a username that was
 * used before can never sign in again.
 * @returns {Promise<number>} number of accounts removed
 */
export async function deleteAdminsExcept(username) {
  const result = await getPool().query(`DELETE FROM ${T.admins} WHERE username <> $1`, [
    String(username),
  ]);
  return Number(result.rowCount || 0);
}

/**
 * Invalidate every session token issued for this account. Tokens carry the
 * epoch they were issued with, so signing out really ends the session instead
 * of only dropping the cookie in the browser.
 */
export async function bumpAdminSessionEpoch(username) {
  await getPool().query(
    `UPDATE ${T.admins} SET session_epoch = session_epoch + 1, updated_at = $1 WHERE username = $2`,
    [nowIso(), String(username)]
  );
}

export async function upsertAdmin(username, passwordHash) {
  const now = nowIso();
  await getPool().query(
    `INSERT INTO ${T.admins} (username, password_hash, created_at, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, updated_at = EXCLUDED.updated_at`,
    [username, passwordHash, now, now]
  );
}

export { normalizeText };
