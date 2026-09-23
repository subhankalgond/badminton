import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');

/**
 * Load KEY=value lines from a .env file into the environment.
 *
 * The file is ignored by git, which is what keeps the organizer password and
 * the database password out of the repository. A variable already set in the
 * real environment wins, so `ADMIN_PASSWORD=... npm start` still overrides it.
 */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;

  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (process.env[name] !== undefined) continue;

    let value = line.slice(separator + 1).trim();
    const quoted =
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);

    process.env[name] = value;
  }
}

loadEnvFile(path.join(ROOT_DIR, '.env'));

export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const QR_DIR = path.join(PUBLIC_DIR, 'qr');

/* --------------------------------------------------------------- postgres */

/**
 * Accept a connection URI as well as separate values. Supabase hands you one
 * line from its Connect dialog, and pasting that is far less error prone than
 * splitting it into five parts. The raw line is handed to the driver, which
 * understands percent encoded passwords and query parameters, and it is also
 * read here for the settings that are shown to you.
 */
function parseDatabaseUrl(value) {
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;

  const sslMode = (url.searchParams.get('sslmode') || url.searchParams.get('ssl-mode') || '')
    .toLowerCase();

  return {
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    ssl: sslMode ? sslMode !== 'disable' && sslMode !== 'false' : null,
  };
}

/*
 * A connection URI describes the whole connection, so when one is given it
 * wins over the separate values. Without that rule, a leftover DB_PORT in a
 * .env file would quietly override the port inside the URI and the connection
 * would fail with no clue why.
 */
const rawConnectionString =
  process.env.DATABASE_URL || process.env.DB_URL || process.env.POSTGRES_URL || '';
const urlConfig = parseDatabaseUrl(rawConnectionString);

export const DB_CONNECTION_STRING = urlConfig ? rawConnectionString : '';

export const DB_HOST = (urlConfig && urlConfig.host) || process.env.DB_HOST || '';
export const DB_PORT = Number((urlConfig && urlConfig.port) || process.env.DB_PORT || 5432);
export const DB_USER = (urlConfig && urlConfig.user) || process.env.DB_USER || '';
export const DB_PASSWORD = (urlConfig && urlConfig.password) || process.env.DB_PASSWORD || '';
export const DB_NAME = (urlConfig && urlConfig.database) || process.env.DB_NAME || '';

/**
 * The schema that holds the tables. It is 'public' everywhere in normal use;
 * the tests point it at a throwaway schema so they can drop and rebuild their
 * tables without touching the real ones.
 */
export const DB_SCHEMA = process.env.DB_SCHEMA || 'public';
export const DB_SCHEMA_VALID = /^[a-z_][a-z0-9_]{0,62}$/.test(DB_SCHEMA);

/** True once enough is configured to attempt a connection. */
export const DB_CONFIGURED = Boolean(
  DB_CONNECTION_STRING || (DB_HOST && DB_USER && DB_NAME)
);

function parseBoolean(value) {
  if (value === undefined || value === '') return null;
  return ['1', 'true', 'yes', 'on', 'required'].includes(String(value).toLowerCase());
}

const explicitSsl = parseBoolean(process.env.DB_SSL);
const isLocalDatabase = ['localhost', '127.0.0.1', '::1', ''].includes(DB_HOST);

/**
 * Encrypt the connection unless the database is on this machine. Every hosted
 * database needs it, and Supabase refuses a plain connection outright.
 */
const sslDefault =
  urlConfig && urlConfig.ssl !== null ? urlConfig.ssl : !isLocalDatabase;
export const DB_SSL = explicitSsl === null ? sslDefault : explicitSsl;

/** Optional path to the server certificate, for a verified connection. */
export const DB_SSL_CA_FILE = process.env.DB_SSL_CA || '';

/** Host, port and database only. Never includes the password. */
export const DB_TARGET = DB_USER + '@' + DB_HOST + ':' + DB_PORT + '/' + DB_NAME;

/* ------------------------------------------------------------------ server */

/*
 * Registrations and payment screenshots are stored in PostgreSQL, so the site
 * writes nothing to disk. That is what lets it run on a host whose filesystem
 * is wiped on every restart or redeploy, and it means there is no folder to
 * keep, back up or mount. Back up the database instead.
 */

export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';

export const ENTRY_FEE = 300;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const SESSION_COOKIE = 'bd_admin_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Optional fixed key for signing session cookies. See src/auth.js. */
export const SESSION_SECRET = process.env.SESSION_SECRET || '';

// The one organizer account. The username is not a secret, so it has a
// default. The password is never written in this file: it comes from the real
// environment or from the gitignored .env file, and when neither is set the
// server creates a random password on first start and prints it once.
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'subhan';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/**
 * Look for the organizer's UPI QR image. Supported names, in order:
 * upi-qr.png, upi-qr.jpg, upi-qr.jpeg, upi-qr.webp.
 * @returns {string|null} public URL of the QR image, or null when missing.
 */
export function findQrImage() {
  const names = ['upi-qr.png', 'upi-qr.jpg', 'upi-qr.jpeg', 'upi-qr.webp'];
  for (const name of names) {
    if (fs.existsSync(path.join(QR_DIR, name))) {
      return '/qr/' + name;
    }
  }
  return null;
}
