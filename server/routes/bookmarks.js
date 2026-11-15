'use strict';

const express = require('express');
const auth = require('./../auth');
const { HttpError, normalizeBookmark, num } = require('./../validate');

function toApi(row) {
  return {
    id: row.id,
    userId: row.user_id,
    ownerUsername: row.owner_username,
    title: row.title,
    url: row.url,
    description: row.description || '',
    tags: row.tags || '',
    icon: row.icon || '',
    color: row.color || '#1e293b',
    textColor: row.text_color || '#ffffff',
    enabled: Boolean(Number(row.enabled)),
    shared: Boolean(Number(row.shared)),
    sortOrder: Number(row.sort_order) || 0,
    posX: row.pos_x === null || row.pos_x === undefined ? null : Number(row.pos_x),
    posY: row.pos_y === null || row.pos_y === undefined ? null : Number(row.pos_y),
  };
}

/** Eingaben des Clients (camelCase) auf Datenbankfelder abbilden. */
function fromApi(body = {}) {
  return normalizeBookmark({
    title: body.title,
    url: body.url,
    description: body.description,
    tags: body.tags,
    icon: body.icon,
    color: body.color,
    text_color: body.textColor,
    enabled: body.enabled,
    shared: body.shared,
    pos_x: body.posX,
    pos_y: body.posY,
  });
}

function createRouter(store) {
  const router = express.Router();
  router.use(auth.requireAuth);

  /** Lesezeichen laden, auf die der aktuelle Benutzer schreibend zugreifen darf. */
  async function ownedBookmark(req) {
    const bookmark = await store.getBookmark(Number(req.params.id));
    if (!bookmark) throw new HttpError(404, 'Lesezeichen nicht gefunden.');
    const isOwner = Number(bookmark.user_id) === Number(req.user.id);
    if (!isOwner && req.user.role !== 'admin') {
      throw new HttpError(403, 'Dieses Lesezeichen gehoert einem anderen Benutzer.');
    }
    return bookmark;
  }

  router.get('/', async (req, res, next) => {
    try {
      const rows = await store.listBookmarks(req.user.id);
      res.json({ bookmarks: rows.map(toApi) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const data = fromApi(req.body);
      if (data.shared && req.user.role !== 'admin') data.shared = 0;
      const created = await store.createBookmark(req.user.id, data);
      res.status(201).json({ bookmark: toApi(created) });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const bookmark = await ownedBookmark(req);
      const data = fromApi({ ...toApi(bookmark), ...req.body });
      if (req.user.role !== 'admin') data.shared = Number(bookmark.shared) ? 1 : 0;
      const updated = await store.updateBookmark(bookmark.id, data);
      res.json({ bookmark: toApi(updated) });
    } catch (err) {
      next(err);
    }
  });

  /** Nur Position (Freie Anordnung per Drag & Drop). */
  router.put('/:id/position', async (req, res, next) => {
    try {
      const bookmark = await ownedBookmark(req);
      const body = req.body || {};
      const reset = body.posX === null || body.posY === null;
      const updated = await store.updateBookmark(bookmark.id, {
        pos_x: reset ? null : num(body.posX, 0, 100, 0),
        pos_y: reset ? null : num(body.posY, 0, 100, 0),
      });
      res.json({ bookmark: toApi(updated) });
    } catch (err) {
      next(err);
    }
  });

  /** Nur Aktiv-Status umschalten. */
  router.put('/:id/enabled', async (req, res, next) => {
    try {
      const bookmark = await ownedBookmark(req);
      const enabled = Boolean(req.body && req.body.enabled) ? 1 : 0;
      const updated = await store.updateBookmark(bookmark.id, { enabled });
      res.json({ bookmark: toApi(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const bookmark = await ownedBookmark(req);
      await store.deleteBookmark(bookmark.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /** Reihenfolge der eigenen Lesezeichen setzen. */
  router.post('/reorder', async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
      if (!ids) throw new HttpError(400, 'Es wurde keine Reihenfolge uebergeben.');
      await store.setOrder(req.user.id, ids.map(Number).filter(Number.isFinite).slice(0, 500));
      const rows = await store.listBookmarks(req.user.id);
      res.json({ bookmarks: rows.map(toApi) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRouter, toApi };
