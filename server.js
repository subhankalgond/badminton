import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { DB_SSL, DB_TARGET, HOST, PORT, PUBLIC_DIR, findQrImage } from './src/config.js';
import { ensureAdminAccount } from './src/auth.js';
import { closeDatabase, initDatabase } from './src/db.js';
import publicRoutes from './src/routes/public.js';
import adminRoutes from './src/routes/admin.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    dotfiles: 'ignore',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

const pages = {
  '/': 'index.html',
  '/admin': 'admin.html',
  '/terms': 'terms.html',
  '/privacy': 'privacy.html',
};

app.get('/favicon.ico', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'favicon.ico')));

for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}

app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ ok: false, message: 'Not found.' });
    return;
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  const isUploadError = error instanceof multer.MulterError;

  if (isUploadError && error.code === 'LIMIT_FILE_SIZE') {
    const message = 'Screenshot must be 5 MB or smaller. Choose a smaller file.';
    res.status(413).json({ ok: false, message, screenshot_error: message });
    return;
  }

  if (error && (error.type === 'entity.too.large' || error.status === 413)) {
    res.status(413).json({ ok: false, message: 'The request is too large.' });
    return;
  }

  console.error('[error]', req.method, req.originalUrl, error);
  res.status(500).json({
    ok: false,
    message: 'Something went wrong on the server. Please try again.',
  });
});

// The database comes first: a registration that cannot be stored is worse
// than a site that refuses to start.
let database;
try {
  database = await initDatabase();
} catch (error) {
  console.error('');
  console.error(error && error.message ? error.message : error);
  console.error('');
  process.exit(1);
}

const organizer = await ensureAdminAccount();

const server = app.listen(PORT, HOST, () => {
  const qr = findQrImage();
  // Read the port back from the server, so printing stays correct when PORT
  // is 0 and the operating system picks a free port.
  const listeningPort = server.address().port;
  console.log('');
  console.log('Badminton doubles registration is running.');
  console.log('Registration page: http://localhost:' + listeningPort + '/');
  console.log('Admin dashboard:   http://localhost:' + listeningPort + '/admin');
  for (const address of localAddresses()) {
    console.log('On your phone (same Wi-Fi): http://' + address + ':' + listeningPort + '/');
  }
  console.log('Payment QR code:   ' + (qr ? qr + ' (found)' : 'add your image to public/qr/upi-qr.png'));
  console.log('Organizer login:   ' + organizer.username + ' (password from .env)');
  // Printed so a hosted deploy can be checked at a glance. Registrations and
  // payment screenshots live in this database, so nothing is stored on the
  // server's disk and a restart cannot lose them.
  console.log(
    'Database:          ' + DB_TARGET + ' (PostgreSQL ' + database.version + ', schema ' +
      database.schema + ', TLS ' + (DB_SSL ? 'on' : 'off') + ')'
  );
  console.log('');
});

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function shutdown() {
  console.log('\nShutting down.');
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
