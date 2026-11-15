'use strict';

/** Standard-Einstellungen eines Benutzers. */
const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark' | 'light'
  accent: '#38bdf8',
  backgroundImage: '', // Data-URL oder externe URL
  backgroundBlur: 0, // 0-20 px
  backgroundDim: 35, // 0-90 %
  searchEnabled: true,
  searchEngine: 'duckduckgo',
  searchCustomUrl: '', // Platzhalter {query}
  searchTarget: 'new', // 'same' | 'new'
  openIn: 'new', // Verhalten beim Klick auf ein Lesezeichen
  layout: 'grid', // 'grid' | 'free'
  frameOpacity: 82, // Transparenz des Body-Frames in %
  frameBlur: 12,
  tileSize: 'medium', // 'small' | 'medium' | 'large'
  showTitles: true,
  showDescriptions: false,
  showTags: true,
  showGreeting: true,
  showClock: true,
  dashboardTitle: 'Homelab',
};

/** Vorkonfigurierte Suchmaschinen (custom = eigene URL). */
const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
  google: { label: 'Google', url: 'https://www.google.com/search?q={query}' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  startpage: {
    label: 'Startpage',
    url: 'https://www.startpage.com/sp/search?query={query}',
  },
  brave: { label: 'Brave', url: 'https://search.brave.com/search?q={query}' },
  ecosia: { label: 'Ecosia', url: 'https://www.ecosia.org/search?q={query}' },
  wikipedia: {
    label: 'Wikipedia (DE)',
    url: 'https://de.wikipedia.org/w/index.php?search={query}',
  },
  custom: { label: 'Eigene Suchmaschine', url: '' },
};

const TILE_COLORS = [
  '#0ea5e9',
  '#38bdf8',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
  '#64748b',
  '#1e293b',
];

module.exports = { DEFAULT_SETTINGS, SEARCH_ENGINES, TILE_COLORS };
