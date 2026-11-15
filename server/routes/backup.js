'use strict';

const express = require('express');
const auth = require('./../auth');
const { HttpError, normalizeSettings } = require('./../validate');

const EXPORT_VERSION = 1;

function filenameStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function createRouter(store) {
  const router = express.Router();
  router.use(auth.requireAuth);

  /** Vollstaendige Sicherung (nur Administrator) - fuer Neuinstallationen. */
  router.get('/export', auth.requireAdmin, async (_req, res, next) => {
    try {
      const dump = await store.exportAll();
      const payload = {
        app: 'homelab-dashboard',
        exportVersion: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        storage: store.mode,
        users: dump.users.map((u) => ({
          id: Number(u.id),
          username: u.username,
          display_name: u.display_name || u.username,
          password_hash: u.password_hash,
          role: u.role,
          must_change_password: Number(u.must_change_password) ? 1 : 0,
          token_version: Number(u.token_version) || 0,
          created_at: u.created_at,
        })),
        bookmarks: dump.bookmarks.map((b) => ({
          id: Number(b.id),
          user_id: Number(b.user_id),
          title: b.title,
          url: b.url,
          description: b.description || '',
          tags: b.tags || '',
          icon: b.icon || '',
          color: b.color,
          text_color: b.text_color,
          enabled: Number(b.enabled) ? 1 : 0,
          shared: Number(b.shared) ? 1 : 0,
          sort_order: Number(b.sort_order) || 0,
          pos_x: b.pos_x === null || b.pos_x === undefined ? null : Number(b.pos_x),
          pos_y: b.pos_y === null || b.pos_y === undefined ? null : Number(b.pos_y),
        })),
        settings: dump.settings.map((s) => ({
          user_id: Number(s.user_id),
          data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
        })),
      };

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="homelab-dashboard-backup-${filenameStamp()}.json"`
      );
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      next(err);
    }
  });

  /** Export der eigenen Daten (ohne Passwoerter) - fuer jeden Benutzer. */
  router.get('/export/me', async (req, res, next) => {
    try {
      const bookmarks = (await store.listBookmarks(req.user.id)).filter(
        (b) => Number(b.user_id) === Number(req.user.id)
      );
      const settings = await store.getSettings(req.user.id);
      const payload = {
        app: 'homelab-dashboard',
        exportVersion: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        scope: 'user',
        username: req.user.username,
        settings,
        bookmarks: bookmarks.map((b) => ({
          title: b.title,
          url: b.url,
          description: b.description || '',
          tags: b.tags || '',
          icon: b.icon || '',
          color: b.color,
          text_color: b.text_color,
          enabled: Number(b.enabled) ? 1 : 0,
          sort_order: Number(b.sort_order) || 0,
          pos_x: b.pos_x ?? null,
          pos_y: b.pos_y ?? null,
        })),
      };
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="homelab-dashboard-${req.user.username}-${filenameStamp()}.json"`
      );
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      next(err);
    }
  });

  /**
   * Vollstaendige Wiederherstellung (nur Administrator).
   * Achtung: ersetzt Benutzer, Lesezeichen und Einstellungen komplett.
   */
  router.post('/import', auth.requireAdmin, async (req, res, next) => {
    try {
      const payload = req.body || {};
      if (payload.app !== 'homelab-dashboard' || !Array.isArray(payload.users)) {
        throw new HttpError(400, 'Die Datei ist keine gueltige Dashboard-Sicherung.');
      }
      if (!payload.users.length) {
        throw new HttpError(400, 'Die Sicherung enthaelt keine Benutzer.');
      }
      if (!payload.users.some((u) => u.role === 'admin')) {
        throw new HttpError(400, 'Die Sicherung enthaelt keinen Administrator.');
      }
      for (const user of payload.users) {
        if (!user.username || !user.password_hash || !Number.isFinite(Number(user.id))) {
          throw new HttpError(400, 'Mindestens ein Benutzereintrag ist unvollstaendig.');
        }
      }

      await store.replaceAll({
        users: payload.users,
        bookmarks: Array.isArray(payload.bookmarks) ? payload.bookmarks : [],
        settings: (Array.isArray(payload.settings) ? payload.settings : []).map((s) => ({
          user_id: Number(s.user_id),
          data: normalizeSettings(typeof s.data === 'string' ? JSON.parse(s.data) : s.data),
        })),
      });

      auth.clearSessionCookie(res);
      res.json({
        ok: true,
        users: payload.users.length,
        bookmarks: Array.isArray(payload.bookmarks) ? payload.bookmarks.length : 0,
        message:
          'Sicherung wiederhergestellt. Bitte neu anmelden - es gelten die Zugangsdaten aus der Sicherung.',
      });
    } catch (err) {
      next(err);
    }
  });

  /** Lesezeichen aus einer Sicherung in das eigene Konto uebernehmen. */
  router.post('/import/bookmarks', async (req, res, next) => {
    try {
      const list = Array.isArray(req.body && req.body.bookmarks) ? req.body.bookmarks : null;
      if (!list) throw new HttpError(400, 'Die Datei enthaelt keine Lesezeichen.');

      const { normalizeBookmark } = require('./../validate');
      let imported = 0;
      for (const entry of list.slice(0, 500)) {
        try {
          const data = normalizeBookmark({
            title: entry.title,
            url: entry.url,
            description: entry.description,
            tags: entry.tags,
            icon: entry.icon,
            color: entry.color,
            text_color: entry.text_color || entry.textColor,
            enabled: entry.enabled === undefined ? true : entry.enabled,
            shared: false,
            pos_x: entry.pos_x ?? entry.posX ?? null,
            pos_y: entry.pos_y ?? entry.posY ?? null,
          });
          await store.createBookmark(req.user.id, data);
          imported += 1;
        } catch {
          /* fehlerhafte Eintraege ueberspringen */
        }
      }
      res.json({ ok: true, imported, skipped: Math.min(list.length, 500) - imported });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRouter };
