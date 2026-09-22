import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');

/**
 * Load KEY=value lines from a .env file into the environment.
 *
 * The file is ignored by git, which is what keeps the organizer password out
 * of the repository. A variable already set in the real environment wins, so
 * `ADMIN_PASSWORD=... npm start` still overrides the file.
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
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(ROOT_DIR, 'uploads');
export const QR_DIR = path.join(PUBLIC_DIR, 'qr');

export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';

export const ENTRY_FEE = 300;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const SESSION_COOKIE = 'bd_admin_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// The one organizer account. The username is not a secret, so it has a
// default. The password is never written in this file: it comes from the real
// environment or from the gitignored .env file, and when neither is set the
// server creates a random password on first start and prints it once.
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'subhan';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/**
 * Create a folder the site must be able to write to, and explain clearly when
 * it cannot. Hosted platforms that give the code a read only filesystem, such
 * as Vercel, fail here, and a plain crash gives no clue why.
 */
function ensureWritableDir(dir, label, variable) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    console.error('');
    console.error('Cannot write to the ' + label + ' folder: ' + dir);
    console.error('');
    console.error('This site keeps its database and the payment screenshots on');
    console.error('disk, so it needs a folder that survives a restart. Point the');
    console.error(variable + ' environment variable at a writable folder, or deploy');
    console.error('on a host that gives you a persistent disk mounted on the app.');
    console.error('');
    console.error('It cannot run on a platform with a read only or temporary');
    console.error('filesystem, because every registration would be lost.');
    console.error('');
    process.exit(1);
  }
}

ensureWritableDir(DATA_DIR, 'data', 'DATA_DIR');
ensureWritableDir(UPLOAD_DIR, 'uploads', 'UPLOAD_DIR');

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
