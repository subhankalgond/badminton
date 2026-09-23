import express from 'express';
import multer from 'multer';
import { ENTRY_FEE, MAX_UPLOAD_BYTES, findQrImage } from '../config.js';
import { DuplicateRegistrationError, checkDatabase, createRegistration } from '../db.js';
import {
  ALLOWED_SCREENSHOT_TYPES,
  COLLEGE_MISMATCH_MESSAGE,
  MAX_SCREENSHOT_BYTES,
  SAME_COLLEGE_RULE,
  validateRegistration,
  validateScreenshot,
} from '../../public/js/validate.js';
import {
  buildScreenshotFileName,
  detectImageType,
  isAllowedImageType,
  rateLimit,
} from '../util.js';

const router = express.Router();

class UploadError extends Error {}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 25, fieldSize: 2048 },
  fileFilter(req, file, callback) {
    const type = String(file.mimetype || '').toLowerCase();
    if (!ALLOWED_SCREENSHOT_TYPES.includes(type)) {
      callback(new UploadError('Screenshot must be a JPG, JPEG, PNG, or WEBP image.'));
      return;
    }
    callback(null, true);
  },
});

// Whole colleges often share one public IP address, so the limit is set high
// enough for a busy registration day and still stops bulk abuse.
const registrationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  message: 'Too many registration attempts from this device. Please try again later.',
});

/** Public configuration for the registration page. */
router.get('/config', (req, res) => {
  const qrUrl = findQrImage();
  res.json({
    ok: true,
    entry_fee: ENTRY_FEE,
    max_screenshot_bytes: MAX_SCREENSHOT_BYTES,
    max_screenshot_label: '5 MB',
    allowed_screenshot_types: ALLOWED_SCREENSHOT_TYPES,
    same_college_rule: SAME_COLLEGE_RULE,
    college_mismatch_message: COLLEGE_MISMATCH_MESSAGE,
    qr_url: qrUrl,
    qr_available: Boolean(qrUrl),
  });
});

/**
 * Health check. Reports whether the site can reach its database, which is the
 * difference between being awake and being usable. Used by the schedule that
 * stops the free instance from going to sleep.
 */
router.get('/health', async (req, res) => {
  let ok = false;
  try {
    ok = await checkDatabase();
  } catch {
    ok = false;
  }
  res.status(ok ? 200 : 503).json({ ok, database: ok ? 'connected' : 'unavailable' });
});

/** Submit one team registration. Payment always stays PENDING here. */
router.post('/registrations', registrationLimit, (req, res, next) => {
  upload.single('payment_screenshot')(req, res, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof UploadError) {
        res.status(400).json({ ok: false, message: uploadError.message, screenshot_error: uploadError.message });
        return;
      }
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        const message = 'Screenshot must be 5 MB or smaller. Choose a smaller file.';
        res.status(413).json({ ok: false, message, screenshot_error: message });
        return;
      }
      next(uploadError);
      return;
    }

    handleRegistration(req, res, next).catch(next);
  });
});

async function handleRegistration(req, res, next) {
  const body = req.body || {};
  const validation = validateRegistration(body);
  // Multer exposes the upload as {originalname, mimetype, size}. The shared
  // validator expects the browser File shape, so map the fields here.
  const fileCheck = validateScreenshot(
    req.file
      ? { name: req.file.originalname, size: req.file.size, type: req.file.mimetype }
      : null
  );

  if (!validation.ok || !fileCheck.ok) {
    res.status(400).json({
      ok: false,
      message: !fileCheck.ok
        ? fileCheck.message
        : 'Please correct the highlighted fields and try again.',
      field_errors: validation.errors,
      screenshot_error: fileCheck.ok ? '' : fileCheck.message,
    });
    return;
  }

  // The browser sends a content type, but the real file signature decides.
  const detectedType = detectImageType(req.file.buffer);
  if (!detectedType || !isAllowedImageType(detectedType)) {
    const message = 'That file is not a valid JPG, PNG, or WEBP image.';
    res.status(400).json({ ok: false, message, screenshot_error: message });
    return;
  }

  try {
    // The screenshot is stored in the database with the registration, so it
    // cannot be lost by a restart on a host without a persistent disk.
    await createRegistration(validation.values, {
      fileName: buildScreenshotFileName(detectedType),
      mimeType: detectedType,
      size: req.file.size,
      buffer: req.file.buffer,
    });
  } catch (error) {
    if (error instanceof DuplicateRegistrationError) {
      res.status(409).json({ ok: false, message: error.message });
      return;
    }
    next(error);
    return;
  }

  res.status(201).json({
    ok: true,
    registration_status: 'PENDING',
    payment_status: 'PENDING',
    payment_amount: ENTRY_FEE,
    message:
      'Your registration has been submitted successfully and is currently PENDING PAYMENT VERIFICATION.',
  });
}

export default router;
