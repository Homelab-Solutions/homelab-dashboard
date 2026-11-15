'use strict';

const mysql = require('mysql2/promise');
const config = require('./../config');
const { DEFAULT_SETTINGS } = require('./../defaults');
const { runMysqlMigrations } = require('./migrations');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT,
     username VARCHAR(32) NOT NULL,
     display_name VARCHAR(64) NOT NULL DEFAULT '',
     password_hash VARCHAR(255) NOT NULL,
     role VARCHAR(16) NOT NULL DEFAULT 'user',
     must_change_password TINYINT(1) NOT NULL DEFAULT 0,
     token_version INT UNSIGNED NOT NULL DEFAULT 0,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     last_login TIMESTAMP NULL DEFAULT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uq_users_username (username)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS bookmarks (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT,
     user_id INT UNSIGNED NOT NULL,
     title VARCHAR(120) NOT NULL,
     url VARCHAR(2048) NOT NULL,
     description TEXT NULL,
     tags VARCHAR(255) NOT NULL DEFAULT '',
     icon MEDIUMTEXT NULL,
     color VARCHAR(16) NOT NULL DEFAULT '#1e293b',
     text_color VARCHAR(16) NOT NULL DEFAULT '#ffffff',
     enabled TINYINT(1) NOT NULL DEFAULT 1,
     shared TINYINT(1) NOT NULL DEFAULT 0,
     sort_order INT NOT NULL DEFAULT 0,
     pos_x FLOAT NULL DEFAULT NULL,
     pos_y FLOAT NULL DEFAULT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     KEY idx_bookmarks_user (user_id, sort_order),
     CONSTRAINT fk_bookmarks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS settings (
     user_id INT UNSIGNED NOT NULL,
     data LONGTEXT NOT NULL,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (user_id),
     CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const BOOKMARK_FIELDS = [
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
];

function parseSettings(raw) {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function createStore() {
  // Datenbank anlegen, falls sie noch nicht existiert
  const bootstrap = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    connectTimeout: 8000,
  });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database.replace(/`/g, '')}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 8,
    queueLimit: 0,
    connectTimeout: 8000,
    charset: 'utf8mb4_unicode_ci',
  });

  for (const stmt of SCHEMA) {
    await pool.query(stmt);
  }

  try {
    await runMysqlMigrations(pool);
  } catch (err) {
    err.migrationFailure = true;
    throw err;
  }

  const q = async (sql, params = []) => {
    const [rows] = await pool.query(sql, params);
    return rows;
  };

  return {
    mode: 'mariadb',
    describe: `MariaDB ${config.db.host}:${config.db.port}/${config.db.database}`,

    async close() {
      await pool.end();
    },

    /* ---------------------------- Benutzer ---------------------------- */

    async countUsers() {
      const rows = await q('SELECT COUNT(*) AS n FROM users');
      return Number(rows[0].n);
    },

    async listUsers() {
      return q(
        `SELECT u.id, u.username, u.display_name, u.role, u.must_change_password,
                u.created_at, u.last_login,
                (SELECT COUNT(*) FROM bookmarks b WHERE b.user_id = u.id) AS bookmark_count
           FROM users u ORDER BY u.id ASC`
      );
    },

    async getUserById(id) {
      const rows = await q('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    },

    async getUserByUsername(username) {
      const rows = await q('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
      return rows[0] || null;
    },

    async createUser(user) {
      const rows = await q(
        `INSERT INTO users (username, display_name, password_hash, role, must_change_password)
         VALUES (?, ?, ?, ?, ?)`,
        [
          user.username,
          user.display_name || user.username,
          user.password_hash,
          user.role === 'admin' ? 'admin' : 'user',
          user.must_change_password ? 1 : 0,
        ]
      );
      return this.getUserById(rows.insertId);
    },

    async updateUser(id, patch) {
      const allowed = [
        'display_name',
        'password_hash',
        'role',
        'must_change_password',
        'token_version',
        'last_login',
      ];
      const sets = [];
      const params = [];
      for (const key of allowed) {
        if (patch[key] !== undefined) {
          sets.push(`${key} = ?`);
          params.push(patch[key]);
        }
      }
      if (!sets.length) return this.getUserById(id);
      params.push(id);
      await q(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
      return this.getUserById(id);
    },

    async deleteUser(id) {
      await q('DELETE FROM users WHERE id = ?', [id]);
    },

    async touchLogin(id) {
      await q('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    },

    /* --------------------------- Lesezeichen -------------------------- */

    /** Eigene Lesezeichen plus die vom Admin freigegebenen. */
    async listBookmarks(userId) {
      return q(
        `SELECT b.*, u.username AS owner_username
           FROM bookmarks b JOIN users u ON u.id = b.user_id
          WHERE b.user_id = ? OR b.shared = 1
          ORDER BY (b.user_id = ?) DESC, b.sort_order ASC, b.id ASC`,
        [userId, userId]
      );
    },

    async getBookmark(id) {
      const rows = await q('SELECT * FROM bookmarks WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    },

    async createBookmark(userId, data) {
      const rows = await q(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM bookmarks WHERE user_id = ?',
        [userId]
      );
      const sortOrder = Number(rows[0].next) || 0;
      const inserted = await q(
        `INSERT INTO bookmarks
           (user_id, title, url, description, tags, icon, color, text_color,
            enabled, shared, sort_order, pos_x, pos_y)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          data.title,
          data.url,
          data.description,
          data.tags,
          data.icon,
          data.color,
          data.text_color,
          data.enabled,
          data.shared,
          sortOrder,
          data.pos_x,
          data.pos_y,
        ]
      );
      return this.getBookmark(inserted.insertId);
    },

    async updateBookmark(id, data) {
      const sets = [];
      const params = [];
      for (const field of BOOKMARK_FIELDS) {
        if (data[field] !== undefined) {
          sets.push(`${field} = ?`);
          params.push(data[field]);
        }
      }
      if (!sets.length) return this.getBookmark(id);
      params.push(id);
      await q(`UPDATE bookmarks SET ${sets.join(', ')} WHERE id = ?`, params);
      return this.getBookmark(id);
    },

    async deleteBookmark(id) {
      await q('DELETE FROM bookmarks WHERE id = ?', [id]);
    },

    async setOrder(userId, ids) {
      let i = 0;
      for (const id of ids) {
        await q('UPDATE bookmarks SET sort_order = ? WHERE id = ? AND user_id = ?', [
          i++,
          id,
          userId,
        ]);
      }
    },

    /* --------------------------- Einstellungen ------------------------ */

    async getSettings(userId) {
      const rows = await q('SELECT data FROM settings WHERE user_id = ? LIMIT 1', [userId]);
      return parseSettings(rows[0] && rows[0].data);
    },

    async saveSettings(userId, settings) {
      await q(
        `INSERT INTO settings (user_id, data) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [userId, JSON.stringify(settings)]
      );
      return settings;
    },

    /* ------------------------- Export / Import ------------------------ */

    async exportAll() {
      const users = await q('SELECT * FROM users ORDER BY id ASC');
      const bookmarks = await q('SELECT * FROM bookmarks ORDER BY user_id ASC, sort_order ASC');
      const settings = await q('SELECT user_id, data FROM settings');
      return { users, bookmarks, settings };
    },

    async replaceAll({ users, bookmarks, settings }) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM bookmarks');
        await conn.query('DELETE FROM settings');
        await conn.query('DELETE FROM users');

        for (const u of users) {
          await conn.query(
            `INSERT INTO users
               (id, username, display_name, password_hash, role, must_change_password, token_version)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              u.id,
              u.username,
              u.display_name || u.username,
              u.password_hash,
              u.role === 'admin' ? 'admin' : 'user',
              u.must_change_password ? 1 : 0,
              u.token_version || 0,
            ]
          );
        }
        for (const b of bookmarks) {
          await conn.query(
            `INSERT INTO bookmarks
               (id, user_id, title, url, description, tags, icon, color, text_color,
                enabled, shared, sort_order, pos_x, pos_y)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              b.id,
              b.user_id,
              b.title,
              b.url,
              b.description || '',
              b.tags || '',
              b.icon || '',
              b.color || '#1e293b',
              b.text_color || '#ffffff',
              b.enabled ? 1 : 0,
              b.shared ? 1 : 0,
              b.sort_order || 0,
              b.pos_x === null || b.pos_x === undefined ? null : b.pos_x,
              b.pos_y === null || b.pos_y === undefined ? null : b.pos_y,
            ]
          );
        }
        for (const s of settings) {
          await conn.query('INSERT INTO settings (user_id, data) VALUES (?, ?)', [
            s.user_id,
            typeof s.data === 'string' ? s.data : JSON.stringify(s.data),
          ]);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}

module.exports = { createStore };
