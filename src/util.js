import { randomBytes } from 'node:crypto';
import { ALLOWED_SCREENSHOT_TYPES } from '../public/js/validate.js';

/**
 * Inspect the first bytes of an uploaded file. Content-Type headers sent by a
 * browser can be spoofed, so the real file signature decides the type.
 * @returns {string|null} detected mime type or null when it is not an image.
 */
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => buffer[index] === byte)) {
    return 'image/png';
  }

  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

export function isAllowedImageType(mimeType) {
  return ALLOWED_SCREENSHOT_TYPES.includes(mimeType);
}

export const EXTENSION_FOR_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Random, safe file name. No user supplied text ever reaches the file name. */
export function buildScreenshotFileName(mimeType) {
  const extension = EXTENSION_FOR_TYPE[mimeType] || 'bin';
  return 'payment-' + Date.now().toString(36) + '-' + randomBytes(8).toString('hex') + '.' + extension;
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Small in-memory rate limiter. Enough for a single process tournament site.
 */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  function sweep(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    if (hits.size > 5000) sweep(now);

    const key = clientIp(req);
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        ok: false,
        message: message || 'Too many requests. Please try again in a few minutes.',
      });
      return;
    }

    return next();
  };
}
