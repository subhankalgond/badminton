import {
  COLLEGE_MISMATCH_MESSAGE,
  formatBytes,
  sameCollege,
  validateRegistration,
  validateScreenshot,
} from './validate.js';

const form = document.getElementById('registration-form');
const formAlert = document.getElementById('form-alert');
const submitButton = document.getElementById('submit-button');
const statusPanel = document.getElementById('status-panel');
const submittedTeam = document.getElementById('submitted-team');
const collegeStatus = document.getElementById('college-status');
const collegeStatusText = document.getElementById('college-status-text');
const fileInput = document.getElementById('payment_screenshot');
const dropzone = document.getElementById('dropzone');
const chooseFileButton = document.getElementById('choose-file');
const preview = document.getElementById('preview');
const previewImage = document.getElementById('preview-image');
const previewName = document.getElementById('preview-name');
const previewSize = document.getElementById('preview-size');
const previewRemove = document.getElementById('preview-remove');
const qrFrame = document.getElementById('qr-frame');
const qrImage = document.getElementById('qr-image');
const qrMissing = document.getElementById('qr-missing');

const FIELD_NAMES = [
  'team_name',
  'player1_name',
  'player1_email',
  'player1_college',
  'player2_name',
  'player2_email',
  'player2_college',
];

let previewUrl = '';

/* ------------------------------------------------------------------ config */

fetch('/api/config')
  .then((response) => response.json())
  .then((config) => {
    if (config && config.qr_available && config.qr_url) {
      qrImage.src = config.qr_url;
      qrFrame.hidden = false;
      qrMissing.hidden = true;
    }
  })
  .catch(() => {
    /* the QR placeholder stays visible, the form still works */
  });

/* ------------------------------------------------------------ field errors */

function setFieldError(name, message) {
  const errorNode = document.querySelector('[data-error-for="' + name + '"]');
  const input = document.getElementById(name);
  if (errorNode) errorNode.textContent = message || '';
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function clearFieldErrors() {
  for (const name of FIELD_NAMES.concat('payment_screenshot')) {
    setFieldError(name, '');
  }
}

function showFormAlert(message) {
  formAlert.textContent = message;
  formAlert.hidden = !message;
}

function focusFirstProblem(fieldErrors, screenshotError) {
  for (const name of FIELD_NAMES) {
    if (fieldErrors[name]) {
      const input = document.getElementById(name);
      if (input) input.focus();
      return;
    }
  }
  if (screenshotError) chooseFileButton.focus();
}

/* ------------------------------------------------------- college comparison */

function updateCollegeStatus() {
  const first = document.getElementById('player1_college').value;
  const second = document.getElementById('player2_college').value;
  const firstReady = first.trim().length >= 3;
  const secondReady = second.trim().length >= 3;

  if (!firstReady || !secondReady) {
    collegeStatus.dataset.state = 'idle';
    collegeStatusText.textContent =
      'College check: enter the same college name for Player 1 and Player 2.';
    return;
  }

  if (sameCollege(first, second)) {
    collegeStatus.dataset.state = 'ok';
    collegeStatusText.textContent = 'College check: both players are from the same college.';
  } else {
    collegeStatus.dataset.state = 'error';
    collegeStatusText.textContent = COLLEGE_MISMATCH_MESSAGE;
  }
}

for (const id of ['player1_college', 'player2_college']) {
  const input = document.getElementById(id);
  input.addEventListener('input', () => {
    updateCollegeStatus();
    setFieldError('player1_college', '');
    setFieldError('player2_college', '');
  });
}

/* ---------------------------------------------------------- screenshot file */

function clearPreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = '';
  }
  previewImage.removeAttribute('src');
  preview.hidden = true;
  previewName.textContent = '';
  previewSize.textContent = '';
}

function showPreview(file) {
  clearPreview();
  previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  previewName.textContent = file.name;
  previewSize.textContent = formatBytes(file.size) + ' · ' + (file.type || 'unknown type');
  preview.hidden = false;
}

function acceptFile(file) {
  if (!file) {
    clearPreview();
    setFieldError('payment_screenshot', '');
    return;
  }

  const check = validateScreenshot(file);
  if (!check.ok) {
    setFieldError('payment_screenshot', check.message);
    clearPreview();
    fileInput.value = '';
    return;
  }

  setFieldError('payment_screenshot', '');
  showPreview(file);
}

fileInput.addEventListener('change', () => {
  acceptFile(fileInput.files && fileInput.files[0] ? fileInput.files[0] : null);
});

/* The file input is visually hidden inside the drop zone, so the button and
   the zone itself both open the file picker. */
chooseFileButton.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('click', (event) => {
  if (event.target.closest('button') || event.target === fileInput) return;
  fileInput.click();
});

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.dataset.dragging = 'true';
  });
}

for (const type of ['dragleave', 'dragend']) {
  dropzone.addEventListener(type, () => {
    dropzone.dataset.dragging = 'false';
  });
}

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.dataset.dragging = 'false';
  const files = event.dataTransfer ? event.dataTransfer.files : null;
  if (!files || !files.length) return;
  fileInput.files = files;
  acceptFile(files[0]);
});

previewRemove.addEventListener('click', () => {
  fileInput.value = '';
  clearPreview();
  setFieldError('payment_screenshot', '');
  chooseFileButton.focus();
});

for (const name of FIELD_NAMES) {
  const input = document.getElementById(name);
  input.addEventListener('input', () => {
    setFieldError(name, '');
    if (formAlert.hidden === false) showFormAlert('');
  });
}

/* ------------------------------------------------------------------ submit */

function collectValues() {
  const values = {};
  for (const name of FIELD_NAMES) {
    values[name] = document.getElementById(name).value;
  }
  return values;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors();
  showFormAlert('');

  const validation = validateRegistration(collectValues());
  const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  const fileCheck = validateScreenshot(file);

  if (!validation.ok || !fileCheck.ok) {
    for (const [field, message] of Object.entries(validation.errors)) {
      setFieldError(field, message);
    }
    if (!fileCheck.ok) setFieldError('payment_screenshot', fileCheck.message);
    showFormAlert(
      fileCheck.ok
        ? 'Please correct the highlighted fields and try again.'
        : fileCheck.message
    );
    focusFirstProblem(validation.errors, !fileCheck.ok);
    return;
  }

  const payload = new FormData();
  for (const [key, value] of Object.entries(validation.values)) {
    payload.append(key, value);
  }
  payload.append('payment_screenshot', file);

  submitButton.disabled = true;
  const originalLabel = submitButton.textContent;
  submitButton.textContent = 'Submitting...';

  try {
    const response = await fetch('/api/registrations', {
      method: 'POST',
      body: payload,
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const fieldErrors = data.field_errors || {};
      for (const [field, message] of Object.entries(fieldErrors)) {
        setFieldError(field, message);
      }
      if (data.screenshot_error) setFieldError('payment_screenshot', data.screenshot_error);
      showFormAlert(data.message || 'The registration could not be submitted. Please try again.');
      focusFirstProblem(fieldErrors, Boolean(data.screenshot_error));
      return;
    }

    form.hidden = true;
    if (validation.values.team_name) {
      submittedTeam.textContent =
        'Team ' + validation.values.team_name + ' is waiting for payment verification.';
    }
    statusPanel.hidden = false;
    statusPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    statusPanel.focus({ preventScroll: true });
  } catch {
    showFormAlert(
      'The server could not be reached. Check your internet connection and submit again.'
    );
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
});

updateCollegeStatus();
