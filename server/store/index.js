'use strict';

const config = require('./../config');
const auth = require('./../auth');

/**
 * Waehlt den Storage anhand von STORAGE (auto | mysql | file).
 * "auto" bevorzugt MariaDB und fallt bei Verbindungsproblemen auf den
 * Datei-Storage zurueck, damit das Dashboard immer erreichbar bleibt.
 */
async function initStore() {
  if (config.storageMode !== 'file') {
    try {
      const { createStore } = require('./mysql');
      const store = await createStore();
      console.log(`[store] Verbunden: ${store.describe}`);
      await ensureBootstrapAdmin(store);
      return store;
    } catch (err) {
      // Eine fehlgeschlagene Migration bricht den Start immer ab (kein
      // halber Zustand) - auch im Modus "auto", statt auf Datei-Storage
      // auszuweichen und den Fehler zu verdecken.
      if (config.storageMode === 'mysql' || err.migrationFailure) {
        console.error('[store] MariaDB-Start fehlgeschlagen:', err.message);
        throw err;
      }
      console.warn(
        `[store] MariaDB (${config.db.host}:${config.db.port}) nicht verfuegbar: ${err.message}`
      );
      console.warn('[store] Fallback auf Datei-Storage unter ./data (STORAGE=auto).');
    }
  }

  const { createStore } = require('./file');
  const store = createStore();
  console.log(`[store] Aktiv: ${store.describe}`);
  await ensureBootstrapAdmin(store);
  return store;
}

/** Legt beim Erststart einen Administrator an. */
async function ensureBootstrapAdmin(store) {
  const count = await store.countUsers();
  if (count > 0) return;

  const { username, password } = config.bootstrapAdmin;
  await store.createUser({
    username: username.toLowerCase(),
    display_name: 'Administrator',
    password_hash: auth.hashPassword(password),
    role: 'admin',
    must_change_password: 1,
  });
  console.log(
    `[store] Erst-Administrator "${username}" angelegt - Passwort bitte nach der ersten Anmeldung aendern.`
  );
}

module.exports = { initStore };
