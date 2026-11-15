/* Zentraler Anwendungszustand samt Aktionen. */

import { api } from './api.js';
import { debounce, esc, initialOf, readableTextColor, tagsToArray, toast } from './util.js';

export const state = {
  user: null,
  settings: {},
  defaults: {},
  searchEngines: {},
  tileColors: [],
  version: '',
  bookmarks: [],
  view: 'home',
  arrangeMode: false,
  tagFilter: '',
  query: '',
  editingId: null,
};

/* ------------------------------ Navigation ----------------------------- */

export function navigate(view) {
  if (window.location.hash !== `#/${view}`) {
    window.location.hash = `#/${view}`;
  } else {
    window.dispatchEvent(new CustomEvent('hd:render'));
  }
}

export function rerender() {
  window.dispatchEvent(new CustomEvent('hd:render'));
}

/* ------------------------------- Laden --------------------------------- */

export async function loadSession() {
  const { user } = await api.me();
  state.user = user;
  return user;
}

export async function loadSettings() {
  const data = await api.getSettings();
  state.settings = data.settings;
  state.defaults = data.defaults;
  state.searchEngines = data.searchEngines;
  state.tileColors = data.tileColors;
  state.version = data.version || '';
  applySettings(state.settings);
  return state.settings;
}

export async function loadBookmarks() {
  const { bookmarks } = await api.listBookmarks();
  state.bookmarks = bookmarks;
  return bookmarks;
}

/* --------------------------- Darstellung ------------------------------- */

/** Uebertraegt die Einstellungen in CSS-Variablen und Theme-Attribute. */
export function applySettings(settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  root.style.setProperty('--accent', settings.accent || '#38bdf8');
  root.style.setProperty('--frame-alpha', String((Number(settings.frameOpacity) || 0) / 100));
  root.style.setProperty('--frame-blur', `${Number(settings.frameBlur) || 0}px`);
  root.style.setProperty('--bg-blur', `${Number(settings.backgroundBlur) || 0}px`);
  root.style.setProperty('--bg-dim', String((Number(settings.backgroundDim) || 0) / 100));

  const layer = document.getElementById('bgLayer');
  if (layer) {
    layer.style.backgroundImage = settings.backgroundImage
      ? `url("${String(settings.backgroundImage).replace(/"/g, '%22')}")`
      : '';
  }

  document.body.classList.toggle('frame-hidden', Number(settings.frameOpacity) <= 2);
  document.body.classList.remove('tile-size-small', 'tile-size-medium', 'tile-size-large');
  document.body.classList.add(`tile-size-${settings.tileSize || 'medium'}`);
}

/* --------------------------- Einstellungen ----------------------------- */

const pushSettings = debounce(async () => {
  try {
    const { settings } = await api.saveSettings(state.settings);
    state.settings = settings;
    applySettings(settings);
  } catch (err) {
    toast(err.message, 'error');
  }
}, 350);

/** Einstellung sofort anwenden und verzoegert speichern. */
export function patchSettings(partial, { immediate = false } = {}) {
  state.settings = { ...state.settings, ...partial };
  applySettings(state.settings);
  if (immediate) return savePatchNow(partial);
  pushSettings();
  return Promise.resolve(state.settings);
}

async function savePatchNow() {
  const { settings } = await api.saveSettings(state.settings);
  state.settings = settings;
  applySettings(settings);
  return settings;
}

/* ----------------------------- Lesezeichen ----------------------------- */

export function canEdit(bookmark) {
  if (!state.user) return false;
  return bookmark.userId === state.user.id || state.user.role === 'admin';
}

export function ownBookmarks() {
  if (!state.user) return [];
  return state.bookmarks.filter((b) => b.userId === state.user.id);
}

export function allTags() {
  const set = new Set();
  for (const bookmark of state.bookmarks) {
    for (const tag of tagsToArray(bookmark.tags)) set.add(tag);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
}

export function visibleBookmarks() {
  const query = state.query.trim().toLowerCase();
  return state.bookmarks.filter((bookmark) => {
    if (!bookmark.enabled) return false;
    if (state.tagFilter && !tagsToArray(bookmark.tags).includes(state.tagFilter)) return false;
    if (!query) return true;
    return (
      bookmark.title.toLowerCase().includes(query) ||
      bookmark.url.toLowerCase().includes(query) ||
      bookmark.tags.toLowerCase().includes(query) ||
      bookmark.description.toLowerCase().includes(query)
    );
  });
}

/* --------------------------- Kachel-Markup ----------------------------- */

/**
 * Baut das Markup einer Lesezeichen-Kachel.
 * Wird sowohl auf dem Dashboard als auch in der Vorschau verwendet.
 */
export function tileMarkup(bookmark, settings = state.settings, options = {}) {
  const color = bookmark.color || '#1e293b';
  const textColor = bookmark.textColor || readableTextColor(color);
  const showTitle = settings.showTitles !== false;
  const showDesc = Boolean(settings.showDescriptions) && bookmark.description;
  const showTags = settings.showTags !== false && bookmark.tags;

  const iconHtml = bookmark.icon
    ? `<img class="tile-icon" src="${esc(bookmark.icon)}" alt="">`
    : `<div class="tile-initial">${esc(initialOf(bookmark.title))}</div>`;

  const tagsHtml = showTags
    ? `<div class="tile-tags">${tagsToArray(bookmark.tags)
        .slice(0, 3)
        .map((tag) => `<span>${esc(tag)}</span>`)
        .join('')}</div>`
    : '';

  const sharedHtml =
    bookmark.shared && bookmark.userId !== (state.user && state.user.id)
      ? `<span class="tile-shared">geteilt</span>`
      : '';

  const inner = `
    ${sharedHtml}
    ${iconHtml}
    <div class="tile-body">
      ${showTitle ? `<div class="tile-title">${esc(bookmark.title)}</div>` : ''}
      ${showDesc ? `<div class="tile-desc">${esc(bookmark.description)}</div>` : ''}
    </div>
    ${tagsHtml}`;

  const style = `background:${esc(color)};color:${esc(textColor)}`;

  if (options.static) {
    return `<div class="tile" style="${style}">${inner}</div>`;
  }

  const target = settings.openIn === 'same' ? '_self' : '_blank';
  const position =
    settings.layout === 'free' && bookmark.posX !== null && bookmark.posY !== null
      ? `left:${bookmark.posX}%;top:${bookmark.posY}%;`
      : '';

  return `<a class="tile" href="${esc(bookmark.url)}" target="${target}" rel="noopener noreferrer"
     data-id="${bookmark.id}" title="${esc(bookmark.title)} - ${esc(bookmark.url)}"
     style="${position}${style}">${inner}</a>`;
}

/* ------------------------------- Suche --------------------------------- */

export function searchUrlFor(query) {
  const engineKey = state.settings.searchEngine || 'duckduckgo';
  const engine = state.searchEngines[engineKey];
  const template =
    engineKey === 'custom'
      ? state.settings.searchCustomUrl || ''
      : (engine && engine.url) || '';
  if (!template) return '';
  if (template.includes('{query}')) {
    return template.replace('{query}', encodeURIComponent(query));
  }
  return template + encodeURIComponent(query);
}
