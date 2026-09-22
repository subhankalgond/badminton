import { formatBytes } from './validate.js';

const loginView = document.getElementById('login-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginButton = document.getElementById('login-button');
const dashboard = document.getElementById('dashboard');
const adminAlert = document.getElementById('admin-alert');
const signOutButton = document.getElementById('sign-out');
const signedInAs = document.getElementById('signed-in-as');

const statNodes = {
  total: document.getElementById('stat-total'),
  pending: document.getElementById('stat-pending'),
  accepted: document.getElementById('stat-accepted'),
  rejected: document.getElementById('stat-rejected'),
};

const pendingList = document.getElementById('pending-list');
const pendingEmpty = document.getElementById('pending-empty');
const pendingCount = document.getElementById('pending-count');
const allList = document.getElementById('all-list');
const allEmpty = document.getElementById('all-empty');
const acceptedList = document.getElementById('accepted-list');
const acceptedEmpty = document.getElementById('accepted-empty');
const acceptedCount = document.getElementById('accepted-count');
const searchInput = document.getElementById('search-input');
const filterButtons = Array.from(document.querySelectorAll('.filter-btn'));
const adminNav = document.getElementById('admin-nav');
const navItems = Array.from(document.querySelectorAll('.admin-nav__item'));
const navCounts = {
  pending: document.getElementById('nav-count-pending'),
  all: document.getElementById('nav-count-all'),
  accepted: document.getElementById('nav-count-accepted'),
};
const viewPanels = {
  queue: document.getElementById('view-queue'),
  all: document.getElementById('view-all'),
  accepted: document.getElementById('view-accepted'),
};
let activeView = 'queue';

const rejectReasonSelect = document.getElementById('reject-reason');
const customReasonField = document.getElementById('custom-reason-field');
const customReasonInput = document.getElementById('reject-custom');
const rejectError = document.getElementById('reject-error');
const confirmRejectButton = document.getElementById('confirm-reject');

const screenshotModal = document.getElementById('screenshot-modal');
const screenshotImage = document.getElementById('screenshot-image');
const screenshotSubtitle = document.getElementById('screenshot-subtitle');
const screenshotNote = document.getElementById('screenshot-note');
const screenshotAccept = document.getElementById('screenshot-accept');
const screenshotReject = document.getElementById('screenshot-reject');

const acceptModal = document.getElementById('accept-modal');
const acceptSubtitle = document.getElementById('accept-subtitle');
const acceptNote = document.getElementById('accept-note');
const confirmAcceptButton = document.getElementById('confirm-accept');

const rejectModal = document.getElementById('reject-modal');
const rejectSubtitle = document.getElementById('reject-subtitle');

let statusFilter = 'ALL';
let searchQuery = '';
let searchTimer = null;
let rejectionReasons = [];
let activeRegistration = null;
let lastFocused = null;
let alertTimer = null;

/* ------------------------------------------------------------------ helpers */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
  return node;
}

function metaItem(label, value) {
  const item = el('div', 'meta-item');
  item.append(el('span', 'meta-item__label', label));
  const content = el('span', 'meta-item__value');
  if (value instanceof Node) content.append(value);
  else content.textContent = value;
  item.append(content);
  return item;
}

function buildMetaRow(items) {
  const row = el('div', 'meta-row');
  for (const [label, value] of items) row.append(metaItem(label, value));
  return row;
}

function formatDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusChip(status) {
  const chip = el('span', 'chip');
  if (status === 'ACCEPTED') chip.classList.add('chip--accepted');
  else if (status === 'REJECTED') chip.classList.add('chip--rejected');
  else chip.classList.add('chip--pending');
  chip.textContent = status;
  return chip;
}

function paymentChip(status) {
  const chip = el('span', 'chip');
  if (status === 'VERIFIED') chip.classList.add('chip--verified');
  else if (status === 'REJECTED') chip.classList.add('chip--rejected');
  else chip.classList.add('chip--pending');
  chip.textContent = status;
  return chip;
}

function showAdminAlert(message, kind) {
  adminAlert.textContent = message;
  adminAlert.className = 'notice ' + (kind === 'success' ? 'notice--success' : 'notice--error');
  adminAlert.hidden = !message;
  if (alertTimer) clearTimeout(alertTimer);
  if (message) {
    alertTimer = setTimeout(() => {
      adminAlert.hidden = true;
    }, 8000);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 401) {
    showLogin();
    throw new Error(data.message || 'Your session expired. Sign in again.');
  }

  if (!response.ok) {
    throw new Error(data.message || 'The request failed. Please try again.');
  }

  return data;
}

/* ------------------------------------------------------------------- modals */

function openModal(modal) {
  lastFocused = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  const focusable = modal.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable) focusable.focus();
}

function closeModal(modal) {
  modal.hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) {
    document.body.style.overflow = '';
  }
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
}

function closeAllModals() {
  for (const modal of document.querySelectorAll('.modal')) closeModal(modal);
}

for (const button of document.querySelectorAll('[data-close-modal]')) {
  button.addEventListener('click', () => {
    const modal = document.getElementById(button.dataset.closeModal);
    if (modal) closeModal(modal);
  });
}

for (const modal of document.querySelectorAll('.modal')) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const open = document.querySelector('.modal:not([hidden])');
    if (open) closeModal(open);
  }
});

/* ---------------------------------------------------------------- rendering */

/** One player as a small stack: label, name, then email and college. */
function buildPlayerBlock(title, name, email, college) {
  const block = el('div', 'person');
  block.append(el('p', 'person__title', title));
  block.append(el('p', 'person__name', name));
  block.append(el('p', 'person__line', email));
  block.append(el('p', 'person__line', college));
  return block;
}

function buildActions(registration) {
  const footer = el('div', 'registration__footer');

  const screenshotButton = el('button', 'btn btn--secondary btn--small', 'View Payment Screenshot');
  screenshotButton.type = 'button';
  screenshotButton.addEventListener('click', () => openScreenshot(registration));
  footer.append(screenshotButton);

  const acceptButton = el('button', 'btn btn--accept btn--small', 'Accept Registration');
  acceptButton.type = 'button';
  acceptButton.addEventListener('click', () => openAccept(registration));
  footer.append(acceptButton);

  const rejectButton = el('button', 'btn btn--danger btn--small', 'Reject Registration');
  rejectButton.type = 'button';
  rejectButton.addEventListener('click', () => openReject(registration));
  footer.append(rejectButton);

  return footer;
}

function buildRegistrationCard(registration) {
  const card = el('article', 'registration');
  card.dataset.status = registration.registration_status;

  const top = el('div', 'registration__top');
  const heading = el('div');
  heading.append(el('h3', 'registration__team', registration.team_name));
  heading.append(el('p', 'registration__meta', 'Submitted ' + formatDateTime(registration.created_at)));
  top.append(heading);
  top.append(statusChip(registration.registration_status));
  card.append(top);

  const body = el('div', 'registration__body registration__body--split');

  body.append(
    buildPlayerBlock(
      'Player 1',
      registration.player1_name,
      registration.player1_email,
      registration.player1_college
    )
  );
  body.append(
    buildPlayerBlock(
      'Player 2',
      registration.player2_name,
      registration.player2_email,
      registration.player2_college
    )
  );
  card.append(body);

  const metaRows = el('div', 'meta-rows');
  metaRows.append(
    buildMetaRow([
      ['Entry fee', '₹' + registration.payment_amount],
      ['Payment', paymentChip(registration.payment_status)],
      [
        'Screenshot',
        registration.payment_screenshot_size
          ? formatBytes(registration.payment_screenshot_size)
          : 'Uploaded',
      ],
      ['Submitted', formatDateTime(registration.created_at)],
    ])
  );

  if (registration.registration_status === 'ACCEPTED') {
    metaRows.append(
      buildMetaRow([
        ['Verified by', registration.verified_by || 'Not recorded'],
        ['Verified at', formatDateTime(registration.verified_at)],
      ])
    );
  }

  if (registration.registration_status === 'REJECTED') {
    metaRows.append(
      buildMetaRow([
        ['Rejected by', registration.rejected_by || 'Not recorded'],
        ['Rejected at', formatDateTime(registration.rejected_at)],
      ])
    );
  }

  card.append(metaRows);

  if (registration.registration_status === 'REJECTED' && registration.rejection_reason) {
    card.append(
      el('div', 'registration__reject-note', 'Rejection reason: ' + registration.rejection_reason)
    );
  }

  card.append(buildActions(registration));
  return card;
}

function buildAcceptedCard(registration) {
  const card = el('article', 'registration');
  card.dataset.status = registration.registration_status;

  const top = el('div', 'registration__top');
  const heading = el('div');
  heading.append(el('h3', 'registration__team', registration.team_name));
  heading.append(
    el('p', 'registration__meta', 'Accepted on ' + formatDateTime(registration.verified_at))
  );
  top.append(heading);
  top.append(statusChip(registration.registration_status));
  card.append(top);

  const body = el('div', 'registration__body registration__body--split');
  // Team name is already shown in the card header, so it is not repeated here.
  body.append(
    buildPlayerBlock(
      'Player 1',
      registration.player1_name,
      registration.player1_email,
      registration.player1_college
    )
  );
  body.append(
    buildPlayerBlock(
      'Player 2',
      registration.player2_name,
      registration.player2_email,
      registration.player2_college
    )
  );
  card.append(body);
  card.append(
    buildMetaRow([
      ['Entry fee', '₹' + registration.payment_amount],
      ['Payment', paymentChip(registration.payment_status)],
      ['Accepted on', formatDateTime(registration.verified_at)],
      ['Verified by', registration.verified_by || 'Not recorded'],
    ])
  );
  return card;
}

function renderList(container, emptyNode, registrations, builder) {
  container.textContent = '';
  for (const registration of registrations) {
    container.append((builder || buildRegistrationCard)(registration));
  }
  emptyNode.hidden = registrations.length > 0;
}

function renderStats(stats) {
  statNodes.total.textContent = String(stats.total);
  statNodes.pending.textContent = String(stats.pending);
  statNodes.accepted.textContent = String(stats.accepted);
  statNodes.rejected.textContent = String(stats.rejected);
  navCounts.pending.textContent = String(stats.pending);
  navCounts.all.textContent = String(stats.total);
  navCounts.accepted.textContent = String(stats.accepted);

  for (const button of filterButtons) {
    const countNode = button.querySelector('[data-count]');
    if (!countNode) continue;
    const key = button.dataset.status;
    const value =
      key === 'ALL'
        ? stats.total
        : key === 'PENDING'
          ? stats.pending
          : key === 'ACCEPTED'
            ? stats.accepted
            : stats.rejected;
    countNode.textContent = '(' + value + ')';
  }
}

function fillRejectionReasons(reasons) {
  if (!reasons || !reasons.length || rejectionReasons.length) return;
  rejectionReasons = reasons;
  for (const reason of reasons) {
    const option = el('option', null, reason.label);
    option.value = reason.code;
    rejectReasonSelect.append(option);
  }
}

/* -------------------------------------------------------------- data loads */

async function loadStats() {
  const data = await api('/api/admin/stats');
  renderStats(data.stats);
}

async function loadPending() {
  const data = await api('/api/admin/registrations?status=PENDING');
  fillRejectionReasons(data.rejection_reasons);
  renderList(pendingList, pendingEmpty, data.registrations);
  pendingCount.textContent = data.registrations.length + ' waiting';
}

async function loadAccepted() {
  const data = await api('/api/admin/registrations?status=ACCEPTED');
  renderList(acceptedList, acceptedEmpty, data.registrations, buildAcceptedCard);
  acceptedCount.textContent = data.registrations.length + ' accepted';
}

async function loadList() {
  const params = new URLSearchParams({ status: statusFilter });
  if (searchQuery) params.set('q', searchQuery);
  const data = await api('/api/admin/registrations?' + params.toString());
  fillRejectionReasons(data.rejection_reasons);
  allEmpty.textContent = searchQuery
    ? 'No registration matches this search.'
    : statusFilter === 'ALL'
      ? 'No registration has been submitted yet.'
      : 'No registration has this status.';
  renderList(allList, allEmpty, data.registrations);
}

async function refreshAll() {
  try {
    await Promise.all([loadStats(), loadPending(), loadAccepted(), loadList()]);
  } catch (error) {
    showAdminAlert(error.message);
  }
}

/* ------------------------------------------------------------ screenshots */

function openScreenshot(registration) {
  activeRegistration = registration;
  const screenshotUrl = '/api/admin/registrations/' + registration.id + '/screenshot';
  screenshotImage.src = screenshotUrl;
  screenshotImage.alt = 'Payment screenshot for ' + registration.team_name;
  screenshotSubtitle.textContent =
    registration.team_name + ' · ₹' + registration.payment_amount + ' · ' + registration.player1_name + ' and ' + registration.player2_name;
  screenshotNote.textContent =
    'Screenshot uploaded on ' +
    formatDateTime(registration.created_at) +
    '. Payment status: ' +
    registration.payment_status +
    '.';
  screenshotImage.onerror = () => {
    screenshotNote.textContent = 'The payment screenshot could not be loaded from the server.';
  };
  openModal(screenshotModal);
}

screenshotAccept.addEventListener('click', () => {
  if (!activeRegistration) return;
  closeModal(screenshotModal);
  openAccept(activeRegistration);
});

screenshotReject.addEventListener('click', () => {
  if (!activeRegistration) return;
  closeModal(screenshotModal);
  openReject(activeRegistration);
});

/* ----------------------------------------------------------------- accept */

function openAccept(registration) {
  activeRegistration = registration;
  acceptSubtitle.textContent = registration.team_name;
  acceptNote.textContent =
    'Team: ' + registration.team_name + '. Entry fee: ₹' + registration.payment_amount + '.';
  openModal(acceptModal);
}

confirmAcceptButton.addEventListener('click', async () => {
  if (!activeRegistration) return;
  confirmAcceptButton.disabled = true;
  try {
    await api('/api/admin/registrations/' + activeRegistration.id + '/accept', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    closeAllModals();
    showAdminAlert(
      activeRegistration.team_name +
        ' accepted. Registration status is now ACCEPTED and the payment is marked VERIFIED.',
      'success'
    );
    await refreshAll();
  } catch (error) {
    showAdminAlert(error.message);
  } finally {
    confirmAcceptButton.disabled = false;
  }
});

/* ----------------------------------------------------------------- reject */

function openReject(registration) {
  activeRegistration = registration;
  rejectSubtitle.textContent = registration.team_name;
  rejectReasonSelect.value = '';
  customReasonInput.value = '';
  customReasonField.hidden = true;
  rejectError.textContent = '';
  openModal(rejectModal);
}

rejectReasonSelect.addEventListener('change', () => {
  const isOther = rejectReasonSelect.value === 'other';
  customReasonField.hidden = !isOther;
  rejectError.textContent = '';
  if (isOther) customReasonInput.focus();
});

confirmRejectButton.addEventListener('click', async () => {
  if (!activeRegistration) return;
  const reason = rejectReasonSelect.value;
  const customReason = customReasonInput.value.trim();

  if (!reason) {
    rejectError.textContent = 'Choose a rejection reason.';
    rejectReasonSelect.focus();
    return;
  }
  if (reason === 'other' && customReason.length < 3) {
    rejectError.textContent = 'Enter a custom rejection reason of at least 3 characters.';
    customReasonInput.focus();
    return;
  }

  confirmRejectButton.disabled = true;
  try {
    await api('/api/admin/registrations/' + activeRegistration.id + '/reject', {
      method: 'POST',
      body: JSON.stringify({ reason, custom_reason: customReason }),
    });
    closeAllModals();
    showAdminAlert(activeRegistration.team_name + ' rejected. The reason is saved on the registration.', 'success');
    await refreshAll();
  } catch (error) {
    rejectError.textContent = error.message;
  } finally {
    confirmRejectButton.disabled = false;
  }
});

/* ----------------------------------------------------------- view switch */

function showView(name) {
  activeView = viewPanels[name] ? name : 'queue';
  for (const [key, panel] of Object.entries(viewPanels)) {
    panel.hidden = key !== activeView;
  }
  for (const item of navItems) {
    item.setAttribute('aria-current', String(item.dataset.view === activeView));
  }
}

if (adminNav) {
  for (const item of navItems) {
    item.addEventListener('click', () => showView(item.dataset.view));
  }
}

/* ------------------------------------------------------ search and filters */

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadList().catch((error) => showAdminAlert(error.message));
  }, 250);
});

for (const button of filterButtons) {
  button.addEventListener('click', () => {
    statusFilter = button.dataset.status || 'ALL';
    for (const other of filterButtons) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    loadList().catch((error) => showAdminAlert(error.message));
  });
}

/* ------------------------------------------------------------ auth + boot */

function showLogin() {
  dashboard.hidden = true;
  loginView.hidden = false;
  signOutButton.hidden = true;
  signedInAs.textContent = '';
  document.title = 'Organizer sign in';
}

function showDashboard(username) {
  loginView.hidden = true;
  dashboard.hidden = false;
  signOutButton.hidden = false;
  signedInAs.textContent = username ? 'Signed in as ' + username : '';
  document.title = 'Organizer dashboard';
  showView(activeView);
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      loginError.textContent = data.message || 'Sign in failed.';
      loginError.hidden = false;
      return;
    }

    document.getElementById('password').value = '';
    showDashboard(data.username);
    await refreshAll();
  } catch {
    loginError.textContent = 'The server could not be reached. Try again.';
    loginError.hidden = false;
  } finally {
    loginButton.disabled = false;
  }
});

const refreshButton = document.getElementById('refresh-button');
const refreshLabel = document.getElementById('refresh-label');

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshLabel.textContent = 'Refreshing';
  try {
    await refreshAll();
    showAdminAlert('Dashboard refreshed.', 'success');
  } catch (error) {
    showAdminAlert(error.message);
  } finally {
    refreshButton.disabled = false;
    refreshLabel.textContent = 'Refresh';
  }
});

signOutButton.addEventListener('click', async () => {
  try {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* signing out locally is enough */
  }
  showLogin();
});

async function boot() {
  loginView.hidden = false;
  try {
    const data = await api('/api/admin/session');
    if (data.authenticated) {
      showDashboard(data.username);
      await refreshAll();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

boot();
