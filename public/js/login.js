/* Anmeldeseite: Zugangsdaten pruefen und ins Dashboard weiterleiten. */

import { api } from './api.js';
import { $ } from './util.js';

const form = $('#loginForm');
const username = $('#username');
const password = $('#password');
const button = $('#loginBtn');
const errorBox = $('#loginError');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

/** Bereits angemeldet? Dann direkt auf das Dashboard. */
api
  .me()
  .then(({ user }) => {
    if (user) window.location.replace('/');
  })
  .catch(() => {
    /* nicht angemeldet - Formular bleibt sichtbar */
  });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const name = username.value.trim();
  const secret = password.value;
  if (!name || !secret) {
    showError('Benutzername und Passwort sind erforderlich.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Anmelden ...';
  try {
    await api.login(name, secret);
    // Ein erzwungener Passwortwechsel wird im Dashboard abgefragt.
    window.location.replace('/');
  } catch (err) {
    showError(err.message);
    password.value = '';
    password.focus();
  } finally {
    button.disabled = false;
    button.textContent = 'Anmelden';
  }
});
