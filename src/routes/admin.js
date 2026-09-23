import express from 'express';
import {
  clearSessionCookie,
  getSession,
  requireAdmin,
  revokeSession,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import {
  REJECTION_REASONS,
  acceptRegistration,
  findAdminByUsername,
  getRegistration,
  getRegistrationScreenshot,
  getStats,
  listRegistrations,
  rejectRegistration,
} from '../db.js';
import { rateLimit } from '../util.js';

const router = express.Router();

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign in attempts. Please wait 15 minutes and try again.',
});

const STATUS_FILTERS = new Set(['ALL', 'PENDING', 'ACCEPTED', 'REJECTED']);
const REASON_BY_CODE = new Map(REJECTION_REASONS.map((reason) => [reason.code, reason]));

router.get('/session', async (req, res, next) => {
  try {
    const session = await getSession(req);
    res.json({
      ok: true,
      authenticated: Boolean(session),
      username: session ? session.username : '',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', loginLimit, async (req, res, next) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');

  if (!username || !password || password.length > 200) {
    res.status(400).json({ ok: false, message: 'Enter your username and password.' });
    return;
  }

  try {
    const admin = await findAdminByUsername(username);
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      res.status(401).json({ ok: false, message: 'Invalid username or password.' });
      return;
    }

    setSessionCookie(req, res, admin.username, admin.session_epoch);
    res.json({ ok: true, username: admin.username });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await revokeSession(req);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', requireAdmin, async (req, res, next) => {
  try {
    res.json({ ok: true, stats: await getStats() });
  } catch (error) {
    next(error);
  }
});

router.get('/registrations', requireAdmin, async (req, res, next) => {
  const status = String(req.query.status || 'ALL').toUpperCase();
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
  if (!STATUS_FILTERS.has(status)) {
    res.status(400).json({ ok: false, message: 'Unknown status filter.' });
    return;
  }

  try {
    res.json({
      ok: true,
      registrations: await listRegistrations({ status, q: query }),
      rejection_reasons: REJECTION_REASONS.map((reason) => ({
        code: reason.code,
        label: reason.label,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * The payment screenshot, read from the database. It is only reachable through
 * this signed in route, and never served as a static file.
 */
router.get('/registrations/:id/screenshot', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, message: 'Invalid registration.' });
    return;
  }

  try {
    const screenshot = await getRegistrationScreenshot(id);
    if (!screenshot) {
      res.status(404).json({ ok: false, message: 'No payment screenshot for this registration.' });
      return;
    }

    res.setHeader('Content-Type', screenshot.mime);
    res.setHeader('Content-Length', String(screenshot.data.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline; filename="payment-screenshot"');
    res.end(screenshot.data);
  } catch (error) {
    next(error);
  }
});

router.post('/registrations/:id/accept', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const confirmed = Boolean(req.body && req.body.confirm === true);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, message: 'Invalid registration.' });
    return;
  }
  if (!confirmed) {
    res.status(400).json({
      ok: false,
      message: 'Confirmation is required before a registration can be accepted.',
    });
    return;
  }

  try {
    const existing = await getRegistration(id);
    if (!existing) {
      res.status(404).json({ ok: false, message: 'Registration not found.' });
      return;
    }

    const updated = await acceptRegistration(id, req.adminUsername);
    if (!updated) {
      res.status(404).json({ ok: false, message: 'Registration not found.' });
      return;
    }

    res.json({ ok: true, registration: await getRegistration(id) });
  } catch (error) {
    next(error);
  }
});

router.post('/registrations/:id/reject', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const code = String(body.reason || '').trim();
  const customReason = String(body.custom_reason || '').trim().slice(0, 300);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, message: 'Invalid registration.' });
    return;
  }

  const reason = REASON_BY_CODE.get(code);
  if (!reason) {
    res.status(400).json({ ok: false, message: 'Choose a rejection reason.' });
    return;
  }

  if (code === 'other' && customReason.length < 3) {
    res.status(400).json({
      ok: false,
      message: 'Enter a custom rejection reason of at least 3 characters.',
    });
    return;
  }

  try {
    const existing = await getRegistration(id);
    if (!existing) {
      res.status(404).json({ ok: false, message: 'Registration not found.' });
      return;
    }

    const reasonText = code === 'other' ? 'Other: ' + customReason : reason.label;
    const updated = await rejectRegistration(id, req.adminUsername, reasonText, reason.paymentFailed);
    if (!updated) {
      res.status(404).json({ ok: false, message: 'Registration not found.' });
      return;
    }

    res.json({ ok: true, registration: await getRegistration(id) });
  } catch (error) {
    next(error);
  }
});

export default router;
