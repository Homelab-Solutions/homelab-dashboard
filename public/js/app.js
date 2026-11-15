/* ===========================================================================
   Einstiegspunkt der Single-Page-Anwendung.
   Aufgaben: Daten laden, senkrechte Toolbar, Hash-Router, erzwungener
   Passwortwechsel.
   =========================================================================== */

import { api } from './api.js';
import { esc, icon, toast } from './util.js';
import { loadBookmarks, loadSession, loadSettings, state } from './state.js';

import * as home from './views/home.js';
import * as apps from './views/apps.js';
import * as settings from './views/settings.js';
import * as users from './views/users.js';

const VIEWS = { home, apps, settings, users };

/** Reihenfolge der Schaltflaechen in der Toolbar. */
const NAV = [
  { view: 'home', ico: 'home', label: 'Hauptseite' },
  { view: 'apps', ico: 'apps', label: 'Anwendungen' },
  { view: 'users', ico: 'users', label: 'Benutzer' },
  { view: 'settings', ico: 'settings', label: 'Einstellungen' },
];

function currentView() {
  const raw = String(window.location.hash || '')
    .replace(/^#\/?/, '')
    .split('?')[0]
    .toLowerCase();
  return VIEWS[raw] ? raw : 'home';
}

/* ------------------------------- Toolbar -------------------------------- */

function renderToolbar() {
  const host = document.getElementById('toolbar');
  if (!host) return;
  const title = state.settings.dashboardTitle || 'Homelab';

  host.innerHTML = `
    <div class="toolbar-brand" title="${esc(title)}">${icon('grid')}</div>
    ${NAV.map(
      (item) => `
      <button class="tb-btn ${state.view === item.view ? 'active' : ''}"
              data-view="${item.view}" data-tip="${esc(item.label)}"
              aria-label="${esc(item.label)}"
              aria-current="${state.view === item.view ? 'page' : 'false'}">
        ${icon(item.ico)}
      </button>`
    ).join('')}
    <button class="tb-btn ${state.arrangeMode ? 'active' : ''}" id="tbArrange"
            data-tip="Anordnung der Kacheln" aria-label="Anordnung der Kacheln"
            aria-pressed="${state.arrangeMode ? 'true' : 'false'}">
      ${icon('arrange')}
    </button>
    <div class="toolbar-sep"></div>
    <button class="tb-btn" id="tbLogout"
            data-tip="Abmelden (${esc(state.user.displayName)})" aria-label="Abmelden">
      ${icon('logout')}
    </button>`;

  host.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      go(button.dataset.view);
    });
  });

  // Anordnungs-Tab: oeffnet das Panel fuer Raster / freie Platzierung
  host.querySelector('#tbArrange').addEventListener('click', () => {
    state.arrangeMode = !state.arrangeMode;
    if (currentView() !== 'home') go('home');
    else render();
  });

  host.querySelector('#tbLogout').addEventListener('click', async () => {
    try {
      await api.logout();
    } catch {
      /* Abmeldung lokal auf jeden Fall abschliessen */
    }
    window.location.href = '/login';
  });
}

function go(view) {
  if (currentView() === view) render();
  else window.location.hash = `#/${view}`;
}

/* -------------------------------- Router -------------------------------- */

let mounted = null;
let rendering = false;

async function render() {
  const view = currentView();
  const container = document.getElementById('view');
  if (!container || !state.user || rendering) return;

  rendering = true;
  try {
    // Beim Verlassen der Anwendungsliste einen offenen Editor verwerfen
    if (mounted === 'apps' && view !== 'apps') {
      apps.reset();
      state.editingId = null;
    }

    const changed = mounted !== view;
    state.view = view;
    document.title = `${state.settings.dashboardTitle || 'Homelab'} - Dashboard`;
    renderToolbar();

    if (view === 'users' && users.needsLoad()) {
      try {
        await users.load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    mounted = view;
    VIEWS[view].render(container);
    if (changed) window.scrollTo({ top: 0 });
  } finally {
    rendering = false;
  }
}

/* -------------------- Erzwungener Passwortwechsel ----------------------- */

function passwordDialog() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Neues Passwort setzen</h2>
        <p class="hint">
          Fuer dieses Konto ist noch das vergebene Start-Passwort aktiv.
          Bitte ein eigenes Passwort setzen, um das Dashboard zu nutzen.
        </p>
        <div class="notice notice-error hidden" id="pcError"></div>
        <div class="field">
          <label for="pcCurrent">Aktuelles Passwort</label>
          <input type="password" id="pcCurrent" autocomplete="current-password">
        </div>
        <div class="field">
          <label for="pcNew">Neues Passwort (mindestens 6 Zeichen)</label>
          <input type="password" id="pcNew" autocomplete="new-password">
        </div>
        <div class="field">
          <label for="pcRepeat">Neues Passwort wiederholen</label>
          <input type="password" id="pcRepeat" autocomplete="new-password">
        </div>
        <div class="modal-actions">
          <button class="btn" data-act="logout">Abmelden</button>
          <button class="btn btn-primary" data-act="ok">${icon('key')} Speichern</button>
        </div>
      </div>`;

    const errorBox = backdrop.querySelector('#pcError');
    const showError = (message) => {
      errorBox.textContent = message;
      errorBox.classList.remove('hidden');
    };

    const submit = async () => {
      const current = backdrop.querySelector('#pcCurrent').value;
      const next = backdrop.querySelector('#pcNew').value;
      const repeat = backdrop.querySelector('#pcRepeat').value;

      if (!current) return showError('Bitte das aktuelle Passwort eingeben.');
      if (next.length < 6) return showError('Das neue Passwort muss mindestens 6 Zeichen haben.');
      if (next !== repeat) return showError('Die beiden neuen Passwoerter stimmen nicht ueberein.');
      if (next === current) return showError('Das neue Passwort muss sich unterscheiden.');

      const okButton = backdrop.querySelector('[data-act="ok"]');
      okButton.disabled = true;
      try {
        const { user } = await api.changePassword(current, next);
        state.user = user;
        backdrop.remove();
        toast('Passwort gespeichert.', 'success');
        resolve(true);
      } catch (err) {
        showError(err.message);
        okButton.disabled = false;
      }
    };

    backdrop.addEventListener('click', (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      if (button.dataset.act === 'logout') {
        api.logout().finally(() => {
          window.location.href = '/login';
        });
        return;
      }
      submit();
    });

    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    document.body.appendChild(backdrop);
    backdrop.querySelector('#pcCurrent').focus();
  });
}

let passwordPromise = null;

/** Sorgt dafuer, dass der Dialog nur einmal gleichzeitig offen ist. */
function requirePasswordChange() {
  if (!passwordPromise) {
    passwordPromise = passwordDialog().then(async () => {
      passwordPromise = null;
      await loadData();
      users.invalidate();
      await render();
    });
  }
  return passwordPromise;
}

/* --------------------------------- Start -------------------------------- */

async function loadData() {
  await loadSettings();
  await loadBookmarks();
}

async function boot() {
  try {
    const user = await loadSession();
    if (!user) {
      window.location.replace('/login');
      return;
    }
  } catch (err) {
    document.getElementById('view').innerHTML =
      `<div class="notice notice-error">${esc(err.message)}</div>`;
    return;
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('hd:render', render);
  window.addEventListener('hd:password-required', requirePasswordChange);

  if (state.user.mustChangePassword) {
    await requirePasswordChange();
    return;
  }

  try {
    await loadData();
  } catch (err) {
    toast(err.message, 'error');
  }
  await render();
}

boot();
