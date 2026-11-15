'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./../config');
const { DEFAULT_SETTINGS } = require('./../defaults');
const { runFileMigrations } = require('./migrations');

/**
 * Datei-Storage als Ausfallsicherung, falls MariaDB nicht erreichbar ist.
 * Gleiche Schnittstelle wie der MariaDB-Store.
 */
function createStore() {
  const file = path.join(config.dataDir, 'dashboard.json');
  let db = {
    seq: { users: 0, bookmarks: 0 },
    users: [],
    bookmarks: [],
    settings: {},
    schemaVersion: 0,
  };

  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    db = {
      seq: parsed.seq || { users: 0, bookmarks: 0 },
      users: parsed.users || [],
      bookmarks: parsed.bookmarks || [],
      settings: parsed.settings || {},
      schemaVersion: parsed.schemaVersion || 0,
    };
  } catch {
    /* Erststart: leere Datenbank */
  }

  const schemaVersionBefore = db.schemaVersion;
  runFileMigrations(db);

  let writeQueue = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify(db, null, 2);
    writeQueue = writeQueue.then(async () => {
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, 'utf8');
      await fs.promises.rename(tmp, file);
    });
    return writeQueue;
  }

  if (db.schemaVersion !== schemaVersionBefore) persist();

  const nextId = (kind) => {
    db.seq[kind] = (db.seq[kind] || 0) + 1;
    return db.seq[kind];
  };

  const clone = (obj) => (obj ? JSON.parse(JSON.stringify(obj)) : obj);

  return {
    mode: 'file',
    describe: `Datei-Storage ${file}`,

    async close() {
      await writeQueue;
    },

    /* ---------------------------- Benutzer ---------------------------- */

    async countUsers() {
      return db.users.length;
    },

    async listUsers() {
      return db.users
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((u) => ({
          id: u.id,
          username: u.username,
          display_name: u.display_name,
          role: u.role,
          must_change_password: u.must_change_password,
          created_at: u.created_at,
          last_login: u.last_login || null,
          bookmark_count: db.bookmarks.filter((b) => b.user_id === u.id).length,
        }));
    },

    async getUserById(id) {
      return clone(db.users.find((u) => u.id === Number(id))) || null;
    },

    async getUserByUsername(username) {
      return clone(db.users.find((u) => u.username === username)) || null;
    },

    async createUser(user) {
      const record = {
        id: nextId('users'),
        username: user.username,
        display_name: user.display_name || user.username,
        password_hash: user.password_hash,
        role: user.role === 'admin' ? 'admin' : 'user',
        must_change_password: user.must_change_password ? 1 : 0,
        token_version: 0,
        created_at: new Date().toISOString(),
        last_login: null,
      };
      db.users.push(record);
      await persist();
      return clone(record);
    },

    async updateUser(id, patch) {
      const user = db.users.find((u) => u.id === Number(id));
      if (!user) return null;
      for (const key of [
        'display_name',
        'password_hash',
        'role',
        'must_change_password',
        'token_version',
        'last_login',
      ]) {
        if (patch[key] !== undefined) user[key] = patch[key];
      }
      await persist();
      return clone(user);
    },

    async deleteUser(id) {
      const numericId = Number(id);
      db.users = db.users.filter((u) => u.id !== numericId);
      db.bookmarks = db.bookmarks.filter((b) => b.user_id !== numericId);
      delete db.settings[numericId];
      await persist();
    },

    async touchLogin(id) {
      const user = db.users.find((u) => u.id === Number(id));
      if (user) {
        user.last_login = new Date().toISOString();
        await persist();
      }
    },

    /* --------------------------- Lesezeichen -------------------------- */

    async listBookmarks(userId) {
      const uid = Number(userId);
      return db.bookmarks
        .filter((b) => b.user_id === uid || b.shared === 1)
        .sort(
          (a, b) =>
            (b.user_id === uid) - (a.user_id === uid) ||
            a.sort_order - b.sort_order ||
            a.id - b.id
        )
        .map((b) => {
          const owner = db.users.find((u) => u.id === b.user_id);
          return { ...clone(b), owner_username: owner ? owner.username : '' };
        });
    },

    async getBookmark(id) {
      return clone(db.bookmarks.find((b) => b.id === Number(id))) || null;
    },

    async createBookmark(userId, data) {
      const uid = Number(userId);
      const maxOrder = db.bookmarks
        .filter((b) => b.user_id === uid)
        .reduce((max, b) => Math.max(max, b.sort_order), -1);
      const record = {
        id: nextId('bookmarks'),
        user_id: uid,
        title: data.title,
        url: data.url,
        description: data.description,
        tags: data.tags,
        icon: data.icon,
        color: data.color,
        text_color: data.text_color,
        enabled: data.enabled,
        shared: data.shared,
        sort_order: maxOrder + 1,
        pos_x: data.pos_x,
        pos_y: data.pos_y,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.bookmarks.push(record);
      await persist();
      return clone(record);
    },

    async updateBookmark(id, data) {
      const bookmark = db.bookmarks.find((b) => b.id === Number(id));
      if (!bookmark) return null;
      for (const field of [
        'title',
        'url',
        'description',
        'tags',
        'icon',
        'color',
        'text_color',
        'enabled',
        'shared',
        'pos_x',
        'pos_y',
      ]) {
        if (data[field] !== undefined) bookmark[field] = data[field];
      }
      bookmark.updated_at = new Date().toISOString();
      await persist();
      return clone(bookmark);
    },

    async deleteBookmark(id) {
      db.bookmarks = db.bookmarks.filter((b) => b.id !== Number(id));
      await persist();
    },

    async setOrder(userId, ids) {
      const uid = Number(userId);
      ids.forEach((id, index) => {
        const bookmark = db.bookmarks.find((b) => b.id === Number(id) && b.user_id === uid);
        if (bookmark) bookmark.sort_order = index;
      });
      await persist();
    },

    /* --------------------------- Einstellungen ------------------------ */

    async getSettings(userId) {
      return { ...DEFAULT_SETTINGS, ...(db.settings[Number(userId)] || {}) };
    },

    async saveSettings(userId, settings) {
      db.settings[Number(userId)] = settings;
      await persist();
      return settings;
    },

    /* ------------------------- Export / Import ------------------------ */

    async exportAll() {
      return {
        users: clone(db.users),
        bookmarks: clone(db.bookmarks),
        settings: Object.entries(db.settings).map(([user_id, data]) => ({
          user_id: Number(user_id),
          data,
        })),
      };
    },

    async replaceAll({ users, bookmarks, settings }) {
      db.users = users.map((u) => ({
        id: Number(u.id),
        username: u.username,
        display_name: u.display_name || u.username,
        password_hash: u.password_hash,
        role: u.role === 'admin' ? 'admin' : 'user',
        must_change_password: u.must_change_password ? 1 : 0,
        token_version: u.token_version || 0,
        created_at: u.created_at || new Date().toISOString(),
        last_login: u.last_login || null,
      }));
      db.bookmarks = bookmarks.map((b) => ({
        id: Number(b.id),
        user_id: Number(b.user_id),
        title: b.title,
        url: b.url,
        description: b.description || '',
        tags: b.tags || '',
        icon: b.icon || '',
        color: b.color || '#1e293b',
        text_color: b.text_color || '#ffffff',
        enabled: b.enabled ? 1 : 0,
        shared: b.shared ? 1 : 0,
        sort_order: b.sort_order || 0,
        pos_x: b.pos_x === undefined ? null : b.pos_x,
        pos_y: b.pos_y === undefined ? null : b.pos_y,
        created_at: b.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      db.settings = {};
      for (const s of settings) {
        db.settings[Number(s.user_id)] =
          typeof s.data === 'string' ? JSON.parse(s.data) : s.data;
      }
      db.seq = {
        users: db.users.reduce((max, u) => Math.max(max, u.id), 0),
        bookmarks: db.bookmarks.reduce((max, b) => Math.max(max, b.id), 0),
      };
      await persist();
    },
  };
}

module.exports = { createStore };
