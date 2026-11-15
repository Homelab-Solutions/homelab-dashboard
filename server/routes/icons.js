'use strict';

const express = require('express');
const auth = require('./../auth');
const { HttpError, normalizeTargetUrl } = require('./../validate');

const PAGE_TIMEOUT_MS = 7000;
const IMAGE_TIMEOUT_MS = 7000;
const MAX_PAGE_BYTES = 768 * 1024;
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_CANDIDATES = 8;
const MAX_RESULTS = 4;
const USER_AGENT =
  'Mozilla/5.0 (compatible; HomelabDashboard/1.0; +http://localhost) IconFetcher';

/** Antwort mit Byte-Limit einlesen. */
async function readLimited(response, maxBytes) {
  const buffers = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new HttpError(413, 'Die Antwort ist zu gross.');
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

async function httpGet(url, timeoutMs, maxBytes, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
    });
    if (!response.ok || !response.body) {
      throw new HttpError(502, `Antwort ${response.status} von ${url}`);
    }
    const body = await readLimited(response, maxBytes);
    return {
      body,
      contentType: (response.headers.get('content-type') || '').split(';')[0].trim(),
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

function guessMime(url, contentType) {
  if (contentType && contentType.startsWith('image/')) return contentType;
  const ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
  return IMAGE_MIME[ext] || '';
}

/** Icon-Kandidaten aus dem HTML-Kopf sammeln (ohne Parser-Abhaengigkeit). */
function extractCandidates(html, baseUrl) {
  const found = [];
  const push = (href, weight, rel) => {
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl).toString();
      if (!/^https?:/i.test(abs)) return;
      if (found.some((c) => c.url === abs)) return;
      found.push({ url: abs, weight, rel });
    } catch {
      /* ungueltige URL ignorieren */
    }
  };

  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const relMatch = tag.match(/\brel\s*=\s*["']?([^"'>]+)/i);
    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)/i);
    if (!relMatch || !hrefMatch) continue;
    const rel = relMatch[1].toLowerCase();
    if (!/icon/.test(rel)) continue;

    const sizes = (tag.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1];
    let weight = Number(sizes) || 0;
    if (rel.includes('apple-touch-icon')) weight += 180;
    if (rel.includes('mask-icon')) weight -= 50;
    push(hrefMatch[1], weight, rel);
  }

  // Open-Graph-Bild als optische Alternative
  const og = html.match(
    /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)/i
  );
  if (og) push(og[1], -10, 'og:image');

  found.sort((a, b) => b.weight - a.weight);
  return found.slice(0, MAX_CANDIDATES);
}

function createRouter() {
  const router = express.Router();
  router.use(auth.requireAuth);

  /**
   * Ermittelt Icons zu einer Adresse: zuerst die im HTML deklarierten,
   * danach die Standardpfade /favicon.ico und /apple-touch-icon.png.
   */
  router.post('/fetch', async (req, res, next) => {
    try {
      const target = normalizeTargetUrl(req.body && req.body.url);
      const origin = new URL(target).origin;
      const notes = [];
      let candidates = [];

      try {
        const page = await httpGet(
          target,
          PAGE_TIMEOUT_MS,
          MAX_PAGE_BYTES,
          'text/html,application/xhtml+xml'
        );
        const html = page.body.toString('utf8');
        candidates = extractCandidates(html, page.finalUrl);
        const titleMatch = html.match(/<title[^>]*>([^<]{1,160})<\/title>/i);
        if (titleMatch) notes.push(titleMatch[1].trim());
      } catch (err) {
        notes.push(`Seite nicht lesbar (${err.message})`);
      }

      for (const fallback of ['/favicon.ico', '/apple-touch-icon.png', '/favicon.png']) {
        const abs = `${origin}${fallback}`;
        if (!candidates.some((c) => c.url === abs)) {
          candidates.push({ url: abs, weight: -100, rel: 'fallback' });
        }
      }

      const icons = [];
      for (const candidate of candidates) {
        if (icons.length >= MAX_RESULTS) break;
        try {
          const image = await httpGet(candidate.url, IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES, 'image/*');
          if (!image.body.length) continue;
          const mime = guessMime(candidate.url, image.contentType);
          if (!mime) continue;
          icons.push({
            source: candidate.url,
            rel: candidate.rel,
            dataUrl: `data:${mime};base64,${image.body.toString('base64')}`,
            bytes: image.body.length,
          });
        } catch {
          /* Kandidat nicht abrufbar - naechster Versuch */
        }
      }

      if (!icons.length) {
        return res.status(404).json({
          error:
            'Es konnte kein Bild gefunden werden. Bitte ein Bild manuell hochladen oder eine Bild-URL angeben.',
          title: notes[0] || '',
          notes,
        });
      }

      res.json({ icons, title: notes[0] || '', notes });
    } catch (err) {
      next(err);
    }
  });

  /** Ein einzelnes Bild von einer URL holen und als Data-URL zurueckgeben. */
  router.post('/download', async (req, res, next) => {
    try {
      const url = normalizeTargetUrl(req.body && req.body.url);
      const image = await httpGet(url, IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES, 'image/*');
      const mime = guessMime(url, image.contentType);
      if (!mime) throw new HttpError(415, 'Die Adresse liefert kein Bild.');
      res.json({
        icon: {
          source: url,
          dataUrl: `data:${mime};base64,${image.body.toString('base64')}`,
          bytes: image.body.length,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRouter };
