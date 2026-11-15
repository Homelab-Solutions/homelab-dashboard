'use strict';

const path = require('path');
const express = require('express');

const config = require('./config');
const auth = require('./auth');
const network = require('./network');
const { initStore } = require('./store');
const { HttpError } = require('./validate');

const authRoutes = require('./routes/auth');
const bookmarkRoutes = require('./routes/bookmarks');
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/users');
const iconRoutes = require('./routes/icons');
const backupRoutes = require('./routes/backup');

async function main() {
  const store = await initStore();
  const app = express();

  // Kein pauschales "trust proxy": X-Forwarded-For/-Proto werden nur fuer
  // Anfragen von TRUSTED_PROXIES ausgewertet (siehe server/network.js).
  app.disable('x-powered-by');

  app.use(express.json({ limit: config.limits.jsonBody }));

  // Grundlegende Schutz-Header (Dashboard laeuft im lokalen Netz)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use((req, _res, next) => {
    req.clientIp = network.resolveRequestIp(req, config.session.trustedProxies);
    next();
  });

  app.use(auth.attachUser(store));
  app.use(auth.renewSession);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      storage: store.mode,
      version: config.version,
      uptime: Math.round(process.uptime()),
    });
  });

  app.use('/api/auth', authRoutes.createRouter(store));

  /**
   * Solange ein Passwortwechsel erzwungen ist, bleiben die uebrigen
   * API-Endpunkte gesperrt (Schutz vor dem Standard-Passwort).
   */
  app.use('/api', (req, res, next) => {
    if (req.user && Number(req.user.must_change_password)) {
      return res.status(428).json({
        error: 'Bitte zuerst ein neues Passwort setzen.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    next();
  });

  app.use('/api/bookmarks', bookmarkRoutes.createRouter(store));
  app.use('/api/settings', settingsRoutes.createRouter(store));
  app.use('/api/users', userRoutes.createRouter(store));
  app.use('/api/icons', iconRoutes.createRouter(store));
  app.use('/api/backup', backupRoutes.createRouter(store));

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Unbekannter API-Endpunkt' });
  });

  /* ------------------------------ Frontend ------------------------------ */

  const sendPage = (res, file) =>
    res.sendFile(path.join(config.publicDir, file), {
      headers: { 'Cache-Control': 'no-store' },
    });

  app.get(['/login', '/login.html'], (req, res) => {
    if (req.user) return res.redirect('/');
    sendPage(res, 'login.html');
  });

  app.get(['/', '/index.html'], (req, res) => {
    if (!req.user) return res.redirect('/login');
    sendPage(res, 'index.html');
  });

  app.use(
    express.static(config.publicDir, {
      index: false,
      maxAge: config.env === 'production' ? '1h' : 0,
      etag: true,
    })
  );

  // Alles Weitere gehoert zur Single-Page-Anwendung
  app.use((req, res) => {
    if (!req.user) return res.redirect('/login');
    sendPage(res, 'index.html');
  });

  /* --------------------------- Fehlerbehandlung -------------------------- */

  app.use((err, _req, res, _next) => {
    const status = err instanceof HttpError ? err.status : err.status || err.statusCode || 500;
    if (status >= 500) console.error('[error]', err);
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Die gesendeten Daten sind zu gross.' });
    }
    res.status(status).json({
      error: status >= 500 ? 'Interner Serverfehler' : err.message || 'Fehlerhafte Anfrage',
    });
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `[server] Homelab Dashboard laeuft auf http://${config.host}:${config.port} (Storage: ${store.mode})`
    );
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} empfangen - beende Dienst.`);
    server.close(async () => {
      try {
        await store.close();
      } catch {
        /* ignorieren */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] Start fehlgeschlagen:', err);
  process.exit(1);
});
