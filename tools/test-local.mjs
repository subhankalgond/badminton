/**
 * Runs the whole test suite against a PostgreSQL that lives inside this
 * process, so no database server, no account and no credentials are needed.
 *
 * Run with: npm run test:local
 *
 * It starts PGlite on a free local port, points the tests at it, then shuts it
 * down again. Nothing it does can reach your real database: the tests use a
 * throwaway schema of their own either way.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localDatabaseEnv, startLocalPostgres } from './local-pg.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Ask the operating system for a port that is free right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const instance = await startLocalPostgres({ port });
console.log('');
console.log('PostgreSQL running inside this process on 127.0.0.1:' + port);
console.log('No database server and no credentials are needed.');

const child = spawn(process.execPath, ['tools/smoke-test.mjs'], {
  cwd: root,
  env: { ...process.env, ...localDatabaseEnv(port) },
  stdio: 'inherit',
});

const code = await new Promise((resolve) => child.on('exit', resolve));
await instance.stop();
process.exit(code === 0 ? 0 : 1);
