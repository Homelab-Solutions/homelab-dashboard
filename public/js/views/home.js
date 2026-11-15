/* Hauptseite: Kachelraster, Suche, freie Anordnung. */

import { api } from '../api.js';
import { debounce, esc, icon, toast } from '../util.js';
import {
  allTags,
  loadBookmarks,
  patchSettings,
  rerender,
  searchUrlFor,
  state,
  tileMarkup,
  visibleBookmarks,
} from '../state.js';
import {
  FREE_LAYOUT_MIN_WIDTH,
  TILE_GAP,
  fitsFreeLayout,
  rectsOverlap,
} from '../freeLayout.js';

let dragEnabled = false;
let clockTimer = null;
let freeLayoutObserver = null;

/** Aktueller Darstellungsmodus der freien Anordnung (nur gueltig, solange
 *  settings.layout === 'free'): true = gespeichertes Freiform-Layout wird
 *  exakt angezeigt, false = Raster-Fallback ist aktiv. Wird von applyFreeLayout
 *  gepflegt und von wire() gelesen, um Drag & Drop nur im Freiform-Modus
 *  zuzulassen. */
let freeLayoutIsFree = true;

/** Haelt die Hysterese fuer den Moduswechsel zwischen zwei Resize-Messungen
 *  fest, damit am Fensterrand nicht zwischen Frei und Raster geflackert wird
 *  (siehe decideFreeLayoutMode). Wird bei jedem setupFreeLayout zurueckgesetzt. */
let freeLayoutModeState = createModeState();

const LAYOUT_HINT_STORAGE_KEY = 'hd:freeLayoutHintDismissed';
const FREE_LAYOUT_RESIZE_DEBOUNCE_MS = 100;
/** Ab dieser Breitenaenderung (px) gegenueber dem letzten Moduswechsel wird ein
 *  abweichendes Messergebnis sofort uebernommen, ohne auf eine zweite
 *  Bestaetigung zu warten (siehe decideFreeLayoutMode). */
const FREE_LAYOUT_HYSTERESIS_PX = 16;

/** Entspricht dem Breakpoint in app.css, ab dem das Raster erzwungen wird. */
function isCompactViewport() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function createModeState() {
  return { mode: null, pendingMode: null, pendingCount: 0, lastSwitchWidth: null };
}

/**
 * Entscheidet, ob fuer die aktuelle Messung (fits) der Freiform-Modus aktiv
 * sein soll, mit Hysterese gegen Flackern beim Ziehen am Fensterrand: ein vom
 * aktuellen Modus abweichendes Ergebnis wird erst uebernommen, wenn es sich
 * ueber zwei aufeinanderfolgende Messungen bestaetigt ODER sich die Breite seit
 * dem letzten Wechsel um mindestens FREE_LAYOUT_HYSTERESIS_PX geaendert hat.
 */
function decideFreeLayoutMode(fits, width) {
  const modeState = freeLayoutModeState;
  if (modeState.mode === null) {
    modeState.mode = fits;
    modeState.lastSwitchWidth = width;
    return modeState.mode;
  }
  if (fits === modeState.mode) {
    modeState.pendingMode = null;
    modeState.pendingCount = 0;
    return modeState.mode;
  }

  const widthDelta =
    modeState.lastSwitchWidth === null ? Infinity : Math.abs(width - modeState.lastSwitchWidth);
  if (widthDelta >= FREE_LAYOUT_HYSTERESIS_PX) {
    modeState.mode = fits;
    modeState.lastSwitchWidth = width;
    modeState.pendingMode = null;
    modeState.pendingCount = 0;
    return modeState.mode;
  }

  if (modeState.pendingMode === fits) {
    modeState.pendingCount += 1;
  } else {
    modeState.pendingMode = fits;
    modeState.pendingCount = 1;
  }
  if (modeState.pendingCount >= 2) {
    modeState.mode = fits;
    modeState.lastSwitchWidth = width;
    modeState.pendingMode = null;
    modeState.pendingCount = 0;
  }
  return modeState.mode;
}

/** Misst die vom Stylesheet vorgegebene Mindesthoehe von .tiles.free, unabhaengig
 *  von einer evtl. bereits gesetzten eigenen Hoehen-Ueberschreibung. Das ist die
 *  stabile Referenz, auf die sich gespeicherte Y-Prozentwerte beziehen. */
function measureNominalHeight(tilesEl) {
  const previous = tilesEl.style.minHeight;
  tilesEl.style.minHeight = '';
  const height = tilesEl.getBoundingClientRect().height;
  tilesEl.style.minHeight = previous;
  return height;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Hallo';
  return 'Guten Abend';
}

function arrangePanel() {
  const settings = state.settings;
  return `
    <div class="card" id="arrangePanel">
      <div class="row">
        <div>
          <h3>Anordnung</h3>
          <small class="hint">Raster oder freie Platzierung auf dem Hintergrundbild.</small>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm ${settings.layout === 'grid' ? 'btn-primary' : ''}"
                data-layout="grid">${icon('grid')} Raster</button>
        <button class="btn btn-sm ${settings.layout === 'free' ? 'btn-primary' : ''}"
                data-layout="free">${icon('arrange')} Frei im Raum</button>
      </div>
      <div class="row" style="margin-top:14px">
        <label class="switch" title="Kacheln mit der Maus verschieben">
          <input type="checkbox" id="dragToggle" ${dragEnabled ? 'checked' : ''}
                 ${settings.layout === 'free' ? '' : 'disabled'}>
          <span>Frei verschieben (Drag &amp; Drop)</span>
        </label>
        <div class="spacer"></div>
        <label style="margin:0">Kachelgroesse</label>
        <select id="tileSizeSelect" style="width:auto">
          <option value="small" ${settings.tileSize === 'small' ? 'selected' : ''}>Klein</option>
          <option value="medium" ${settings.tileSize === 'medium' ? 'selected' : ''}>Mittel</option>
          <option value="large" ${settings.tileSize === 'large' ? 'selected' : ''}>Gross</option>
        </select>
        <button class="btn btn-sm" id="resetPositions" ${
          settings.layout === 'free' ? '' : 'disabled'
        }>${icon('refresh')} Positionen zuruecksetzen</button>
      </div>
    </div>`;
}

export function render(container) {
  const settings = state.settings;
  const bookmarks = visibleBookmarks();
  const tags = allTags();
  const free = settings.layout === 'free';

  // Freie Anordnung: fehlende Positionen sinnvoll vorbelegen
  const prepared = bookmarks.map((bookmark, index) => {
    if (!free || (bookmark.posX !== null && bookmark.posY !== null)) return bookmark;
    return {
      ...bookmark,
      posX: (index % 6) * 15.5 + 1,
      posY: Math.floor(index / 6) * 21 + 1,
    };
  });

  container.innerHTML = `
    <div class="dash-head">
      ${
        settings.showGreeting
          ? `<div class="greeting">
               <h1>${esc(greeting())}, ${esc(state.user.displayName)}</h1>
               <small class="hint">${esc(settings.dashboardTitle)} &middot; ${
                 prepared.length
               } von ${state.bookmarks.length} Anwendungen</small>
             </div>`
          : `<div class="greeting"><h1>${esc(settings.dashboardTitle)}</h1></div>`
      }
      ${
        settings.showClock
          ? `<div style="text-align:right">
               <div class="clock" id="clock"></div>
               <div class="clock-date" id="clockDate"></div>
             </div>`
          : ''
      }
    </div>

    ${
      settings.searchEnabled
        ? `<form class="searchbar" id="searchForm" autocomplete="off">
             <input type="search" id="searchInput" placeholder="Lesezeichen filtern oder im Web suchen ..."
                    value="${esc(state.query)}">
             <button class="btn btn-primary" type="submit">${icon('search')} Suchen</button>
           </form>`
        : ''
    }

    ${state.arrangeMode ? arrangePanel() : ''}

    ${
      tags.length
        ? `<div class="filterbar">
             <button class="chip ${state.tagFilter ? '' : 'active'}" data-tag="">Alle</button>
             ${tags
               .map(
                 (tag) =>
                   `<button class="chip ${
                     state.tagFilter === tag ? 'active' : ''
                   }" data-tag="${esc(tag)}">${esc(tag)}</button>`
               )
               .join('')}
           </div>`
        : ''
    }

    ${
      prepared.length
        ? `<div class="tiles ${free ? 'free' : ''} ${
            dragEnabled && free ? 'arrange' : ''
          }" id="tiles">
             ${prepared.map((bookmark) => tileMarkup(bookmark, settings)).join('')}
           </div>`
        : `<div class="empty">
             <p>Noch keine aktiven Lesezeichen vorhanden.</p>
             <button class="btn btn-primary" data-goto="apps">${icon(
               'plus'
             )} Lesezeichen anlegen</button>
           </div>`
    }`;

  if (settings.showClock) startClock(container);
  wire(container, prepared);
}

function startClock(container) {
  const clock = container.querySelector('#clock');
  const date = container.querySelector('#clockDate');
  if (!clock) return;
  const tick = () => {
    if (!clock.isConnected) {
      clearInterval(clockTimer);
      clockTimer = null;
      return;
    }
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    date.textContent = now.toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };
  tick();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tick, 15000);
}

function hintDismissedThisSession() {
  try {
    return sessionStorage.getItem(LAYOUT_HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Zeigt/entfernt den dezenten Hinweis, dass die Darstellung vom gespeicherten
 *  Layout abweicht (Kollisionsausgleich oder Raster-Fallback). */
function showLayoutHint(tilesEl, shouldShow) {
  const parent = tilesEl.parentElement;
  if (!parent) return;
  const existing = parent.querySelector('#layoutHint');
  // Auf Phone/Tablet aendert sich am bestehenden Raster-Verhalten nichts -
  // dort gab es den Hinweis bisher nicht und er bleibt auch jetzt aus.
  if (!shouldShow || isCompactViewport() || hintDismissedThisSession()) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const hint = document.createElement('div');
  hint.className = 'layout-hint';
  hint.id = 'layoutHint';
  hint.innerHTML = `
    <span>Fenster zu klein f&uuml;r die freie Anordnung &ndash; Raster-Ansicht aktiv. Gespeicherte Anordnung bleibt unver&auml;ndert.</span>
    <div class="spacer"></div>
    <button type="button" aria-label="Hinweis schliessen">${icon('close', 14)}</button>`;
  hint.querySelector('button').addEventListener('click', () => {
    try {
      sessionStorage.setItem(LAYOUT_HINT_STORAGE_KEY, '1');
    } catch {
      /* Session-Speicher nicht verfuegbar: Hinweis wird einfach nur ausgeblendet. */
    }
    hint.remove();
  });
  tilesEl.insertAdjacentElement('afterend', hint);
}

/**
 * Alles-oder-nichts-Entscheidung fuer die freie Anordnung: passt das
 * gespeicherte Freiform-Layout (Prozentwerte aus `prepared`) bei der aktuellen
 * Containergroesse komplett kollisionsfrei und innerhalb der Grenzen, wird es
 * exakt so angezeigt wie gespeichert (die inline left/top-Prozentwerte aus
 * tileMarkup bleiben dafuer unangetastet). Sobald auch nur eine Kachel
 * ueberlappen wuerde oder ueber den Rand hinausragt, wird fuer ALLE Kacheln auf
 * das bestehende Raster (.is-compact, identisch zu Phone/Tablet) umgeschaltet -
 * keine Teilverschiebung einzelner Kacheln mehr. Die gespeicherten Positionen
 * werden dabei nie veraendert.
 */
function applyFreeLayout(tilesEl, prepared) {
  if (!tilesEl.isConnected) return;

  const containerWidth = tilesEl.clientWidth;
  // Nominale, vom Stylesheet vorgegebene Hoehe (.tiles.free min-height) - die
  // stabile Referenz, auf die sich die gespeicherten Y-Prozentwerte beziehen.
  // Es entsteht dadurch nie ein kuenstlich vergroesserter, scrollender Container.
  const containerHeight = measureNominalHeight(tilesEl);
  const tileEls = Array.from(tilesEl.querySelectorAll('.tile[data-id]'));

  let fits;
  if (!tileEls.length) {
    fits = true;
  } else if (isCompactViewport() || containerWidth < FREE_LAYOUT_MIN_WIDTH) {
    fits = false;
  } else {
    const byBookmarkId = new Map(prepared.map((b) => [b.id, b]));
    const tileSizes = {};
    const tiles = tileEls.map((el) => {
      const id = Number(el.dataset.id);
      const bookmark = byBookmarkId.get(id);
      const leftPct = bookmark && bookmark.posX !== null ? bookmark.posX : 0;
      const topPct = bookmark && bookmark.posY !== null ? bookmark.posY : 0;
      tileSizes[id] = { width: el.offsetWidth, height: el.offsetHeight };
      return {
        id,
        x: (leftPct / 100) * containerWidth,
        y: (topPct / 100) * containerHeight,
      };
    });
    fits = fitsFreeLayout(tiles, containerWidth, containerHeight, tileSizes, TILE_GAP);
  }

  const useFree = decideFreeLayoutMode(fits, containerWidth);
  freeLayoutIsFree = useFree;

  if (!useFree) {
    tilesEl.classList.add('is-compact');
    tilesEl.style.minHeight = '';
    showLayoutHint(tilesEl, true);
    return;
  }

  tilesEl.classList.remove('is-compact');
  tilesEl.style.minHeight = '';
  showLayoutHint(tilesEl, false);
}

/** Registriert Neuberechnung bei Groessenaenderung des Containers und nach dem
 *  Laden von Kachel-Icons (falls sich dadurch Kachelmasse aendern). `prepared`
 *  ist die fuer diesen Render-Durchlauf fixe Liste der Lesezeichen inkl.
 *  vorbelegter Positionen und bleibt ueber alle Neuberechnungen hinweg gleich. */
function setupFreeLayout(tilesEl, prepared) {
  if (freeLayoutObserver) {
    freeLayoutObserver.disconnect();
    freeLayoutObserver = null;
  }
  freeLayoutModeState = createModeState();

  applyFreeLayout(tilesEl, prepared);

  const recompute = debounce(() => {
    requestAnimationFrame(() => applyFreeLayout(tilesEl, prepared));
  }, FREE_LAYOUT_RESIZE_DEBOUNCE_MS);

  freeLayoutObserver = new ResizeObserver(recompute);
  freeLayoutObserver.observe(tilesEl);

  tilesEl.querySelectorAll('img').forEach((img) => {
    if (img.complete) return;
    img.addEventListener('load', recompute, { once: true });
    img.addEventListener('error', recompute, { once: true });
  });
}

function wire(container, prepared) {
  const form = container.querySelector('#searchForm');
  const input = container.querySelector('#searchInput');

  if (form) {
    // Tippen filtert die Kacheln, Enter sucht im Web, falls nichts uebrig bleibt
    input.addEventListener('input', () => {
      state.query = input.value;
      const caret = input.selectionStart;
      rerender();
      const fresh = document.querySelector('#searchInput');
      if (fresh) {
        fresh.focus();
        fresh.setSelectionRange(caret, caret);
      }
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      const matches = visibleBookmarks();
      if (matches.length === 1) {
        openBookmark(matches[0]);
        return;
      }
      const url = searchUrlFor(query);
      if (!url) {
        toast('Es ist keine Suchmaschine konfiguriert.', 'error');
        return;
      }
      if (state.settings.searchTarget === 'same') window.location.href = url;
      else window.open(url, '_blank', 'noopener');
    });
  }

  container.querySelectorAll('[data-tag]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.tagFilter = chip.dataset.tag;
      rerender();
    });
  });

  container.querySelectorAll('[data-layout]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.dataset.layout === 'grid') dragEnabled = false;
      await patchSettings({ layout: button.dataset.layout }, { immediate: true });
      rerender();
    });
  });

  const dragToggle = container.querySelector('#dragToggle');
  if (dragToggle) {
    dragToggle.addEventListener('change', () => {
      dragEnabled = dragToggle.checked;
      rerender();
    });
  }

  const tileSize = container.querySelector('#tileSizeSelect');
  if (tileSize) {
    tileSize.addEventListener('change', async () => {
      await patchSettings({ tileSize: tileSize.value }, { immediate: true });
      rerender();
    });
  }

  const resetPositions = container.querySelector('#resetPositions');
  if (resetPositions) {
    resetPositions.addEventListener('click', async () => {
      try {
        const own = state.bookmarks.filter(
          (b) => b.userId === state.user.id && (b.posX !== null || b.posY !== null)
        );
        for (const bookmark of own) {
          await api.setBookmarkPosition(bookmark.id, null, null);
        }
        await loadBookmarks();
        toast('Positionen zurueckgesetzt.', 'success');
        rerender();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  container.querySelectorAll('[data-goto]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = `#/${button.dataset.goto}`;
    });
  });

  const tiles = container.querySelector('#tiles');
  if (tiles) {
    tiles.querySelectorAll('img').forEach((img) => (img.draggable = false));
    if (state.settings.layout === 'free') {
      setupFreeLayout(tiles, prepared);
    }
    // Auf Phone/Tablet, bei zu schmalem Container oder sobald das gespeicherte
    // Layout nicht mehr kollisionsfrei passt, erzwingt das Raster; Drag & Drop
    // bleibt dann aus, damit ein Klick auf eine Kachel weiterhin den Link
    // oeffnet.
    if (dragEnabled && state.settings.layout === 'free' && freeLayoutIsFree) {
      enableDragging(tiles, prepared);
    }
  }
}

function openBookmark(bookmark) {
  if (state.settings.openIn === 'same') window.location.href = bookmark.url;
  else window.open(bookmark.url, '_blank', 'noopener');
}

/** Kacheln per Maus/Touch/Stift frei positionieren (gespeichert wird in Prozent).
 *  Blockiert, statt andere Kacheln zu ueberlagern (Vergleich gegen deren aktuell
 *  angezeigte, nicht die gespeicherten Positionen). */
function enableDragging(tiles, prepared) {
  let active = null;
  let rafId = null;
  let latestEvent = null;

  const onDown = (event) => {
    const tile = event.target.closest('.tile');
    if (!tile) return;
    const bookmark = state.bookmarks.find((b) => b.id === Number(tile.dataset.id));
    if (!bookmark || bookmark.userId !== state.user.id) {
      toast('Geteilte Lesezeichen koennen hier nicht verschoben werden.', 'error');
      return;
    }
    event.preventDefault();
    const rect = tiles.getBoundingClientRect();
    const refHeight = measureNominalHeight(tiles);
    const tileRect = tile.getBoundingClientRect();
    const others = Array.from(tiles.querySelectorAll('.tile[data-id]'))
      .filter((el) => el !== tile)
      .map((el) => ({
        x: el.offsetLeft,
        y: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      }));
    active = {
      tile,
      id: bookmark.id,
      rect,
      refHeight,
      others,
      offsetX: event.clientX - tileRect.left,
      offsetY: event.clientY - tileRect.top,
      widthPct: (tileRect.width / rect.width) * 100,
      heightPct: (tileRect.height / refHeight) * 100,
      widthPx: tileRect.width,
      heightPx: tileRect.height,
      moved: false,
    };
    tile.classList.add('dragging');
    tile.setPointerCapture(event.pointerId);
  };

  const processMove = (event) => {
    if (!active) return;
    const x = ((event.clientX - active.rect.left - active.offsetX) / active.rect.width) * 100;
    const y = ((event.clientY - active.rect.top - active.offsetY) / active.refHeight) * 100;
    const clampedX = Math.min(Math.max(x, 0), Math.max(0, 100 - active.widthPct));
    const clampedY = Math.min(Math.max(y, 0), Math.max(0, 100 - active.heightPct));

    const candidate = {
      x: (clampedX / 100) * active.rect.width,
      y: (clampedY / 100) * active.refHeight,
      width: active.widthPx,
      height: active.heightPx,
    };
    const blocked = active.others.some((other) => rectsOverlap(candidate, other, TILE_GAP));
    if (blocked) return;

    active.tile.style.left = `${clampedX}%`;
    active.tile.style.top = `${clampedY}%`;
    active.x = clampedX;
    active.y = clampedY;
    active.moved = true;
  };

  const onMove = (event) => {
    if (!active) return;
    latestEvent = event;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (latestEvent) processMove(latestEvent);
    });
  };

  const onUp = async () => {
    if (!active) return;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    latestEvent = null;
    const current = active;
    active = null;
    current.tile.classList.remove('dragging');
    if (!current.moved || current.x === undefined) return;
    try {
      const { bookmark } = await api.setBookmarkPosition(
        current.id,
        Math.round(current.x * 100) / 100,
        Math.round(current.y * 100) / 100
      );
      const index = state.bookmarks.findIndex((b) => b.id === bookmark.id);
      if (index >= 0) state.bookmarks[index] = bookmark;
      // "prepared" ist die Wahrheit fuer Neuberechnungen in diesem Render-
      // Durchlauf (siehe applyFreeLayout) - die frisch gespeicherte Position
      // muss dort ebenfalls ankommen, sonst faellt eine spaetere
      // Groessenaenderung auf die alte (oder vorbelegte) Position zurueck.
      const preparedEntry = prepared.find((b) => b.id === bookmark.id);
      if (preparedEntry) {
        preparedEntry.posX = bookmark.posX;
        preparedEntry.posY = bookmark.posY;
      }
      applyFreeLayout(tiles, prepared);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  tiles.addEventListener('pointerdown', onDown);
  tiles.addEventListener('pointermove', onMove);
  tiles.addEventListener('pointerup', onUp);
  tiles.addEventListener('pointercancel', onUp);
  // Im Verschiebe-Modus sollen Klicks die Seite nicht oeffnen
  tiles.addEventListener('click', (event) => {
    if (event.target.closest('.tile')) event.preventDefault();
  });
}
