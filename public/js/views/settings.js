/* Einstellungsseite: Design, Hintergrund, Suche, Verhalten, Transparenz, Backup. */

import { api } from '../api.js';
import {
  confirmDialog,
  downloadUrl,
  esc,
  icon,
  readFileAsDataUrl,
  readFileAsText,
  toast,
} from '../util.js';
import { loadBookmarks, loadSettings, patchSettings, rerender, state } from '../state.js';

const MAX_BACKGROUND_BYTES = 6 * 1024 * 1024;

export function render(container) {
  const s = state.settings;
  const engines = state.searchEngines || {};

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Einstellungen</h1>
        <small class="hint">Alle Einstellungen gelten fuer das Konto "${esc(
          state.user.username
        )}" und werden sofort gespeichert.</small>
      </div>
      <button class="btn" id="resetSettings">${icon('refresh')} Auf Standard zuruecksetzen</button>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>Design</h2>
        <div class="field">
          <label>Farbschema</label>
          <div class="row">
            <button class="btn ${
              s.theme === 'light' ? 'btn-primary' : ''
            }" data-theme="light">Hell</button>
            <button class="btn ${
              s.theme === 'dark' ? 'btn-primary' : ''
            }" data-theme="dark">Dunkel</button>
          </div>
        </div>
        <div class="field">
          <label for="accent">Akzentfarbe</label>
          <div class="row">
            <input type="color" id="accent" value="${esc(s.accent)}">
            <input type="text" id="accentHex" value="${esc(
              s.accent
            )}" style="max-width:130px" spellcheck="false">
          </div>
        </div>
        <div class="field">
          <label for="dashboardTitle">Titel des Dashboards</label>
          <input type="text" id="dashboardTitle" value="${esc(s.dashboardTitle)}" maxlength="60">
        </div>
        <div class="field">
          <label>Anzeige</label>
          <label class="switch" style="margin-bottom:8px">
            <input type="checkbox" data-flag="showGreeting" ${s.showGreeting ? 'checked' : ''}>
            <span>Begruessung anzeigen</span>
          </label>
          <label class="switch" style="margin-bottom:8px">
            <input type="checkbox" data-flag="showClock" ${s.showClock ? 'checked' : ''}>
            <span>Uhr anzeigen</span>
          </label>
          <label class="switch" style="margin-bottom:8px">
            <input type="checkbox" data-flag="showTitles" ${s.showTitles ? 'checked' : ''}>
            <span>Titel auf den Kacheln</span>
          </label>
          <label class="switch" style="margin-bottom:8px">
            <input type="checkbox" data-flag="showDescriptions" ${
              s.showDescriptions ? 'checked' : ''
            }>
            <span>Beschreibung auf den Kacheln</span>
          </label>
          <label class="switch">
            <input type="checkbox" data-flag="showTags" ${s.showTags ? 'checked' : ''}>
            <span>Tags auf den Kacheln</span>
          </label>
        </div>
      </div>

      <div class="card">
        <h2>Hintergrundbild</h2>
        <div class="field">
          <div class="row">
            <label class="btn" style="margin:0">
              ${icon('image')} Bild hochladen
              <input type="file" id="bgFile" accept="image/*" class="hidden">
            </label>
            <button class="btn" id="bgFromUrl">${icon('download')} Bild-URL verwenden</button>
            <button class="btn btn-danger" id="bgClear">${icon('close')} Entfernen</button>
          </div>
          <small class="hint">Maximal 6 MB. Das Bild wird im Benutzerprofil gespeichert.</small>
        </div>
        <div class="field">
          <div style="height:110px;border-radius:12px;border:1px solid var(--border);
                      background:${
                        s.backgroundImage
                          ? `url('${esc(s.backgroundImage)}') center/cover no-repeat`
                          : 'var(--input-bg)'
                      }">
          </div>
        </div>
        <div class="field">
          <label for="bgBlur">Weichzeichnen: <b id="bgBlurVal">${s.backgroundBlur}</b> px</label>
          <input type="range" id="bgBlur" min="0" max="30" step="1" value="${s.backgroundBlur}">
        </div>
        <div class="field">
          <label for="bgDim">Abdunkeln: <b id="bgDimVal">${s.backgroundDim}</b> %</label>
          <input type="range" id="bgDim" min="0" max="90" step="1" value="${s.backgroundDim}">
        </div>
      </div>

      <div class="card">
        <h2>Suche</h2>
        <div class="field">
          <label class="switch">
            <input type="checkbox" data-flag="searchEnabled" ${s.searchEnabled ? 'checked' : ''}>
            <span>Suchfunktion auf dem Dashboard anzeigen</span>
          </label>
        </div>
        <div class="field">
          <label for="searchEngine">Suchmaschine</label>
          <select id="searchEngine">
            ${Object.entries(engines)
              .map(
                ([key, engine]) =>
                  `<option value="${esc(key)}" ${
                    s.searchEngine === key ? 'selected' : ''
                  }>${esc(engine.label)}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="field ${s.searchEngine === 'custom' ? '' : 'hidden'}" id="customSearchField">
          <label for="searchCustomUrl">Eigene Such-URL (Platzhalter <code>{query}</code>)</label>
          <input type="text" id="searchCustomUrl" value="${esc(s.searchCustomUrl)}"
                 placeholder="https://suche.example.com/?q={query}" spellcheck="false">
        </div>
        <div class="field">
          <label for="searchTarget">Websuche oeffnen in</label>
          <select id="searchTarget">
            <option value="new" ${s.searchTarget === 'new' ? 'selected' : ''}>Neuem Tab</option>
            <option value="same" ${
              s.searchTarget === 'same' ? 'selected' : ''
            }>Gleichem Tab</option>
          </select>
        </div>
      </div>

      <div class="card">
        <h2>Verhalten &amp; Darstellung</h2>
        <div class="field">
          <label for="openIn">Angeklicktes Lesezeichen oeffnen in</label>
          <select id="openIn">
            <option value="new" ${s.openIn === 'new' ? 'selected' : ''}>Neuem Tab</option>
            <option value="same" ${s.openIn === 'same' ? 'selected' : ''}>Gleichem Tab</option>
          </select>
        </div>
        <div class="field">
          <label for="layout">Anordnung der Kacheln</label>
          <select id="layout">
            <option value="grid" ${s.layout === 'grid' ? 'selected' : ''}>Raster</option>
            <option value="free" ${
              s.layout === 'free' ? 'selected' : ''
            }>Frei im Raum (verschiebbar)</option>
          </select>
        </div>
        <div class="field">
          <label for="tileSize">Kachelgroesse</label>
          <select id="tileSize">
            <option value="small" ${s.tileSize === 'small' ? 'selected' : ''}>Klein</option>
            <option value="medium" ${s.tileSize === 'medium' ? 'selected' : ''}>Mittel</option>
            <option value="large" ${s.tileSize === 'large' ? 'selected' : ''}>Gross</option>
          </select>
        </div>
        <div class="field">
          <label for="frameOpacity">
            Deckkraft des Inhaltsrahmens: <b id="frameOpacityVal">${s.frameOpacity}</b> %
          </label>
          <input type="range" id="frameOpacity" min="0" max="100" step="1"
                 value="${s.frameOpacity}">
          <small class="hint">0 % = vollstaendig transparent (Hintergrundbild komplett sichtbar).</small>
        </div>
        <div class="field">
          <label for="frameBlur">Milchglas-Effekt: <b id="frameBlurVal">${s.frameBlur}</b> px</label>
          <input type="range" id="frameBlur" min="0" max="30" step="1" value="${s.frameBlur}">
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Export &amp; Sicherung</h2>
      <p>
        Der Export enthaelt die eigenen Lesezeichen und Einstellungen als JSON-Datei und
        kann nach einer Neuinstallation wieder eingelesen werden.
      </p>
      <div class="row">
        <button class="btn" id="exportMine">${icon(
          'download'
        )} Eigene Daten exportieren</button>
        ${
          state.user.role === 'admin'
            ? `<button class="btn btn-primary" id="exportAll">${icon(
                'shield'
              )} Vollsicherung (alle Benutzer)</button>
               <label class="btn btn-danger" style="margin:0">
                 ${icon('upload')} Vollsicherung wiederherstellen
                 <input type="file" id="importAll" accept="application/json,.json" class="hidden">
               </label>`
            : ''
        }
      </div>
      ${
        state.user.role === 'admin'
          ? `<div class="notice notice-warn" style="margin-top:14px">
               Die Wiederherstellung ersetzt <b>alle</b> Benutzer, Lesezeichen und Einstellungen
               und meldet dich anschliessend ab.
             </div>`
          : ''
      }
    </div>

    <div class="card">
      <h2>Als Startseite verwenden</h2>
      <p>
        Diese Adresse im Browser als Startseite bzw. Seite fuer neue Tabs eintragen:
        <code id="startUrl">${esc(window.location.origin)}</code>
      </p>
      <button class="btn btn-sm" id="copyUrl">Adresse kopieren</button>
    </div>

    <p class="hint" style="text-align:center;margin-top:18px">
      Homelab Dashboard${state.version ? ` v${esc(state.version)}` : ''}
    </p>`;

  wire(container);
}

function wire(container) {
  const bind = (selector, event, handler) => {
    const node = container.querySelector(selector);
    if (node) node.addEventListener(event, handler);
  };

  container.querySelectorAll('[data-theme]').forEach((button) => {
    button.addEventListener('click', async () => {
      await patchSettings({ theme: button.dataset.theme }, { immediate: true });
      rerender();
    });
  });

  container.querySelectorAll('[data-flag]').forEach((input) => {
    input.addEventListener('change', () => {
      patchSettings({ [input.dataset.flag]: input.checked });
    });
  });

  bind('#accent', 'input', (e) => {
    patchSettings({ accent: e.target.value });
    const hex = container.querySelector('#accentHex');
    if (hex) hex.value = e.target.value;
  });
  bind('#accentHex', 'change', (e) => {
    patchSettings({ accent: e.target.value });
    const picker = container.querySelector('#accent');
    if (picker && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) picker.value = e.target.value;
  });

  bind('#dashboardTitle', 'input', (e) => patchSettings({ dashboardTitle: e.target.value }));

  /* --------------------------- Hintergrundbild -------------------------- */

  bind('#bgFile', 'change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file, MAX_BACKGROUND_BYTES);
      await patchSettings({ backgroundImage: dataUrl }, { immediate: true });
      toast('Hintergrundbild gespeichert.', 'success');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });

  bind('#bgFromUrl', 'click', async () => {
    const url = window.prompt('Adresse des Hintergrundbildes (http/https):', '');
    if (!url) return;
    try {
      await patchSettings({ backgroundImage: url.trim() }, { immediate: true });
      toast('Hintergrundbild gesetzt.', 'success');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  bind('#bgClear', 'click', async () => {
    await patchSettings({ backgroundImage: '' }, { immediate: true });
    rerender();
  });

  const slider = (id, key, valueId, suffix) => {
    bind(`#${id}`, 'input', (e) => {
      const value = Number(e.target.value);
      const label = container.querySelector(`#${valueId}`);
      if (label) label.textContent = String(value);
      patchSettings({ [key]: value });
      if (suffix) {
        /* nur Anzeige */
      }
    });
  };

  slider('bgBlur', 'backgroundBlur', 'bgBlurVal');
  slider('bgDim', 'backgroundDim', 'bgDimVal');
  slider('frameOpacity', 'frameOpacity', 'frameOpacityVal');
  slider('frameBlur', 'frameBlur', 'frameBlurVal');

  /* -------------------------------- Suche ------------------------------- */

  bind('#searchEngine', 'change', (e) => {
    patchSettings({ searchEngine: e.target.value });
    const custom = container.querySelector('#customSearchField');
    if (custom) custom.classList.toggle('hidden', e.target.value !== 'custom');
  });
  bind('#searchCustomUrl', 'input', (e) => patchSettings({ searchCustomUrl: e.target.value }));
  bind('#searchTarget', 'change', (e) => patchSettings({ searchTarget: e.target.value }));

  /* ------------------------------ Verhalten ----------------------------- */

  bind('#openIn', 'change', (e) => patchSettings({ openIn: e.target.value }));
  bind('#layout', 'change', (e) => patchSettings({ layout: e.target.value }));
  bind('#tileSize', 'change', (e) => patchSettings({ tileSize: e.target.value }));

  /* --------------------------- Export / Import -------------------------- */

  bind('#exportMine', 'click', () => downloadUrl('/api/backup/export/me'));
  bind('#exportAll', 'click', () => downloadUrl('/api/backup/export'));

  bind('#importAll', 'change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await readFileAsText(file));
      const ok = await confirmDialog({
        title: 'Vollsicherung wiederherstellen',
        message:
          'Alle aktuellen Benutzer, Lesezeichen und Einstellungen werden ersetzt. Fortfahren?',
        confirmText: 'Wiederherstellen',
        danger: true,
      });
      if (!ok) return;
      const result = await api.importBackup(payload);
      toast(result.message || 'Wiederhergestellt.', 'success');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });

  /* ------------------------------ Diverses ------------------------------ */

  bind('#resetSettings', 'click', async () => {
    const ok = await confirmDialog({
      title: 'Einstellungen zuruecksetzen',
      message: 'Alle Design- und Verhaltenseinstellungen auf Standard setzen?',
      confirmText: 'Zuruecksetzen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.resetSettings();
      await loadSettings();
      await loadBookmarks();
      toast('Einstellungen zurueckgesetzt.', 'success');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  bind('#copyUrl', 'click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      toast('Adresse kopiert.', 'success');
    } catch {
      toast('Kopieren nicht moeglich - Adresse bitte manuell uebernehmen.', 'error');
    }
  });
}
