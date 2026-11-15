'use strict';

const express = require('express');
const auth = require('./../auth');
const { HttpError, normalizeUsername, checkPassword, str } = require('./../validate');
const { publicUser } = require('./auth');

function createRouter(store) {
  const router = express.Router();
  router.use(auth.requireAdmin);

  router.get('/', async (_req, res, next) => {
    try {
      const users = await store.listUsers();
      res.json({
        users: users.map((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.username,
          role: u.role,
          mustChangePassword: Boolean(Number(u.must_change_password)),
          createdAt: u.created_at,
          lastLogin: u.last_login,
          bookmarkCount: Number(u.bookmark_count) || 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body || {};
      const username = normalizeUsername(body.username);
      const password = checkPassword(body.password);
      if (await store.getUserByUsername(username)) {
        throw new HttpError(409, 'Dieser Benutzername ist bereits vergeben.');
      }
      const created = await store.createUser({
        username,
        display_name: str(body.displayName, 64) || username,
        password_hash: auth.hashPassword(password),
        role: body.role === 'admin' ? 'admin' : 'user',
        must_change_password: body.mustChangePassword ? 1 : 0,
      });
      res.status(201).json({ user: publicUser(created) });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const target = await store.getUserById(id);
      if (!target) throw new HttpError(404, 'Benutzer nicht gefunden.');

      const body = req.body || {};
      const patch = {};
      let bumpToken = false;

      if (body.displayName !== undefined) {
        patch.display_name = str(body.displayName, 64) || target.username;
      }
      if (body.role !== undefined) {
        const role = body.role === 'admin' ? 'admin' : 'user';
        // Der letzte Administrator darf nicht degradiert werden
        if (target.role === 'admin' && role === 'user') {
          const admins = (await store.listUsers()).filter((u) => u.role === 'admin');
          if (admins.length <= 1) {
            throw new HttpError(409, 'Es muss mindestens ein Administrator vorhanden sein.');
          }
        }
        if (role !== target.role) bumpToken = true;
        patch.role = role;
      }
      if (body.password) {
        patch.password_hash = auth.hashPassword(checkPassword(body.password));
        patch.must_change_password = body.mustChangePassword ? 1 : 0;
        bumpToken = true;
      } else if (body.mustChangePassword !== undefined) {
        patch.must_change_password = body.mustChangePassword ? 1 : 0;
        if (body.mustChangePassword) bumpToken = true;
      }
      // Rollenwechsel, erzwungener Passwortwechsel oder neues Passwort
      // invalidieren alle Sitzungen dieses Kontos (token_version).
      if (bumpToken) patch.token_version = (target.token_version || 0) + 1;

      const updated = await store.updateUser(id, patch);
      res.json({ user: publicUser(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (id === Number(req.user.id)) {
        throw new HttpError(409, 'Das eigene Konto kann nicht geloescht werden.');
      }
      const target = await store.getUserById(id);
      if (!target) throw new HttpError(404, 'Benutzer nicht gefunden.');
      if (target.role === 'admin') {
        const admins = (await store.listUsers()).filter((u) => u.role === 'admin');
        if (admins.length <= 1) {
          throw new HttpError(409, 'Der letzte Administrator kann nicht geloescht werden.');
        }
      }
      await store.deleteUser(id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRouter };
