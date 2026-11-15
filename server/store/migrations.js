'use strict';

/**
 * Geordnete, idempotente Schema-Migrationen - gemeinsam fuer MariaDB- und
 * Datei-Storage. Migration 1 ist die Baseline (bestehender Ist-Zustand,
 * keine Datenaenderung). Jede weitere Migration prueft vor einer Aenderung,
 * ob sie bereits angewendet wurde.
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline',
    // Tabellen/Datei-Struktur bestehen bereits (siehe store/mysql.js SCHEMA
    // bzw. store/file.js) - diese Migration markiert nur den Ist-Zustand.
    async mysql(_conn) {},
    file(_db) {},
  },
  {
    version: 2,
    name: 'users-token-version',
    async mysql(conn) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'token_version'`
      );
      if (Number(rows[0].n) === 0) {
        await conn.query(
          'ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0'
        );
      }
    },
    file(db) {
      for (const user of db.users) {
        if (user.token_version === undefined || user.token_version === null) {
          user.token_version = 0;
        }
      }
    },
  },
];

/** Legt schema_version an (falls noetig) und wendet fehlende Migrationen an. */
async function runMysqlMigrations(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_version (
       version INT UNSIGNED NOT NULL,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (version)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  const [rows] = await pool.query('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version');
  const current = Number(rows[0].v) || 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await migration.mysql(conn);
      await conn.query('INSERT INTO schema_version (version) VALUES (?)', [migration.version]);
      await conn.commit();
      console.log(
        `[migrations] MariaDB-Migration ${migration.version} (${migration.name}) angewendet.`
      );
    } catch (err) {
      // ALTER TABLE bewirkt in MariaDB einen impliziten Commit - das Rollback
      // kann daher ins Leere laufen; der Fehler wird trotzdem weitergereicht.
      try {
        await conn.rollback();
      } catch {
        /* siehe Kommentar oben */
      }
      console.error(
        `[migrations] MariaDB-Migration ${migration.version} (${migration.name}) fehlgeschlagen: ${err.message}`
      );
      throw err;
    } finally {
      conn.release();
    }
  }
}

/** Wendet fehlende Migrationen direkt auf das Datei-Storage-Objekt an. */
function runFileMigrations(db) {
  const current = Number(db.schemaVersion) || 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    try {
      migration.file(db);
      db.schemaVersion = migration.version;
      console.log(
        `[migrations] Datei-Migration ${migration.version} (${migration.name}) angewendet.`
      );
    } catch (err) {
      console.error(
        `[migrations] Datei-Migration ${migration.version} (${migration.name}) fehlgeschlagen: ${err.message}`
      );
      throw err;
    }
  }
}

module.exports = { MIGRATIONS, runMysqlMigrations, runFileMigrations };
