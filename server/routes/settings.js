'use strict';

const express = require('express');
const auth = require('./../auth');
const config = require('./../config');
const { normalizeSettings } = require('./../validate');
const { DEFAULT_SETTINGS, SEARCH_ENGINES, TILE_COLORS } = require('./../defaults');

function createRouter(store) {
  const router = express.Router();
  router.use(auth.requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const settings = await store.getSettings(req.user.id);
      res.json({
        settings,
        defaults: DEFAULT_SETTINGS,
        searchEngines: SEARCH_ENGINES,
        tileColors: TILE_COLORS,
        version: config.version,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/', async (req, res, next) => {
    try {
      const current = await store.getSettings(req.user.id);
      const merged = normalizeSettings({ ...current, ...(req.body || {}) });
      await store.saveSettings(req.user.id, merged);
      res.json({ settings: merged });
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset', async (req, res, next) => {
    try {
      const fresh = { ...DEFAULT_SETTINGS };
      await store.saveSettings(req.user.id, fresh);
      res.json({ settings: fresh });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRouter };
