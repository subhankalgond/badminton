/**
 * Test the database settings on their own, without starting the site.
 *
 * Run with: npm run db:check
 *
 * Reads the same .env file the server reads, connects, creates the tables if
 * they are missing, then reports what it found. Handy when a hosted database
 * refuses the connection and the reason is not obvious.
 */
import { DB_CONFIGURED, DB_SCHEMA, DB_SSL, DB_TARGET } from '../src/config.js';
import { checkDatabase, closeDatabase, getStats, initDatabase } from '../src/db.js';

if (!DB_CONFIGURED) {
  console.error('');
  console.error('No database is configured. Paste the Supabase connection line into .env as:');
  console.error('');
  console.error('  DB_URL=postgresql://postgres.project:password@host:5432/postgres');
  console.error('');
  process.exit(1);
}

console.log('Trying ' + DB_TARGET + ' (schema ' + DB_SCHEMA + ') ...');

try {
  const info = await initDatabase();
  const reachable = await checkDatabase();
  const stats = await getStats();

  console.log('');
  console.log('Connected.');
  console.log('  PostgreSQL:     ' + info.version);
  console.log('  Database:       ' + info.database);
  console.log('  Schema:         ' + info.schema);
  console.log('  Encryption:     ' + (DB_SSL ? 'on' : 'off'));
  console.log('  Reachable:      ' + (reachable ? 'yes' : 'no'));
  console.log('  Tables ready:   registrations, registration_keys, admins');
  console.log('  Stored so far:  ' + stats.total + ' registrations');
  if (info.backfilled > 0) {
    console.log('  Protection:     rebuilt for ' + info.backfilled + ' existing registrations');
  }
  console.log('');
  console.log('These settings work. The site will use this database.');
} catch (error) {
  console.error('');
  console.error(error && error.message ? error.message : error);
  console.error('');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
