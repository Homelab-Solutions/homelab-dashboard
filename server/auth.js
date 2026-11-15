'use strict';

const crypto = require('crypto');
const config = require('./config');
const network = require('./network');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ------------------------------------------------------------------ *
 * Passwoerter (scrypt, Node-Bordmittel - keine externe Abhaengigkeit)
 * ------------------------------------------------------------------ */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('hex'),
    dk.toString('hex'),
  ].join('$');
}

function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(
      String(plain),
      Buffer.from(saltHex, 'hex'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) }
    );
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Sessions als HMAC-signierte Cookies (ueberlebt Container-Neustart)
 * ------------------------------------------------------------------ */

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payload) {
  return b64url(
    crypto.createHmac('sha256', config.session.secret).update(payload).digest()
  );
}

function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * ttlMs legt die Gesamt-Laufzeit der Session fest (abhaengig von der
 * Client-IP beim Login, siehe routes/auth.js) und bleibt ueber die gesamte
 * Lebensdauer der Session gleich (Sliding Session verlaengert nur "iat").
 */
function createSessionToken(user, ttlMs, now = Date.now()) {
  const payload = b64url(
    JSON.stringify({
      uid: user.id,
      v: user.token_version || 0,
      ttl: ttlMs,
      iat: now,
      exp: now + ttlMs,
    })
  );
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(fromB64url(payload).toString('utf8'));
  } catch {
    return null;
  }
  // Tokens im alten Format (ohne ttl/iat) werden absichtlich ungueltig -
  // einmal neu einloggen reicht, kein Absturz.
  if (
    !data ||
    typeof data.uid !== 'number' ||
    typeof data.ttl !== 'number' ||
    typeof data.iat !== 'number' ||
    typeof data.exp !== 'number' ||
    data.exp < Date.now()
  ) {
    return null;
  }
  return data;
}

/** Setzt das Session-Cookie; "Secure" nur bei einer (direkten oder per Trusted-Proxy erkannten) HTTPS-Verbindung. */
function setSessionCookie(req, res, user, ttlMs, now = Date.now()) {
  const secure = network.resolveRequestSecure(req, config.session.trustedProxies);
  const parts = [
    `${config.session.cookieName}=${createSessionToken(user, ttlMs, now)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/** Laufzeit beim Login: lokale Clients (inkl. Tailscale) lang, alle anderen kurz. */
function sessionTtlForRequest(req) {
  const isLocal = network.isIpInList(req.clientIp, config.session.localNetworks);
  return daysToMs(isLocal ? config.session.daysLocal : config.session.daysRemote);
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${config.session.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Express-Middleware
 * ------------------------------------------------------------------ */

function attachUser(store) {
  return async function (req, _res, next) {
    req.user = null;
    req.sessionData = null;
    try {
      const cookies = parseCookies(req.headers.cookie);
      const data = readSessionToken(cookies[config.session.cookieName]);
      if (data) {
        const user = await store.getUserById(data.uid);
        // token_version invalidiert Sessions nach Passwortwechsel/Rollenwechsel
        if (user && (user.token_version || 0) === (data.v || 0)) {
          req.user = user;
          req.sessionData = data;
        }
      }
    } catch (err) {
      console.error('[auth] Session konnte nicht geprueft werden:', err.message);
    }
    next();
  };
}

/**
 * Sliding Session: bei jedem authentifizierten Request wird der Ablauf
 * verlaengert, aber nur wenn seit der letzten Erneuerung mindestens
 * renewThresholdMs vergangen ist (vermeidet ein Set-Cookie je Anfrage).
 * Laeuft nach attachUser.
 */
function renewSession(req, res, next) {
  if (req.user && req.sessionData) {
    const elapsed = Date.now() - req.sessionData.iat;
    if (elapsed >= config.session.renewThresholdMs) {
      setSessionCookie(req, res, req.user, req.sessionData.ttl);
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administratorrechte erforderlich' });
  }
  next();
}

/* ------------------------------------------------------------------ *
 * Einfache Anmelde-Bremse gegen Passwort-Raten
 * ------------------------------------------------------------------ */

const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function loginThrottle(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    return { blocked: false, retryInSec: 0 };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return {
      blocked: true,
      retryInSec: Math.ceil((entry.first + WINDOW_MS - now) / 1000),
    };
  }
  return { blocked: false, retryInSec: 0 };
}

function registerFailure(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { first: now, count: 1 });
  } else {
    entry.count += 1;
  }
}

function clearFailures(key) {
  attempts.delete(key);
}

module.exports = {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  sessionTtlForRequest,
  clearSessionCookie,
  attachUser,
  renewSession,
  requireAuth,
  requireAdmin,
  loginThrottle,
  registerFailure,
  clearFailures,
};
