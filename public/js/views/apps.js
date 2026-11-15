/* Anwendungsliste: Lesezeichen anlegen, bearbeiten, loeschen, sortieren. */

import { api } from '../api.js';
import {
  confirmDialog,
  downloadUrl,
  esc,
  hostOf,
  icon,
  initialOf,
  readFileAsDataUrl,
  readFileAsText,
  readableTextColor,
  tagsToArray,
  toast,
} from '../util.js';
import { canEdit, loadBookmarks, rerender, state, tileMarkup } from '../state.js';

const MAX_ICON_BYTES = 1024 * 1024;

let draft = null;
let iconCandidates = [];
let busy = false;

function emptyDraft() {
  return {
    id: null,
    title: '',
    url: '',
    description: '',
    tags: '',
    icon: '',
    color: '#1e293b',
    textColor: '',
    enabled: true,
    shared: false,
  };
}

export function startNew() {
  draft = emptyDraft();
  iconCandidates = [];
  state.editingId = 'new';
}

function startEdit(bookmark) {
  draft = {
    id: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    description: bookmark.description,
    tags: bookmark.tags,
    icon: bookmark.icon,
    color: bookmark.color,
    textColor: bookmark.textColor,
    enabled: bookmark.enabled,
    shared: bookmark.shared,
  };
  iconCandidates = [];
  state.editingId = bookmark.id;
}

function cancelEdit() {
  draft = null;
  iconCandidates = [];
  state.editingId = null;
}

/* ------------------------------- Vorschau ------------------------------ */

function previewBookmark() {
  return {
    id: 0,
    userId: state.user.id,
    title: draft.title || 'Neues Lesezeichen',
    url: draft.url || 'https://',
    description: draft.description,
    tags: draft.tags,
    icon: draft.icon,
    color: draft.color,
    textColor: draft.textColor || readableTextColor(draft.color),
    enabled: draft.enabled,
    shared: draft.shared,
    posX: null,
    posY: null,
  };
}

function updatePreview(container) {
  const host = container.querySelector('#previewTile');
  if (!host) return;
  host.innerHTML = tileMarkup(
    previewBookmark(),
    { ...state.settings, showDescriptions: true, showTitles: true, showTags: true },
    { static: true }
  );
  const hexField = container.querySelector('#colorHex');
  if (hexField && hexField.value.toLowerCase() !== draft.color) hexField.value = draft.color;
  const colorField = container.querySelector('#colorPicker');
  if (colorField && colorField.value.toLowerCase() !== draft.color) {
    colorField.value = draft.color;
  }
  const iconPreview = container.querySelector('#iconStatus');
  if (iconPreview) {
    iconPreview.textContent = draft.icon
      ? draft.icon.startsWith('data:')
        ? `Bild hinterlegt (${Math.round(draft.icon.length / 1024)} KB)`
        : 'Bild-Adresse hinterlegt'
      : 'Kein Bild - es wird der Anfangsbuchstabe angezeigt';
  }
}

/* ------------------------------- Editor -------------------------------- */

function editorMarkup() {
  const isNew = draft.id === null;
  return `
    <div class="editor" id="editor">
      <div class="row" style="margin-bottom:14px">
        <h2>${isNew ? 'Neues Lesezeichen' : 'Lesezeichen bearbeiten'}</h2>
        <div class="spacer"></div>
        <small class="hint">Vorschau aktualisiert sich live</small>
      </div>

      <div class="editor-preview">
        <div id="previewTile"></div>
        <div class="preview-tools">
          <div class="field">
            <label for="colorHex">Hintergrundfarbe der Kachel</label>
            <div class="row">
              <input type="color" id="colorPicker" value="${esc(draft.color)}">
              <input type="text" id="colorHex" value="${esc(
                draft.color
              )}" placeholder="#1e293b" style="max-width:130px" spellcheck="false">
              <button class="btn btn-sm" id="autoTextColor" type="button">${icon(
                'wand'
              )} Schriftfarbe automatisch</button>
            </div>
            <div class="swatches">
              ${(state.tileColors || [])
                .map(
                  (color) =>
                    `<button type="button" class="swatch ${
                      color.toLowerCase() === draft.color ? 'selected' : ''
                    }" style="background:${esc(color)}" data-color="${esc(
                      color
                    )}" title="${esc(color)}"></button>`
                )
                .join('')}
            </div>
          </div>
          <div class="field">
            <label>Bild / Icon</label>
            <div class="row">
              <button class="btn btn-sm" id="fetchIcon" type="button">${icon(
                'wand'
              )} Automatisch von Webseite</button>
              <label class="btn btn-sm" style="margin:0">
                ${icon('image')} Bild hochladen
                <input type="file" id="iconFile" accept="image/*" class="hidden">
              </label>
              <button class="btn btn-sm btn-ghost" id="iconFromUrl" type="button">${icon(
                'download'
              )} Bild-URL</button>
              <button class="btn btn-sm btn-danger" id="iconClear" type="button">${icon(
                'close'
              )} Entfernen</button>
            </div>
            <small class="hint" id="iconStatus"></small>
            <div class="icon-options" id="iconOptions"></div>
          </div>
        </div>
      </div>

      <div class="editor-cols">
        <div>
          <div class="field">
            <label for="fTitle">Titel *</label>
            <input type="text" id="fTitle" value="${esc(draft.title)}" maxlength="120"
                   placeholder="z.B. Nextcloud">
          </div>
          <div class="field">
            <label for="fUrl">URL *</label>
            <input type="text" id="fUrl" value="${esc(draft.url)}" maxlength="2048"
                   placeholder="z.B. 10.10.50.10:8080 oder https://cloud.example.com" spellcheck="false">
          </div>
          <div class="field">
            <label for="fTags">Tags (Komma getrennt)</label>
            <input type="text" id="fTags" value="${esc(draft.tags)}"
                   placeholder="z.B. Medien, Verwaltung">
          </div>
        </div>
        <div>
          <div class="field">
            <label for="fDesc">Beschreibung (intern gespeichert)</label>
            <textarea id="fDesc" maxlength="2000"
                      placeholder="Notizen zu diesem Dienst - nur fuer dich sichtbar">${esc(
                        draft.description
                      )}</textarea>
          </div>
          <div class="field">
            <label class="switch">
              <input type="checkbox" id="fEnabled" ${draft.enabled ? 'checked' : ''}>
              <span>Aktiv (auf dem Dashboard sichtbar)</span>
            </label>
          </div>
          ${
            state.user.role === 'admin'
              ? `<div class="field">
                   <label class="switch">
                     <input type="checkbox" id="fShared" ${draft.shared ? 'checked' : ''}>
                     <span>Fuer alle Benutzer freigeben</span>
                   </label>
                 </div>`
              : ''
          }
        </div>
      </div>

      <div class="editor-actions">
        <button class="btn btn-primary" id="saveBtn" type="button">${icon(
          'save'
        )} Speichern</button>
        <button class="btn" id="cancelBtn" type="button">${icon('close')} Abbrechen</button>
        <div class="spacer"></div>
        ${
          isNew
            ? ''
            : `<button class="btn btn-danger" id="deleteBtn" type="button">${icon(
                'trash'
              )} Loeschen</button>`
        }
      </div>
    </div>`;
}

/* -------------------------------- Liste -------------------------------- */

function rowMarkup(bookmark, index, total) {
  const editable = canEdit(bookmark);
  const isOwn = bookmark.userId === state.user.id;
  const badgeStyle = `background:${esc(bookmark.color || '#1e293b')};color:${esc(
    bookmark.textColor || readableTextColor(bookmark.color)
  )}`;
  return `
    <div class="list-row ${bookmark.enabled ? '' : 'is-disabled'}" data-id="${bookmark.id}">
      <div class="order-btns">
        ${
          isOwn
            ? `<button type="button" data-act="up" title="Nach oben" ${
                index === 0 ? 'disabled' : ''
              }>&#9650;</button>
               <button type="button" data-act="down" title="Nach unten" ${
                 index === total - 1 ? 'disabled' : ''
               }>&#9660;</button>`
            : ''
        }
      </div>
      <div class="list-badge" style="${badgeStyle}">
        ${
          bookmark.icon
            ? `<img src="${esc(bookmark.icon)}" alt="">`
            : esc(initialOf(bookmark.title))
        }
      </div>
      <div class="list-title">
        ${esc(bookmark.title)}
        ${bookmark.shared ? '<span class="badge">geteilt</span>' : ''}
        ${!isOwn ? `<small class="hint">von ${esc(bookmark.ownerUsername)}</small>` : ''}
      </div>
      <div class="list-url">
        <a href="${esc(bookmark.url)}" target="_blank" rel="noopener noreferrer">${esc(
          hostOf(bookmark.url)
        )}</a>
      </div>
      <div class="tag-list">
        ${tagsToArray(bookmark.tags)
          .map((tag) => `<span>${esc(tag)}</span>`)
          .join('')}
      </div>
      <div class="list-actions">
        ${
          editable
            ? `<button class="btn btn-sm btn-icon" data-act="edit" title="Bearbeiten">${icon(
                'edit'
              )}</button>
               <button class="btn btn-sm btn-icon" data-act="toggle" title="${
                 bookmark.enabled ? 'Deaktivieren' : 'Aktivieren'
               }">${icon(bookmark.enabled ? 'eyeOff' : 'eye')}</button>
               <button class="btn btn-sm btn-icon btn-danger" data-act="delete" title="Loeschen">${icon(
                 'trash'
               )}</button>`
            : '<small class="hint">nur lesend</small>'
        }
      </div>
    </div>`;
}

export function render(container) {
  const own = state.bookmarks.filter((b) => b.userId === state.user.id);
  const others = state.bookmarks.filter((b) => b.userId !== state.user.id);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Anwendungen</h1>
        <small class="hint">
          ${own.length} eigene Lesezeichen${
            others.length ? ` &middot; ${others.length} freigegeben` : ''
          }
        </small>
      </div>
      <div class="row">
        <button class="btn" id="exportOwn">${icon('download')} Lesezeichen exportieren</button>
        <label class="btn" style="margin:0">
          ${icon('upload')} Importieren
          <input type="file" id="importOwn" accept="application/json,.json" class="hidden">
        </label>
        <button class="btn btn-primary" id="newBtn">${icon('plus')} Neues Lesezeichen</button>
      </div>
    </div>

    ${draft ? editorMarkup() : ''}

    <div class="list">
      <div class="list-head">
        <div></div>
        <div>Bild</div>
        <div>Titel</div>
        <div>URL</div>
        <div>Tags</div>
        <div style="text-align:right">Aktionen</div>
      </div>
      ${
        own.length || others.length
          ? own.map((b, i) => rowMarkup(b, i, own.length)).join('') +
            others.map((b, i) => rowMarkup(b, i, others.length)).join('')
          : `<div class="list-row"><div></div><div></div>
               <div class="list-title" style="grid-column:span 4">
                 Noch keine Lesezeichen - mit "Neues Lesezeichen" starten.
               </div></div>`
      }
    </div>`;

  if (draft) {
    updatePreview(container);
    renderIconOptions(container);
    wireEditor(container);
  }
  wireList(container);
}

function renderIconOptions(container) {
  const host = container.querySelector('#iconOptions');
  if (!host) return;
  host.innerHTML = iconCandidates
    .map(
      (candidate, index) =>
        `<button type="button" class="icon-option ${
          candidate.dataUrl === draft.icon ? 'selected' : ''
        }" data-index="${index}" title="${esc(candidate.source)}">
           <img src="${esc(candidate.dataUrl)}" alt="">
         </button>`
    )
    .join('');
  host.querySelectorAll('.icon-option').forEach((button) => {
    button.addEventListener('click', () => {
      draft.icon = iconCandidates[Number(button.dataset.index)].dataUrl;
      renderIconOptions(container);
      updatePreview(container);
    });
  });
}

function wireEditor(container) {
  const bind = (selector, event, handler) => {
    const node = container.querySelector(selector);
    if (node) node.addEventListener(event, handler);
  };

  bind('#fTitle', 'input', (e) => {
    draft.title = e.target.value;
    updatePreview(container);
  });
  bind('#fUrl', 'input', (e) => {
    draft.url = e.target.value;
  });
  bind('#fTags', 'input', (e) => {
    draft.tags = e.target.value;
    updatePreview(container);
  });
  bind('#fDesc', 'input', (e) => {
    draft.description = e.target.value;
    updatePreview(container);
  });
  bind('#fEnabled', 'change', (e) => {
    draft.enabled = e.target.checked;
  });
  bind('#fShared', 'change', (e) => {
    draft.shared = e.target.checked;
  });

  bind('#colorPicker', 'input', (e) => {
    draft.color = e.target.value.toLowerCase();
    draft.textColor = '';
    updatePreview(container);
    container.querySelectorAll('.swatch').forEach((s) =>
      s.classList.toggle('selected', s.dataset.color.toLowerCase() === draft.color)
    );
  });

  bind('#colorHex', 'input', (e) => {
    const value = e.target.value.trim();
    const normalized = value.startsWith('#') ? value : `#${value}`;
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) {
      draft.color =
        normalized.length === 4
          ? `#${normalized
              .slice(1)
              .split('')
              .map((c) => c + c)
              .join('')}`.toLowerCase()
          : normalized.toLowerCase();
      draft.textColor = '';
      updatePreview(container);
    }
  });

  container.querySelectorAll('.swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      draft.color = swatch.dataset.color.toLowerCase();
      draft.textColor = '';
      container
        .querySelectorAll('.swatch')
        .forEach((s) => s.classList.toggle('selected', s === swatch));
      updatePreview(container);
    });
  });

  bind('#autoTextColor', 'click', () => {
    draft.textColor = readableTextColor(draft.color);
    updatePreview(container);
    toast(`Schriftfarbe: ${draft.textColor}`);
  });

  bind('#iconFile', 'change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      draft.icon = await readFileAsDataUrl(file, MAX_ICON_BYTES);
      updatePreview(container);
      toast('Bild uebernommen.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });

  bind('#iconClear', 'click', () => {
    draft.icon = '';
    renderIconOptions(container);
    updatePreview(container);
  });

  bind('#iconFromUrl', 'click', async () => {
    const url = window.prompt('Adresse des Bildes (http/https):', '');
    if (!url) return;
    try {
      const { icon: result } = await api.downloadIcon(url);
      draft.icon = result.dataUrl;
      updatePreview(container);
      toast('Bild geladen.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  bind('#fetchIcon', 'click', async (event) => {
    const url = (container.querySelector('#fUrl') || {}).value;
    if (!url || !url.trim()) {
      toast('Bitte zuerst die URL des Dienstes eintragen.', 'error');
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Suche Bild ...';
    try {
      const result = await api.fetchIcons(url.trim());
      iconCandidates = result.icons || [];
      if (iconCandidates.length) {
        draft.icon = iconCandidates[0].dataUrl;
        if (!draft.title.trim() && result.title) {
          draft.title = result.title.slice(0, 120);
          const titleField = container.querySelector('#fTitle');
          if (titleField) titleField.value = draft.title;
        }
        toast(`${iconCandidates.length} Bild(er) gefunden.`, 'success');
      }
      renderIconOptions(container);
      updatePreview(container);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon('wand')} Automatisch von Webseite`;
    }
  });

  bind('#saveBtn', 'click', () => saveDraft());
  bind('#cancelBtn', 'click', () => {
    cancelEdit();
    rerender();
  });
  bind('#deleteBtn', 'click', async () => {
    const ok = await confirmDialog({
      title: 'Lesezeichen loeschen',
      message: `"${draft.title}" wirklich dauerhaft loeschen?`,
      confirmText: 'Loeschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteBookmark(draft.id);
      cancelEdit();
      await loadBookmarks();
      toast('Lesezeichen geloescht.', 'success');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function saveDraft() {
  if (busy) return;
  if (!draft.title.trim()) {
    toast('Bitte einen Titel eintragen.', 'error');
    return;
  }
  if (!draft.url.trim()) {
    toast('Bitte eine URL eintragen.', 'error');
    return;
  }
  busy = true;
  try {
    const payload = {
      title: draft.title,
      url: draft.url,
      description: draft.description,
      tags: draft.tags,
      icon: draft.icon,
      color: draft.color,
      textColor: draft.textColor || readableTextColor(draft.color),
      enabled: draft.enabled,
      shared: draft.shared,
    };
    if (draft.id === null) await api.createBookmark(payload);
    else await api.updateBookmark(draft.id, payload);
    cancelEdit();
    await loadBookmarks();
    toast('Gespeichert.', 'success');
    rerender();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    busy = false;
  }
}

function wireList(container) {
  const newBtn = container.querySelector('#newBtn');
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      startNew();
      rerender();
    });
  }

  const exportBtn = container.querySelector('#exportOwn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => downloadUrl('/api/backup/export/me'));
  }

  const importInput = container.querySelector('#importOwn');
  if (importInput) {
    importInput.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await readFileAsText(file));
        const list = Array.isArray(payload) ? payload : payload.bookmarks;
        if (!Array.isArray(list)) throw new Error('Die Datei enthaelt keine Lesezeichen.');
        const ok = await confirmDialog({
          title: 'Lesezeichen importieren',
          message: `${list.length} Eintraege zum eigenen Konto hinzufuegen?`,
          confirmText: 'Importieren',
        });
        if (!ok) return;
        const result = await api.importBookmarks(list);
        await loadBookmarks();
        toast(`${result.imported} Lesezeichen importiert.`, 'success');
        rerender();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        event.target.value = '';
      }
    });
  }

  container.querySelectorAll('.list-row[data-id]').forEach((row) => {
    row.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const id = Number(row.dataset.id);
      const bookmark = state.bookmarks.find((b) => b.id === id);
      if (!bookmark) return;

      try {
        switch (button.dataset.act) {
          case 'edit':
            startEdit(bookmark);
            rerender();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            break;

          case 'toggle': {
            const { bookmark: updated } = await api.setBookmarkEnabled(id, !bookmark.enabled);
            const index = state.bookmarks.findIndex((b) => b.id === id);
            state.bookmarks[index] = updated;
            rerender();
            break;
          }

          case 'delete': {
            const ok = await confirmDialog({
              title: 'Lesezeichen loeschen',
              message: `"${bookmark.title}" wirklich dauerhaft loeschen?`,
              confirmText: 'Loeschen',
              danger: true,
            });
            if (!ok) return;
            await api.deleteBookmark(id);
            if (state.editingId === id) cancelEdit();
            await loadBookmarks();
            toast('Lesezeichen geloescht.', 'success');
            rerender();
            break;
          }

          case 'up':
          case 'down': {
            const own = state.bookmarks.filter((b) => b.userId === state.user.id);
            const from = own.findIndex((b) => b.id === id);
            const to = button.dataset.act === 'up' ? from - 1 : from + 1;
            if (to < 0 || to >= own.length) return;
            const ids = own.map((b) => b.id);
            ids.splice(to, 0, ids.splice(from, 1)[0]);
            const { bookmarks } = await api.reorderBookmarks(ids);
            state.bookmarks = bookmarks;
            rerender();
            break;
          }
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

export function reset() {
  draft = null;
  iconCandidates = [];
}
