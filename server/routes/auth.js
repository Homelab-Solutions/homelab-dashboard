'use strict';

const express = require('express');
const auth = require('./../auth');
const { HttpError, normalizeUsername, checkPassword, str } = require('./../validate');

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
    mustChangePassword: Boolean(Number(user.must_change_password)),
  };
}

function createRouter(store) {
  const router = express.Router();

  router.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = str(req.body && req.body.username, 32).toLowerCase();
      const password = str(req.body && req.body.password, 200);
      const key = `${req.clientIp}|${username}`;

      const throttle = auth.loginThrottle(key);
      if (throttle.blocked) {
        throw new HttpError(
          429,
          `Zu viele Fehlversuche. Bitte in ${throttle.retryInSec} Sekunden erneut versuchen.`
        );
      }
      if (!username || !password) {
        throw new HttpError(400, 'Benutzername und Passwort sind erforderlich.');
      }

      const user = await store.getUserByUsername(username);
      if (!user || !auth.verifyPassword(password, user.password_hash)) {
        auth.registerFailure(key);
        throw new HttpError(401, 'Benutzername oder Passwort ist falsch.');
      }

      auth.clearFailures(key);
      await store.touchLogin(user.id);
      auth.setSessionCookie(req, res, user, auth.sessionTtlForRequest(req));
      res.json({ user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res) => {
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  /** Eigenes Passwort aendern (auch fuer den erzwungenen Wechsel). */
  router.post('/password', auth.requireAuth, async (req, res, next) => {
    try {
      const current = str(req.body && req.body.currentPassword, 200);
      const next_ = checkPassword(req.body && req.body.newPassword);
      if (!auth.verifyPassword(current, req.user.password_hash)) {
        throw new HttpError(401, 'Das aktuelle Passwort ist falsch.');
      }
      const updated = await store.updateUser(req.user.id, {
        password_hash: auth.hashPassword(next_),
        must_change_password: 0,
        token_version: (req.user.token_version || 0) + 1,
      });
      // Eigene Session bleibt gueltig (neues Cookie mit neuer Token-Version),
      // alle anderen Sitzungen werden durch den Versionssprung ungueltig.
      auth.setSessionCookie(req, res, updated, req.sessionData.ttl);
      res.json({ user: publicUser(updated) });
    } catch (err) {
      next(err);
    }
  });

  /** Alle anderen Sitzungen dieses Kontos beenden ("Ueberall abmelden"). */
  router.post('/logout-all', auth.requireAuth, async (req, res, next) => {
    try {
      const updated = await store.updateUser(req.user.id, {
        token_version: (req.user.token_version || 0) + 1,
      });
      auth.setSessionCookie(req, res, updated, req.sessionData.ttl);
      res.json({ user: publicUser(updated) });
    } catch (err) {
      next(err);
    }
  });

  /** Eigenen Anzeigenamen aendern. */
  router.post('/profile', auth.requireAuth, async (req, res, next) => {
    try {
      const displayName = str(req.body && req.body.displayName, 64);
      if (!displayName) throw new HttpError(400, 'Der Anzeigename darf nicht leer sein.');
      const updated = await store.updateUser(req.user.id, { display_name: displayName });
      res.json({ user: publicUser(updated) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRouter, publicUser, normalizeUsername };
