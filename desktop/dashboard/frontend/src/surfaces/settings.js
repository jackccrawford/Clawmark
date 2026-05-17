// settings.js — view and edit persisted Geniuz preferences.
// Loads from disk on mount, edits stay local until "Save changes" writes
// back through the Tauri canonical handler. No localStorage.

import * as api from '../api.js';

const FREQUENCIES = ['daily', 'weekly', 'manual'];
const COUNT_MIN = 0;
const COUNT_MAX = 20;

export async function mount(container) {
  container.innerHTML = `<div class="surface-loading">Loading settings…</div>`;

  // ---- Initial load ---------------------------------------------------
  let loaded;
  try {
    loaded = await api.getSettings();
  } catch (e) {
    container.innerHTML = `
      <main class="main">
        <header class="main-header">
          <div>
            <h1>Settings</h1>
            <p class="mh-sub">Couldn't read your preferences.</p>
          </div>
        </header>
        <div class="main-body">
          <div class="empty-state" style="max-width:560px;margin:48px auto;text-align:left;">
            <p style="font-size:15px;line-height:1.6;color:var(--color-bad);">
              ${escapeHtml(e.message || String(e))}
            </p>
          </div>
        </div>
      </main>
    `;
    return;
  }

  // Best-effort sidecar info for the About panel — failures here shouldn't
  // block the form, so resolve to null and render gracefully.
  const [appVersion, dataDir] = await Promise.all([
    api.getAppVersion().catch(() => null),
    api.getDataDir().catch(() => null),
  ]);

  // ---- Local state ----------------------------------------------------
  let savedSettings = clone(loaded);
  let editedSettings = clone(loaded);
  let lastSavedAt = null;       // Date when last successful save happened
  let lastError = null;         // string from last failed save
  let saving = false;

  const isDirty = () =>
    JSON.stringify(savedSettings) !== JSON.stringify(editedSettings);

  // ---- Build layout ---------------------------------------------------
  const root = document.createElement('main');
  root.className = 'main';

  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <div>
      <h1>Settings</h1>
      <p class="mh-sub">Your preferences <span style="color:var(--color-ink-senary)">·</span> stored on this Mac <span style="color:var(--color-ink-senary)">·</span> applied next launch</p>
    </div>
    <div class="mh-actions"></div>
  `;

  const body = document.createElement('div');
  body.className = 'main-body';
  body.style.display = 'block';

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr';
  grid.style.gap = '16px';
  grid.style.maxWidth = '720px';
  body.appendChild(grid);

  // Each panel re-renders on edit so conditional rows (frequency) react.
  const startupPanel = document.createElement('section');
  startupPanel.className = 'side-panel';

  const updatesPanel = document.createElement('section');
  updatesPanel.className = 'side-panel';

  const displayPanel = document.createElement('section');
  displayPanel.className = 'side-panel';

  const aboutPanel = document.createElement('section');
  aboutPanel.className = 'side-panel';

  grid.appendChild(startupPanel);
  grid.appendChild(updatesPanel);
  grid.appendChild(displayPanel);
  grid.appendChild(aboutPanel);

  // Action bar at the bottom of the body
  const actionBar = document.createElement('div');
  actionBar.style.display = 'flex';
  actionBar.style.alignItems = 'center';
  actionBar.style.justifyContent = 'space-between';
  actionBar.style.gap = '12px';
  actionBar.style.marginTop = '20px';
  actionBar.style.maxWidth = '720px';
  body.appendChild(actionBar);

  // ---- Renderers ------------------------------------------------------

  function renderStartup() {
    startupPanel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sp-title';
    title.textContent = 'Startup';
    startupPanel.appendChild(title);

    startupPanel.appendChild(
      toggleRow({
        id: 'launch_at_login',
        label: 'Launch Geniuz at login',
        description:
          'Auto-start the menubar app when you sign in (Mac LaunchAgent / Windows Run).',
        checked: !!editedSettings.launch_at_login,
        onChange: (v) => {
          editedSettings.launch_at_login = v;
          renderActionBar();
        },
      })
    );
  }

  function renderUpdates() {
    updatesPanel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sp-title';
    title.textContent = 'Updates';
    updatesPanel.appendChild(title);

    updatesPanel.appendChild(
      toggleRow({
        id: 'autoupdate_enabled',
        label: 'Automatically check for updates',
        description:
          'Geniuz pings the update channel on the schedule below. Updates never install without your click.',
        checked: !!editedSettings.autoupdate_enabled,
        onChange: (v) => {
          editedSettings.autoupdate_enabled = v;
          renderUpdates(); // re-render so the frequency row shows/hides
          renderActionBar();
        },
      })
    );

    if (editedSettings.autoupdate_enabled) {
      const row = document.createElement('div');
      row.className = 'kv-row';
      row.style.alignItems = 'center';
      row.style.padding = '10px 0 4px';

      const key = document.createElement('div');
      key.className = 'kv-key';
      key.textContent = 'Check frequency';

      const val = document.createElement('div');
      val.className = 'kv-val';

      const select = document.createElement('select');
      select.style.padding = '5px 8px';
      select.style.border = '1px solid var(--color-border)';
      select.style.borderRadius = 'var(--r-md)';
      select.style.background = 'var(--color-surface)';
      select.style.fontSize = 'var(--fs-13)';
      for (const f of FREQUENCIES) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f.charAt(0).toUpperCase() + f.slice(1);
        if (editedSettings.update_check_frequency === f) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        editedSettings.update_check_frequency = select.value;
        renderActionBar();
      });
      val.appendChild(select);

      row.appendChild(key);
      row.appendChild(val);
      updatesPanel.appendChild(row);
    }
  }

  function renderDisplay() {
    displayPanel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sp-title';
    title.textContent = 'Display';
    displayPanel.appendChild(title);

    const row = document.createElement('div');
    row.className = 'kv-row';
    row.style.alignItems = 'center';
    row.style.padding = '8px 0 4px';

    const key = document.createElement('div');
    key.className = 'kv-key';
    key.innerHTML = `Recent memories in menubar
      <div style="font-size:var(--fs-12);color:var(--color-ink-quaternary);font-weight:400;margin-top:2px;max-width:380px;line-height:1.45;">
        How many recent memories to show in the tray dropdown. 0 hides the section.
      </div>`;

    const val = document.createElement('div');
    val.className = 'kv-val';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(COUNT_MIN);
    input.max = String(COUNT_MAX);
    input.step = '1';
    input.value = String(editedSettings.recent_memories_count ?? 0);
    input.style.width = '72px';
    input.style.padding = '5px 8px';
    input.style.border = '1px solid var(--color-border)';
    input.style.borderRadius = 'var(--r-md)';
    input.style.background = 'var(--color-surface)';
    input.style.fontSize = 'var(--fs-13)';
    input.style.fontVariantNumeric = 'tabular-nums';
    input.addEventListener('input', () => {
      // Keep edited state loose; clamp on save so the user can type freely.
      const n = parseInt(input.value, 10);
      editedSettings.recent_memories_count = Number.isFinite(n) ? n : 0;
      renderActionBar();
    });
    val.appendChild(input);

    row.appendChild(key);
    row.appendChild(val);
    displayPanel.appendChild(row);
  }

  function renderAbout() {
    aboutPanel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sp-title';
    title.textContent = 'About';
    aboutPanel.appendChild(title);

    aboutPanel.appendChild(
      kvRow('Settings version', String(savedSettings.version ?? '—'))
    );
    aboutPanel.appendChild(
      kvRow('Geniuz app version', appVersion ? `v${appVersion}` : '—')
    );

    if (dataDir) {
      const row = document.createElement('div');
      row.className = 'kv-row';
      row.style.alignItems = 'flex-start';
      row.style.flexDirection = 'column';
      row.style.gap = '4px';

      const k = document.createElement('div');
      k.className = 'kv-key';
      k.textContent = 'Data directory';

      const v = document.createElement('div');
      v.className = 'path-display';
      v.style.width = '100%';
      v.textContent = dataDir;

      row.appendChild(k);
      row.appendChild(v);
      aboutPanel.appendChild(row);
    }
  }

  function renderActionBar() {
    actionBar.innerHTML = '';

    // Left side: dirty / saved-at / error indicator
    const status = document.createElement('div');
    status.style.fontSize = 'var(--fs-12)';
    status.style.color = 'var(--color-ink-quaternary)';
    status.style.minHeight = '20px';

    if (lastError) {
      status.style.color = 'var(--color-bad)';
      status.textContent = `Save failed: ${lastError}`;
    } else if (isDirty()) {
      status.style.color = 'var(--color-warn)';
      const n = countChanges(savedSettings, editedSettings);
      status.textContent = `Unsaved changes (${n} edited)`;
    } else if (lastSavedAt) {
      status.style.color = 'var(--color-good)';
      status.textContent = `Saved at ${formatTime(lastSavedAt)}.`;
    } else {
      status.textContent = '';
    }

    // Right side: discard + save
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';

    const discardBtn = document.createElement('button');
    discardBtn.className = 'btn';
    discardBtn.textContent = 'Discard';
    discardBtn.disabled = saving || !isDirty();
    if (discardBtn.disabled) discardBtn.style.opacity = '0.5';
    discardBtn.addEventListener('click', () => {
      editedSettings = clone(savedSettings);
      lastError = null;
      renderAll();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.disabled = saving || !isDirty();
    if (saveBtn.disabled) saveBtn.style.opacity = '0.5';
    saveBtn.textContent = saving
      ? 'Saving…'
      : isDirty()
        ? `Save changes (${countChanges(savedSettings, editedSettings)})`
        : 'Save';
    saveBtn.addEventListener('click', handleSave);

    buttons.appendChild(discardBtn);
    buttons.appendChild(saveBtn);

    actionBar.appendChild(status);
    actionBar.appendChild(buttons);
  }

  function renderAll() {
    renderStartup();
    renderUpdates();
    renderDisplay();
    renderAbout();
    renderActionBar();
  }

  // ---- Save flow ------------------------------------------------------

  async function handleSave() {
    if (saving || !isDirty()) return;

    // Clamp recent_memories_count into range before persisting.
    const patch = clone(editedSettings);
    patch.recent_memories_count = clamp(
      patch.recent_memories_count ?? 0,
      COUNT_MIN,
      COUNT_MAX
    );
    if (!FREQUENCIES.includes(patch.update_check_frequency)) {
      patch.update_check_frequency = 'weekly';
    }

    saving = true;
    lastError = null;
    renderActionBar();

    try {
      const result = await api.updateSettings(patch);
      savedSettings = clone(result);
      editedSettings = clone(result);
      lastSavedAt = new Date();
    } catch (e) {
      lastError = e.message || String(e);
    } finally {
      saving = false;
      renderAll();
    }
  }

  // ---- Mount ----------------------------------------------------------
  renderAll();
  root.appendChild(header);
  root.appendChild(body);
  container.innerHTML = '';
  container.appendChild(root);
}

// ---- Small local helpers (kept here per "no new components" rule) ----

function toggleRow({ id, label, description, checked, onChange }) {
  const wrap = document.createElement('label');
  wrap.htmlFor = id;
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'flex-start';
  wrap.style.gap = '10px';
  wrap.style.cursor = 'pointer';
  wrap.style.padding = '6px 0';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = id;
  cb.checked = checked;
  cb.style.marginTop = '3px';
  cb.style.flexShrink = '0';
  cb.addEventListener('change', () => onChange(cb.checked));

  const text = document.createElement('div');
  text.style.flex = '1';

  const lbl = document.createElement('div');
  lbl.textContent = label;
  lbl.style.fontSize = 'var(--fs-14)';
  lbl.style.color = 'var(--color-ink)';
  lbl.style.fontWeight = 'var(--fw-medium)';
  text.appendChild(lbl);

  if (description) {
    const desc = document.createElement('div');
    desc.textContent = description;
    desc.style.fontSize = 'var(--fs-12)';
    desc.style.color = 'var(--color-ink-quaternary)';
    desc.style.marginTop = '2px';
    desc.style.lineHeight = '1.45';
    text.appendChild(desc);
  }

  wrap.appendChild(cb);
  wrap.appendChild(text);
  return wrap;
}

function kvRow(label, value) {
  const row = document.createElement('div');
  row.className = 'kv-row';

  const k = document.createElement('div');
  k.className = 'kv-key';
  k.textContent = label;

  const v = document.createElement('div');
  v.className = 'kv-val';
  v.textContent = value;

  row.appendChild(k);
  row.appendChild(v);
  return row;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function countChanges(a, b) {
  let n = 0;
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (k === 'version') continue;
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) n++;
  }
  return n;
}

function formatTime(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
