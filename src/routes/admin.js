import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { UPLOAD_DIR } from '../config.js';
import {
  clearSessionCookie,
  getSession,
  requireAdmin,
  revokeSession,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { findAdminByUsername } from '../db.js';
import {
  REJECTION_REASONS,
  acceptRegistration,
  getRegistration,
  getRegistrationRaw,
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

router.get('/session', (req, res) => {
  const session = getSession(req);
  res.json({
    ok: true,
    authenticated: Boolean(session),
    username: session ? session.username : '',
  });
});

router.post('/login', loginLimit, (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');

  if (!username || !password || password.length > 200) {
    res.status(400).json({ ok: false, message: 'Enter your username and password.' });
    return;
  }

  const admin = findAdminByUsername(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    res.status(401).json({ ok: false, message: 'Invalid username or password.' });
    return;
  }

  setSessionCookie(req, res, admin.username, admin.session_epoch);
  res.json({ ok: true, username: admin.username });
});

router.post('/logout', (req, res) => {
  revokeSession(req);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get('/stats', requireAdmin, (req, res) => {
  res.json({ ok: true, stats: getStats() });
});

router.get('/registrations', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'ALL').toUpperCase();
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
  if (!STATUS_FILTERS.has(status)) {
    res.status(400).json({ ok: false, message: 'Unknown status filter.' });
    return;
  }
  res.json({
    ok: true,
    registrations: listRegistrations({ status, q: query }),
    rejection_reasons: REJECTION_REASONS.map((reason) => ({
      code: reason.code,
      label: reason.label,
    })),
  });
});

router.get('/registrations/:id/screenshot', requireAdmin, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, message: 'Invalid registration.' });
    return;
  }

  const record = getRegistrationRaw(id);
  if (!record || !record.payment_screenshot_file) {
    res.status(404).json({ ok: false, message: 'No payment screenshot for this registration.' });
    return;
  }

  const absolutePath = path.join(UPLOAD_DIR, path.basename(record.payment_screenshot_file));
  if (!absolutePath.startsWith(UPLOAD_DIR) || !fs.existsSync(absolutePath)) {
    res.status(404).json({ ok: false, message: 'The payment screenshot file is missing on the server.' });
    return;
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline; filename="payment-screenshot"');
  res.sendFile(absolutePath, (error) => {
    if (error) next(error);
  });
});

router.post('/registrations/:id/accept', requireAdmin, (req, res) => {
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

  const existing = getRegistration(id);
  if (!existing) {
    res.status(404).json({ ok: false, message: 'Registration not found.' });
    return;
  }

  const updated = acceptRegistration(id, req.adminUsername);
  if (!updated) {
    res.status(404).json({ ok: false, message: 'Registration not found.' });
    return;
  }

  res.json({ ok: true, registration: getRegistration(id) });
});

router.post('/registrations/:id/reject', requireAdmin, (req, res) => {
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

  const existing = getRegistration(id);
  if (!existing) {
    res.status(404).json({ ok: false, message: 'Registration not found.' });
    return;
  }

  const reasonText = code === 'other' ? 'Other: ' + customReason : reason.label;
  const updated = rejectRegistration(id, req.adminUsername, reasonText, reason.paymentFailed);
  if (!updated) {
    res.status(404).json({ ok: false, message: 'Registration not found.' });
    return;
  }

  res.json({ ok: true, registration: getRegistration(id) });
});

export default router;
