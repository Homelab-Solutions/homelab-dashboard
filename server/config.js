'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const network = require('./network');

const ROOT_DIR = path.resolve(__dirname, '..');
const { version: APP_VERSION } = require('../package.json');

/**
 * Minimalistischer .env-Loader (ohne externe Abhaengigkeit).
 * Bereits gesetzte Umgebungsvariablen (z.B. aus docker-compose env_file)
 * haben Vorrang und werden nicht ueberschrieben.
 */
function loadDotEnv(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT_DIR, '.env'));

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Session-Secret: aus der .env, ansonsten einmalig generiert und unter
 * data/session.secret abgelegt, damit Anmeldungen einen Neustart ueberleben.
 */
function resolveSessionSecret() {
  const fromEnv = (process.env.SESSION_SECRET || '').trim();
  if (fromEnv.length >= 16) return fromEnv;

  const secretFile = path.join(DATA_DIR, 'session.secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* Datei existiert noch nicht */
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  console.warn(
    '[config] SESSION_SECRET war nicht gesetzt - es wurde einer in data/session.secret generiert.'
  );
  return generated;
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const storageMode = ['auto', 'mysql', 'file'].includes(
  (process.env.STORAGE || '').toLowerCase()
)
  ? process.env.STORAGE.toLowerCase()
  : 'auto';

// Tailscale (100.64.0.0/10) zaehlt bewusst als lokal.
const DEFAULT_LOCAL_NETWORKS =
  '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,127.0.0.0/8,::1';

module.exports = {
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  dataDir: DATA_DIR,
  port: int(process.env.PORT, 3002),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'production',
  version: APP_VERSION,
  storageMode,
  db: {
    // Kein interner Standard-Host im Quellcode: DB_HOST kommt aus der Umgebung (.env); ohne Wert gilt localhost
    // (STORAGE=auto faellt bei fehlender Verbindung wie bisher auf den Datei-Storage zurueck).
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'homelab_dashboard_db',
  },
  session: {
    cookieName: 'hd_session',
    secret: resolveSessionSecret(),
    // Laufzeit wird beim Login anhand der Client-IP gewaehlt (lokal/remote).
    daysLocal: int(process.env.SESSION_DAYS_LOCAL, 3650),
    daysRemote: int(process.env.SESSION_DAYS_REMOTE, 90),
    localNetworks: network.parseCidrList(
      process.env.LOCAL_NETWORKS || DEFAULT_LOCAL_NETWORKS
    ),
    // Leer = X-Forwarded-For/-Proto werden ignoriert, nur die Socket-IP zaehlt.
    trustedProxies: network.parseCidrList(process.env.TRUSTED_PROXIES || ''),
    // Sliding Session: Cookie wird erst neu gesetzt, wenn seit der letzten
    // Erneuerung mindestens so viel Zeit vergangen ist (vermeidet Set-Cookie
    // bei jeder Anfrage).
    renewThresholdMs: 60 * 60 * 1000,
  },
  bootstrapAdmin: {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin',
  },
  limits: {
    // Icons/Hintergrundbilder werden als Data-URL gespeichert
    jsonBody: '8mb',
    iconBytes: 1024 * 1024,
    backgroundBytes: 6 * 1024 * 1024,
  },
};
