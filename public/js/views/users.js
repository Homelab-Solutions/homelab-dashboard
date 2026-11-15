/* Benutzerverwaltung (Admin-Panel) und eigenes Konto. */

import { api } from '../api.js';
import { confirmDialog, esc, formatDate, icon, toast } from '../util.js';
import { loadSession, rerender, state } from '../state.js';

let users = [];
let loaded = false;

export async function load() {
  if (state.user.role !== 'admin') {
    users = [];
    loaded = true;
    return;
  }
  const result = await api.listUsers();
  users = result.users;
  loaded = true;
}

/** Kleiner Dialog zum Setzen eines Passworts. */
function passwordDialog(username) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Passwort setzen</h2>
        <p>Neues Passwort fuer <b>${esc(username)}</b> (mindestens 6 Zeichen).</p>
        <div class="field">
          <label for="pwNew">Neues Passwort</label>
          <input type="password" id="pwNew" autocomplete="new-password">
        </div>
        <label class="switch">
          <input type="checkbox" id="pwForce" checked>
          <span>Aenderung bei der naechsten Anmeldung erzwingen</span>
        </label>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Abbrechen</button>
          <button class="btn btn-primary" data-act="ok">Speichern</button>
        </div>
      </div>`;
    const finish = (value) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.addEventListener('click', (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) {
        if (event.target === backdrop) finish(null);
        return;
      }
      if (button.dataset.act === 'cancel') return finish(null);
      const password = backdrop.querySelector('#pwNew').value;
      const force = backdrop.querySelector('#pwForce').checked;
      if (!password || password.length < 6) {
        toast('Das Passwort muss mindestens 6 Zeichen lang sein.', 'error');
        return;
      }
      finish({ password, mustChangePassword: force });
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('#pwNew').focus();
  });
}

export function render(container) {
  const isAdmin = state.user.role === 'admin';

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Benutzer</h1>
        <small class="hint">${
          isAdmin
            ? 'Konten fuer das Heimnetz anlegen und verwalten. Jeder Benutzer hat eigene Lesezeichen und Einstellungen.'
            : 'Eigenes Konto verwalten.'
        }</small>
      </div>
    </div>

    <div class="card">
      <h2>Mein Konto</h2>
      <div class="grid-2">
        <div>
          <div class="field">
            <label for="myName">Anzeigename</label>
            <div class="row">
              <input type="text" id="myName" value="${esc(state.user.displayName)}" maxlength="64">
              <button class="btn" id="saveName">${icon('save')} Speichern</button>
            </div>
          </div>
          <small class="hint">
            Benutzername: <b>${esc(state.user.username)}</b> &middot; Rolle:
            <span class="badge ${state.user.role === 'admin' ? 'badge-admin' : ''}">${esc(
              state.user.role
            )}</span>
          </small>
        </div>
        <div>
          <div class="field">
            <label for="pwCurrent">Aktuelles Passwort</label>
            <input type="password" id="pwCurrent" autocomplete="current-password">
          </div>
          <div class="field">
            <label for="pwNext">Neues Passwort</label>
            <input type="password" id="pwNext" autocomplete="new-password">
          </div>
          <div class="row">
            <button class="btn btn-primary" id="changePw">${icon('key')} Passwort aendern</button>
            <button class="btn" id="logoutAll">${icon('shield')} Ueberall abmelden</button>
          </div>
          <small class="hint">
            "Ueberall abmelden" beendet alle anderen Sitzungen dieses Kontos; diese Sitzung
            bleibt angemeldet.
          </small>
        </div>
      </div>
    </div>

    ${
      isAdmin
        ? `
    <div class="card">
      <h2>Neuen Benutzer anlegen</h2>
      <div class="field-row">
        <div>
          <label for="nuUser">Benutzername *</label>
          <input type="text" id="nuUser" placeholder="z.B. familie" maxlength="32">
        </div>
        <div>
          <label for="nuName">Anzeigename</label>
          <input type="text" id="nuName" placeholder="z.B. Familie" maxlength="64">
        </div>
        <div>
          <label for="nuPass">Passwort *</label>
          <input type="password" id="nuPass" autocomplete="new-password">
        </div>
        <div>
          <label for="nuRole">Rolle</label>
          <select id="nuRole">
            <option value="user">Benutzer</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-top:6px">
        <label class="switch">
          <input type="checkbox" id="nuForce" checked>
          <span>Passwortwechsel bei erster Anmeldung</span>
        </label>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="createUser">${icon('plus')} Benutzer anlegen</button>
      </div>
    </div>

    <div class="card">
      <h2>Benutzerkonten (${users.length})</h2>
      <div style="overflow-x:auto">
        <table class="data">
          <thead>
            <tr>
              <th>Benutzer</th>
              <th>Anzeigename</th>
              <th>Rolle</th>
              <th>Lesezeichen</th>
              <th>Letzte Anmeldung</th>
              <th style="text-align:right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (user) => `
              <tr data-id="${user.id}">
                <td>
                  <b>${esc(user.username)}</b>
                  ${
                    user.mustChangePassword
                      ? '<span class="badge badge-warn">Passwortwechsel</span>'
                      : ''
                  }
                </td>
                <td>${esc(user.displayName)}</td>
                <td><span class="badge ${
                  user.role === 'admin' ? 'badge-admin' : ''
                }">${esc(user.role)}</span></td>
                <td>${user.bookmarkCount}</td>
                <td>${esc(formatDate(user.lastLogin))}</td>
                <td>
                  <div class="list-actions">
                    <button class="btn btn-sm" data-act="role">${
                      user.role === 'admin' ? 'Zu Benutzer' : 'Zu Admin'
                    }</button>
                    <button class="btn btn-sm btn-icon" data-act="password" title="Passwort setzen">${icon(
                      'key'
                    )}</button>
                    <button class="btn btn-sm btn-icon btn-danger" data-act="delete"
                            title="Benutzer loeschen" ${
                              user.id === state.user.id ? 'disabled' : ''
                            }>${icon('trash')}</button>
                  </div>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <small class="hint">
        Beim Loeschen eines Benutzers werden auch dessen Lesezeichen und Einstellungen entfernt.
      </small>
    </div>`
        : ''
    }`;

  wire(container);
}

function wire(container) {
  const bind = (selector, event, handler) => {
    const node = container.querySelector(selector);
    if (node) node.addEventListener(event, handler);
  };

  bind('#saveName', 'click', async () => {
    try {
      const value = container.querySelector('#myName').value.trim();
      await api.updateProfile(value);
      await loadSession();
      toast('Anzeigename gespeichert.', 'success');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  bind('#changePw', 'click', async () => {
    const current = container.querySelector('#pwCurrent').value;
    const next = container.querySelector('#pwNext').value;
    if (!current || !next) {
      toast('Bitte beide Passwortfelder ausfuellen.', 'error');
      return;
    }
    try {
      await api.changePassword(current, next);
      await loadSession();
      toast('Passwort geaendert.', 'success');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  bind('#logoutAll', 'click', async () => {
    const ok = await confirmDialog({
      title: 'Ueberall abmelden',
      message:
        'Alle anderen Sitzungen dieses Kontos werden beendet. Diese Sitzung bleibt angemeldet. Fortfahren?',
      confirmText: 'Abmelden',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.logoutAll();
      toast('Alle anderen Sitzungen wurden beendet.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  bind('#createUser', 'click', async () => {
    const payload = {
      username: container.querySelector('#nuUser').value.trim(),
      displayName: container.querySelector('#nuName').value.trim(),
      password: container.querySelector('#nuPass').value,
      role: container.querySelector('#nuRole').value,
      mustChangePassword: container.querySelector('#nuForce').checked,
    };
    if (!payload.username || !payload.password) {
      toast('Benutzername und Passwort sind erforderlich.', 'error');
      return;
    }
    try {
      await api.createUser(payload);
      await load();
      toast(`Benutzer "${payload.username}" angelegt.`, 'success');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  container.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const id = Number(row.dataset.id);
      const user = users.find((u) => u.id === id);
      if (!user) return;

      try {
        if (button.dataset.act === 'role') {
          const nextRole = user.role === 'admin' ? 'user' : 'admin';
          const ok = await confirmDialog({
            title: 'Rolle aendern',
            message: `Rolle von "${user.username}" auf "${nextRole}" setzen?`,
            confirmText: 'Aendern',
          });
          if (!ok) return;
          await api.updateUser(id, { role: nextRole });
          await load();
          if (id === state.user.id) await loadSession();
          toast('Rolle geaendert.', 'success');
          rerender();
        }

        if (button.dataset.act === 'password') {
          const result = await passwordDialog(user.username);
          if (!result) return;
          await api.updateUser(id, result);
          await load();
          toast('Passwort gesetzt.', 'success');
          rerender();
        }

        if (button.dataset.act === 'delete') {
          const ok = await confirmDialog({
            title: 'Benutzer loeschen',
            message: `"${user.username}" samt Lesezeichen und Einstellungen loeschen?`,
            confirmText: 'Loeschen',
            danger: true,
          });
          if (!ok) return;
          await api.deleteUser(id);
          await load();
          toast('Benutzer geloescht.', 'success');
          rerender();
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

export function needsLoad() {
  return !loaded;
}

export function invalidate() {
  loaded = false;
}
