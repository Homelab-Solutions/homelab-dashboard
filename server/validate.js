'use strict';

const { DEFAULT_SETTINGS, SEARCH_ENGINES } = require('./defaults');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function str(value, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).slice(0, max).trim();
}

function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function num(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(value, fallback = '') {
  const v = str(value, 16);
  if (!v) return fallback;
  const withHash = v.startsWith('#') ? v : `#${v}`;
  if (!HEX_RE.test(withHash)) return fallback;
  if (withHash.length === 4) {
    // #abc -> #aabbcc
    return (
      '#' +
      withHash
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
    ).toLowerCase();
  }
  return withHash.toLowerCase();
}

/** Erlaubt http/https sowie Data-URLs fuer hochgeladene Bilder. */
function normalizeImage(value, maxBytes, field) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return '';
  if (v.startsWith('data:image/')) {
    if (Buffer.byteLength(v, 'utf8') > maxBytes) {
      throw new HttpError(
        413,
        `${field} ist zu gross (max. ${Math.round(maxBytes / 1024)} KB).`
      );
    }
    return v;
  }
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v.slice(0, 2048);
  throw new HttpError(400, `${field}: nur http(s)-Adressen oder Bild-Uploads erlaubt.`);
}

/** URL eines Lesezeichens - ohne Schema wird https:// ergaenzt. */
function normalizeTargetUrl(value) {
  let v = str(value, 2048);
  if (!v) throw new HttpError(400, 'Die URL darf nicht leer sein.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  let parsed;
  try {
    parsed = new URL(v);
  } catch {
    throw new HttpError(400, 'Die URL ist ungueltig.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(400, 'Es sind nur http- und https-Adressen erlaubt.');
  }
  return parsed.toString();
}

function normalizeTags(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(',');
  return list
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => t.slice(0, 32))
    .join(', ')
    .slice(0, 255);
}

function normalizeBookmark(input = {}) {
  const title = str(input.title, 120);
  if (!title) throw new HttpError(400, 'Der Titel darf nicht leer sein.');
  return {
    title,
    url: normalizeTargetUrl(input.url),
    description: str(input.description, 2000),
    tags: normalizeTags(input.tags),
    icon: normalizeImage(input.icon, config.limits.iconBytes, 'Das Icon'),
    color: normalizeHex(input.color, '#1e293b'),
    text_color: normalizeHex(input.text_color, '#ffffff'),
    enabled: bool(input.enabled, true) ? 1 : 0,
    shared: bool(input.shared, false) ? 1 : 0,
    pos_x: input.pos_x === null || input.pos_x === undefined ? null : num(input.pos_x, 0, 100, 0),
    pos_y: input.pos_y === null || input.pos_y === undefined ? null : num(input.pos_y, 0, 100, 0),
  };
}

function normalizeSettings(input = {}) {
  const base = { ...DEFAULT_SETTINGS };
  const engine = str(input.searchEngine, 32).toLowerCase();

  return {
    ...base,
    theme: input.theme === 'light' ? 'light' : 'dark',
    accent: normalizeHex(input.accent, base.accent),
    backgroundImage: normalizeImage(
      input.backgroundImage,
      config.limits.backgroundBytes,
      'Das Hintergrundbild'
    ),
    backgroundBlur: num(input.backgroundBlur, 0, 30, base.backgroundBlur),
    backgroundDim: num(input.backgroundDim, 0, 90, base.backgroundDim),
    searchEnabled: bool(input.searchEnabled, base.searchEnabled),
    searchEngine: SEARCH_ENGINES[engine] ? engine : base.searchEngine,
    searchCustomUrl: str(input.searchCustomUrl, 512),
    searchTarget: input.searchTarget === 'same' ? 'same' : 'new',
    openIn: input.openIn === 'same' ? 'same' : 'new',
    layout: input.layout === 'free' ? 'free' : 'grid',
    frameOpacity: num(input.frameOpacity, 0, 100, base.frameOpacity),
    frameBlur: num(input.frameBlur, 0, 30, base.frameBlur),
    tileSize: ['small', 'medium', 'large'].includes(input.tileSize)
      ? input.tileSize
      : base.tileSize,
    showTitles: bool(input.showTitles, base.showTitles),
    showDescriptions: bool(input.showDescriptions, base.showDescriptions),
    showTags: bool(input.showTags, base.showTags),
    showGreeting: bool(input.showGreeting, base.showGreeting),
    showClock: bool(input.showClock, base.showClock),
    dashboardTitle: str(input.dashboardTitle, 60) || base.dashboardTitle,
  };
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

function normalizeUsername(value) {
  const v = str(value, 32).toLowerCase();
  if (!USERNAME_RE.test(v)) {
    throw new HttpError(
      400,
      'Benutzername: 3-32 Zeichen, erlaubt sind Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich.'
    );
  }
  return v;
}

function checkPassword(value) {
  const v = typeof value === 'string' ? value : '';
  if (v.length < 6) {
    throw new HttpError(400, 'Das Passwort muss mindestens 6 Zeichen lang sein.');
  }
  if (v.length > 200) throw new HttpError(400, 'Das Passwort ist zu lang.');
  return v;
}

module.exports = {
  HttpError,
  normalizeBookmark,
  normalizeSettings,
  normalizeUsername,
  normalizeImage,
  normalizeHex,
  normalizeTargetUrl,
  checkPassword,
  str,
  bool,
  num,
};
