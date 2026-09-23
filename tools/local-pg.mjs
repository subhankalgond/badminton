/**
 * Runs a real PostgreSQL inside this process, on a local port, so the ordinary
 * pg client can connect to it.
 *
 * It is PostgreSQL compiled to WebAssembly (PGlite). Nothing is installed,
 * nothing runs as a service, and no credentials are involved. It exists so the
 * test suite can run on a machine that has no database, which is the point:
 * the tests never have to touch the database the site really uses.
 *
 * Started by `npm run test:local`. It can also be run on its own:
 *
 *   node tools/local-pg.mjs
 *   DB_HOST=127.0.0.1 DB_PORT=5599 DB_NAME=postgres DB_USER=postgres \
 *     DB_PASSWORD=local npm run db:check
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export async function startLocalPostgres({ port = 5599 } = {}) {
  const db = new PGlite();
  await db.waitReady;

  const server = new PGLiteSocketServer({
    db,
    port,
    host: '127.0.0.1',
    // The site holds a pool of connections and the tests hold one of their
    // own, so more than the default single connection is needed.
    maxConnections: 10,
  });
  await server.start();

  return {
    port,
    async stop() {
      try {
        await server.stop();
        await db.close();
      } catch {
        /* nothing useful to do while shutting down */
      }
    },
  };
}

/** The environment a client needs in order to reach that database. */
export function localDatabaseEnv(port) {
  return {
    DB_HOST: '127.0.0.1',
    DB_PORT: String(port),
    DB_NAME: 'postgres',
    DB_USER: 'postgres',
    DB_PASSWORD: 'local',
    // A configured connection line would win over the values above, which
    // would send a local test run at the real database instead.
    DB_URL: '',
    DATABASE_URL: '',
    POSTGRES_URL: '',
    DB_SSL: 'false',
  };
}

// Run on its own, rather than being imported by the test runner.
const startedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (startedDirectly) {
  const instance = await startLocalPostgres({ port: Number(process.env.PG_PORT || 5599) });
  console.log('PostgreSQL is listening on 127.0.0.1:' + instance.port);

  const stop = async () => {
    await instance.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
