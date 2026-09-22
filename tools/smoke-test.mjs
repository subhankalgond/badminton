/**
 * End to end test of the public registration flow and the admin dashboard
 * API. Starts a real server on a test port with its own database and upload
 * folder, then runs the whole tournament flow against it.
 *
 * Run with: npm test
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, encodePng, fillRect } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const runDir = path.join(root, 'tmp', 'test-run');
const port = Number(process.env.TEST_PORT || 4123);
const base = 'http://127.0.0.1:' + port;
const adminPassword = 'test-password-123';

let passed = 0;
let failed = 0;
let sessionCookie = '';

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  ok   ' + label);
  } else {
    failed += 1;
    console.log('  FAIL ' + label + (detail ? ' -> ' + detail : ''));
  }
}

function samplePng(width = 40, height = 60, colour = [15, 107, 63]) {
  const canvas = createCanvas(width, height);
  fillRect(canvas, 0, 0, width, height, [255, 255, 255]);
  fillRect(canvas, 4, 4, width - 8, height - 8, colour);
  return encodePng(width, height, canvas.data);
}

function teamForm(overrides = {}, file) {
  const fields = {
    team_name: 'Court Kings',
    player1_name: 'Rahul Sharma',
    player1_email: 'rahul.sharma@example.com',
    player1_college: 'Anjuman Institute of Technology and Management',
    player2_name: 'Imran Khan',
    player2_email: 'imran.khan@example.com',
    player2_college: 'anjuman  institute of technology and management',
    ...overrides,
  };

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, value);
  }
  if (file !== null) {
    const image = file || samplePng();
    form.append('payment_screenshot', new File([image], 'payment.png', { type: 'image/png' }));
  }
  return form;
}

async function submit(form) {
  const response = await fetch(base + '/api/registrations', { method: 'POST', body: form });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { status: response.status, data };
}

function admin(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (sessionCookie) headers.Cookie = sessionCookie;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(base + pathname, { ...options, headers });
}

async function adminJson(pathname, options) {
  const response = await admin(pathname, options);
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { status: response.status, data };
}

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(base + '/api/config');
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function run() {
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });

  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: path.join(runDir, 'data'),
      UPLOAD_DIR: path.join(runDir, 'uploads'),
      ADMIN_USERNAME: 'organizer',
      ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  try {
    const ready = await waitForServer();
    if (!ready) {
      console.log('Server did not start. Output:\n' + serverLog);
      process.exitCode = 1;
      return;
    }

    console.log('\nPublic configuration and pages');
    const config = await (await fetch(base + '/api/config')).json();
    check('config reports the fixed entry fee', config.entry_fee === 300, JSON.stringify(config.entry_fee));
    check('config finds the organizer QR image', config.qr_available === true);
    check('config points at the QR image', config.qr_url === '/qr/upi-qr.png', String(config.qr_url));
    const qrResponse = await fetch(base + '/qr/upi-qr.png');
    check('QR image is served for the payment section', qrResponse.status === 200);
    check(
      'QR image is a png',
      (qrResponse.headers.get('content-type') || '').includes('image/png')
    );
    const logoResponse = await fetch(base + '/img/aitm-logo.png');
    check('institute crest is served', logoResponse.status === 200);
    check(
      'institute crest is a png',
      (logoResponse.headers.get('content-type') || '').includes('image/png')
    );
    check(
      'config carries the same college rule text as the page',
      config.same_college_rule.includes('must belong to the SAME COLLEGE')
    );

    const home = await fetch(base + '/');
    const homeHtml = await home.text();
    check('registration page loads', home.status === 200 && homeHtml.includes('Submit Registration'));
    check(
      'registration page shows the important same college rule',
      homeHtml.includes(
        'IMPORTANT: Both players in a team must belong to the SAME COLLEGE. Players from different colleges cannot form a team. Only teams with both players from the same college will be accepted.'
      )
    );
    check('registration page shows the entry fee', homeHtml.includes('₹300') && homeHtml.includes('ENTRY FEE'));
    check('registration page shows the payment instruction', homeHtml.includes('Scan the QR code and pay ₹300.'));
    check(
      'registration page shows the pending verification notice',
      homeHtml.includes('Uploading a payment screenshot does not automatically confirm your registration.')
    );
    check('registration page has the submission status wording', homeHtml.includes('PENDING VERIFICATION'));
    check('terms page loads', (await fetch(base + '/terms')).status === 200);
    check('privacy page loads', (await fetch(base + '/privacy')).status === 200);
    check('admin page loads', (await fetch(base + '/admin')).status === 200);
    check('favicon is served', (await fetch(base + '/favicon.ico')).status === 200);
    check('unknown page returns 404', (await fetch(base + '/nope')).status === 404);

    console.log('\nRegistration submission');
    const first = await submit(teamForm());
    check('valid team is accepted', first.status === 201, JSON.stringify(first.data));
    check('response keeps the registration pending', first.data.registration_status === 'PENDING');
    check('response keeps the payment pending', first.data.payment_status === 'PENDING');

    const amountForm = teamForm({
      team_name: 'Fee Check XI',
      player1_name: 'Nikhil Verma',
      player1_email: 'nikhil.verma@example.com',
      player1_college: 'City College of Commerce',
      player2_name: 'Arjun Das',
      player2_email: 'arjun.das@example.com',
      player2_college: 'City College of Commerce',
    });
    amountForm.append('payment_amount', '1');
    const cheap = await submit(amountForm);
    check('server ignores a client supplied amount', cheap.status === 201, JSON.stringify(cheap.data));

    const sameCollegeDifferentCase = await submit(
      teamForm({
        team_name: 'Court Kings Two',
        player1_name: 'Ravi Menon',
        player1_email: 'ravi.menon@example.com',
        player2_name: 'Sunil Joseph',
        player2_email: 'sunil.joseph@example.com',
        player1_college: '  ST. XAVIER   College  ',
        player2_college: 'st. xavier college',
      })
    );
    check(
      'college match ignores case and extra spaces',
      sameCollegeDifferentCase.status === 201,
      JSON.stringify(sameCollegeDifferentCase.data)
    );

    const differentCollege = await submit(
      teamForm({
        team_name: 'Mixed College Team',
        player1_email: 'p1c@example.com',
        player2_email: 'p2c@example.com',
        player1_college: 'Anjuman Institute of Technology and Management',
        player2_college: 'Government Engineering College',
      })
    );
    check('different colleges are rejected', differentCollege.status === 400);
    check(
      'different colleges return the required message',
      differentCollege.data.field_errors &&
        differentCollege.data.field_errors.player1_college ===
          'Both players must be from the same college. Players from different colleges cannot register as a team.',
      JSON.stringify(differentCollege.data.field_errors)
    );

    const duplicateTeam = await submit(
      teamForm({ player1_email: 'other1@example.com', player2_email: 'other2@example.com' })
    );
    check('duplicate team name is rejected', duplicateTeam.status === 409, JSON.stringify(duplicateTeam.data));

    const duplicateEmail = await submit(
      teamForm({ team_name: 'Another Team', player2_email: 'imran.khan@example.com' })
    );
    check('reused player email is rejected', duplicateEmail.status === 409, JSON.stringify(duplicateEmail.data));

    const duplicatePair = await submit(
      teamForm({
        team_name: 'Third Team Name',
        player1_email: 'rahul.sharma.new@example.com',
        player2_email: 'imran.khan.new@example.com',
      })
    );
    check('the same pair of players cannot register twice', duplicatePair.status === 409, JSON.stringify(duplicatePair.data));

    const freshPair = await submit(
      teamForm({
        team_name: 'Smash Brothers',
        player1_name: 'Mohit Sethi',
        player1_email: 'mohit.sethi@example.com',
        player1_college: 'Anjuman Institute of Technology and Management',
        player2_name: 'Karan Bedi',
        player2_email: 'karan.bedi@example.com',
        player2_college: 'Anjuman Institute of Technology and Management',
      })
    );
    check('a different pair of players is accepted', freshPair.status === 201, JSON.stringify(freshPair.data));

    const noFile = await submit(teamForm({ team_name: 'No Screenshot Team' }, null));
    check('missing screenshot is rejected', noFile.status === 400, JSON.stringify(noFile.data));

    const wrongType = new FormData();
    for (const [key, value] of Object.entries({
      team_name: 'Wrong File Team',
      player1_name: 'Amit Patel',
      player1_email: 'amit@example.com',
      player1_college: 'City College',
      player2_name: 'Vijay Rao',
      player2_email: 'vijay@example.com',
      player2_college: 'City College',
    })) {
      wrongType.append(key, value);
    }
    wrongType.append(
      'payment_screenshot',
      new File([Buffer.from('not an image at all')], 'fake.png', { type: 'image/png' })
    );
    const fake = await submit(wrongType);
    check('spoofed image content is rejected', fake.status === 400, JSON.stringify(fake.data));

    const executable = new FormData();
    for (const [key, value] of Object.entries({
      team_name: 'Binary Team',
      player1_name: 'Amit Patel',
      player1_email: 'amit2@example.com',
      player1_college: 'City College',
      player2_name: 'Vijay Rao',
      player2_email: 'vijay2@example.com',
      player2_college: 'City College',
    })) {
      executable.append(key, value);
    }
    executable.append(
      'payment_screenshot',
      new File([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])], 'run.exe', { type: 'image/png' })
    );
    const badBinary = await submit(executable);
    check('executable upload is rejected', badBinary.status === 400, JSON.stringify(badBinary.data));

    console.log('\nUpload limits');
    const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 2048, 1);
    let tooBig;
    try {
      tooBig = await submit(
        teamForm({ team_name: 'Huge Screenshot Team', player1_email: 'h1@example.com', player2_email: 'h2@example.com' }, bigBuffer)
      );
    } catch (error) {
      tooBig = { status: 0, data: { message: String(error.message) } };
    }
    check('oversized screenshot is rejected with 413', tooBig.status === 413, 'status ' + tooBig.status);

    console.log('\nPublic access is blocked');
    check('admin stats need a session', (await fetch(base + '/api/admin/stats')).status === 401);
    check('registration list needs a session', (await fetch(base + '/api/admin/registrations')).status === 401);
    check('screenshot needs a session', (await fetch(base + '/api/admin/registrations/1/screenshot')).status === 401);
    check(
      'accept needs a session',
      (
        await fetch(base + '/api/admin/registrations/1/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        })
      ).status === 401
    );
    const uploadFiles = fs.readdirSync(path.join(runDir, 'uploads'));
    check('screenshots are stored on disk', uploadFiles.length > 0, uploadFiles.join(', '));
    check(
      'uploaded screenshots are not published as static files',
      (await fetch(base + '/' + uploadFiles[0])).status === 404
    );

    console.log('\nAdmin authentication');
    const wrongLogin = await adminJson('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'organizer', password: 'wrong-password' }),
    });
    check('wrong password is refused', wrongLogin.status === 401);

    const loginResponse = await fetch(base + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'organizer', password: adminPassword }),
    });
    const loginData = await loginResponse.json();
    const setCookie = loginResponse.headers.getSetCookie();
    sessionCookie = setCookie && setCookie.length ? setCookie[0].split(';')[0] : '';
    check('correct password signs in', loginResponse.status === 200, JSON.stringify(loginData));
    check('session cookie is http only', /HttpOnly/i.test(String(setCookie)), String(setCookie));

    const session = await adminJson('/api/admin/session');
    check('session endpoint reports the signed in user', session.data.authenticated === true && session.data.username === 'organizer');

    console.log('\nDashboard data');
    const stats = await adminJson('/api/admin/stats');
    check('stats come from the database', stats.data.stats.total === 4, JSON.stringify(stats.data.stats));
    check('pending count is correct', stats.data.stats.pending === 4);
    check('accepted count starts at zero', stats.data.stats.accepted === 0);

    const all = await adminJson('/api/admin/registrations?status=ALL');
    check('all registrations are listed', all.data.registrations.length === 4);
    check(
      'stored amount is always 300',
      all.data.registrations.every((item) => item.payment_amount === 300),
      JSON.stringify(all.data.registrations.map((item) => item.payment_amount))
    );
    const feeCheck = all.data.registrations.find((item) => item.team_name === 'Fee Check XI');
    check('client supplied amount did not change the stored fee', feeCheck && feeCheck.payment_amount === 300);
    check('normalised helper columns are not exposed', feeCheck && feeCheck.team_name_norm === undefined);

    const search = await adminJson('/api/admin/registrations?status=ALL&q=imran');
    check('search matches a player name', search.data.registrations.length === 1, String(search.data.registrations.length));
    const searchCollege = await adminJson(
      '/api/admin/registrations?status=ALL&q=' + encodeURIComponent('anjuman')
    );
    check(
      'search matches a college',
      searchCollege.data.registrations.length === 2,
      String(searchCollege.data.registrations.length)
    );
    const searchEmail = await adminJson('/api/admin/registrations?status=ALL&q=rahul.sharma@example.com');
    check('search matches an email', searchEmail.data.registrations.length === 1);
    const searchTeam = await adminJson('/api/admin/registrations?status=ALL&q=court%20kings%20two');
    check('search matches a team name', searchTeam.data.registrations.length === 1);
    const filterPending = await adminJson('/api/admin/registrations?status=PENDING');
    check('status filter works', filterPending.data.registrations.length === 4);
    const badFilter = await adminJson('/api/admin/registrations?status=WHATEVER');
    check('unknown filter is refused', badFilter.status === 400);

    console.log('\nPayment screenshot access');
    const targetId = feeCheck.id;
    const shot = await admin('/api/admin/registrations/' + targetId + '/screenshot');
    check('screenshot downloads for the signed in admin', shot.status === 200);
    check('screenshot is served as a png', (shot.headers.get('content-type') || '').includes('image/png'));
    check('screenshot is not cached', (shot.headers.get('cache-control') || '').includes('no-store'));

    console.log('\nAccept and reject');
    const acceptWithoutConfirm = await adminJson('/api/admin/registrations/' + targetId + '/accept', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    check('accept without confirmation is refused', acceptWithoutConfirm.status === 400);

    const accepted = await adminJson('/api/admin/registrations/' + targetId + '/accept', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    check('accept works', accepted.status === 200, JSON.stringify(accepted.data));
    check('accepted registration keeps its status', accepted.data.registration.registration_status === 'ACCEPTED');
    check('accepted payment is verified', accepted.data.registration.payment_status === 'VERIFIED');
    check('verifying admin is recorded', accepted.data.registration.verified_by === 'organizer');
    check('verification time is recorded', Boolean(accepted.data.registration.verified_at));

    const acceptedList = await adminJson('/api/admin/registrations?status=ACCEPTED');
    check('accepted teams list contains one team', acceptedList.data.registrations.length === 1);

    const statsAfterAccept = await adminJson('/api/admin/stats');
    check('stats update after accepting', statsAfterAccept.data.stats.accepted === 1 && statsAfterAccept.data.stats.pending === 3);

    const otherTeam = all.data.registrations.find((item) => item.team_name === 'Court Kings Two');
    const rejectNoReason = await adminJson('/api/admin/registrations/' + otherTeam.id + '/reject', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    check('reject without a reason is refused', rejectNoReason.status === 400);

    const rejectOtherWithoutText = await adminJson('/api/admin/registrations/' + otherTeam.id + '/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'other' }),
    });
    check('custom reason is required for other', rejectOtherWithoutText.status === 400);

    const rejected = await adminJson('/api/admin/registrations/' + otherTeam.id + '/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'fake_payment_screenshot' }),
    });
    check('reject works', rejected.status === 200, JSON.stringify(rejected.data));
    check('rejected registration status is stored', rejected.data.registration.registration_status === 'REJECTED');
    check('rejection reason is stored', rejected.data.registration.rejection_reason === 'Fake payment screenshot');
    check('rejecting admin is recorded', rejected.data.registration.rejected_by === 'organizer');
    check('rejection time is recorded', Boolean(rejected.data.registration.rejected_at));

    const rejectedOther = await adminJson('/api/admin/registrations/' + otherTeam.id + '/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'other', custom_reason: 'Team withdrew from the tournament' }),
    });
    check('custom reason is stored', rejectedOther.data.registration.rejection_reason === 'Other: Team withdrew from the tournament');

    console.log('\nRejected teams may register again');
    const retry = await submit(
      teamForm({
        team_name: 'Court Kings Two',
        player1_name: 'Ravi Menon',
        player1_email: 'ravi.menon@example.com',
        player2_name: 'Sunil Joseph',
        player2_email: 'sunil.joseph@example.com',
        player1_college: 'st xavier college',
        player2_college: 'ST XAVIER COLLEGE',
      })
    );
    check('rejected team details can be submitted again', retry.status === 201, JSON.stringify(retry.data));

    const finalStats = await adminJson('/api/admin/stats');
    check(
      'final statistics match the database',
      finalStats.data.stats.total === 5 &&
        finalStats.data.stats.accepted === 1 &&
        finalStats.data.stats.rejected === 1 &&
        finalStats.data.stats.pending === 3,
      JSON.stringify(finalStats.data.stats)
    );

    console.log('\nSign out');
    const logout = await admin('/api/admin/logout', { method: 'POST' });
    check('sign out works', logout.status === 200);
    const afterLogout = await fetch(base + '/api/admin/stats', { headers: { Cookie: sessionCookie } });
    check('old session is refused after sign out', afterLogout.status === 401);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      server.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

run()
  .catch((error) => {
    failed += 1;
    console.error('\nTest run crashed:', error);
  })
  .finally(() => {
    console.log('\n' + passed + ' checks passed, ' + failed + ' failed.');
    if (failed > 0) process.exitCode = 1;
  });
