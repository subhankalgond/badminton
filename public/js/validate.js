/**
 * Shared validation rules.
 *
 * This file is imported by the browser (public/js/register.js) and by the
 * server (src/routes/public.js) so the same rules, the same normalisation and
 * the same error messages are used in both places.
 */

export const ENTRY_FEE = 300;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_SCREENSHOT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export const SAME_COLLEGE_RULE =
  'IMPORTANT: Both players in a team must belong to the SAME COLLEGE. ' +
  'Players from different colleges cannot form a team. ' +
  'Only teams with both players from the same college will be accepted.';

export const COLLEGE_MISMATCH_MESSAGE =
  'Both players must be from the same college. ' +
  'Players from different colleges cannot register as a team.';

/* Characters that are never valid in a team name, a person name or a college
   name. Control characters are included so that newlines and tabs cannot be
   smuggled into stored values. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const BLOCKED_CHARS = /[<>{}|\\]/;
const HAS_LETTER = /\p{L}/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** Trim, collapse repeated whitespace and normalise unicode form. */
export function normalizeText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u00A0/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Case and whitespace insensitive comparison key. */
export function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

/**
 * College comparison. Capitalisation differences, leading/trailing spaces and
 * repeated internal spaces are ignored, so
 * "Anjuman Institute of Technology and Management" and
 * " anjuman  institute of technology and management " match.
 */
export function sameCollege(a, b) {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  return left.length > 0 && left === right;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) {
    return (value / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  }
  if (value >= 1024) {
    return Math.round(value / 1024) + ' KB';
  }
  return value + ' bytes';
}

function textError(value, label, min, max) {
  if (!value) return label + ' is required.';
  if (CONTROL_CHARS.test(value) || BLOCKED_CHARS.test(value)) {
    return label + ' contains characters that are not allowed.';
  }
  if (value.length < min) {
    return label + ' must be at least ' + min + ' characters.';
  }
  if (value.length > max) {
    return label + ' must be ' + max + ' characters or fewer.';
  }
  return null;
}

/**
 * Validate one team registration.
 * @returns {{ok: boolean, errors: Record<string, string>, values: Record<string,string>, collegesMatch: boolean}}
 */
export function validateRegistration(input) {
  const source = input || {};
  const read = (key) => normalizeText(source[key]);

  const values = {
    team_name: read('team_name'),
    player1_name: read('player1_name'),
    player1_email: read('player1_email').toLowerCase(),
    player1_college: read('player1_college'),
    player2_name: read('player2_name'),
    player2_email: read('player2_email').toLowerCase(),
    player2_college: read('player2_college'),
  };

  const errors = {};

  const teamNameError =
    textError(values.team_name, 'Team name', 2, 60) ||
    (HAS_LETTER.test(values.team_name) || /\p{N}/u.test(values.team_name)
      ? null
      : 'Enter a valid team name.');
  if (teamNameError) errors.team_name = teamNameError;

  const nameFields = [
    ['player1_name', 'Player 1 full name'],
    ['player2_name', 'Player 2 full name'],
  ];
  for (const [field, label] of nameFields) {
    const error =
      textError(values[field], label, 2, 80) ||
      (HAS_LETTER.test(values[field]) ? null : 'Enter a valid ' + label.toLowerCase() + '.');
    if (error) errors[field] = error;
  }

  const emailFields = [
    ['player1_email', 'Player 1'],
    ['player2_email', 'Player 2'],
  ];
  for (const [field, who] of emailFields) {
    const value = values[field];
    if (!value) {
      errors[field] = who + ' email is required.';
    } else if (value.length > 120) {
      errors[field] = who + ' email must be 120 characters or fewer.';
    } else if (!EMAIL_PATTERN.test(value)) {
      errors[field] = 'Enter a valid email address for ' + who + '.';
    }
  }

  const collegeFields = [
    ['player1_college', 'Player 1 college name'],
    ['player2_college', 'Player 2 college name'],
  ];
  for (const [field, label] of collegeFields) {
    const error = textError(values[field], label, 3, 120);
    if (error) errors[field] = error;
  }

  if (
    !errors.player1_email &&
    !errors.player2_email &&
    values.player1_email === values.player2_email
  ) {
    errors.player2_email = 'Player 1 and Player 2 cannot use the same email address.';
  }

  if (
    !errors.player1_name &&
    !errors.player2_name &&
    normalizeKey(values.player1_name) === normalizeKey(values.player2_name)
  ) {
    errors.player2_name = 'Player 1 and Player 2 must be different players.';
  }

  const collegesMatch = sameCollege(values.player1_college, values.player2_college);
  if (
    !errors.player1_college &&
    !errors.player2_college &&
    !collegesMatch
  ) {
    errors.player1_college = COLLEGE_MISMATCH_MESSAGE;
    errors.player2_college = COLLEGE_MISMATCH_MESSAGE;
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values,
    collegesMatch,
  };
}

/**
 * Validate a payment screenshot. Accepts a browser File object or a plain
 * {name, type, size} object from the server.
 * @returns {{ok: boolean, message: string}}
 */
export function validateScreenshot(file) {
  if (!file) {
    return { ok: false, message: 'Upload your payment screenshot.' };
  }

  const size = Number(file.size) || 0;
  const type = String(file.type || '').toLowerCase();

  if (size <= 0) {
    return {
      ok: false,
      message: 'The selected screenshot file is empty. Choose a different file.',
    };
  }

  if (size > MAX_SCREENSHOT_BYTES) {
    return {
      ok: false,
      message:
        'Screenshot must be 5 MB or smaller. Your file is ' +
        formatBytes(size) +
        '.',
    };
  }

  if (!ALLOWED_SCREENSHOT_TYPES.includes(type)) {
    return {
      ok: false,
      message: 'Screenshot must be a JPG, JPEG, PNG, or WEBP image.',
    };
  }

  return { ok: true, message: '' };
}
