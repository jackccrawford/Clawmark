// data.js — the Data & Export surface.
// Data-sovereignty face of Geniuz: where memory lives, how big it is, how to
// take it with you. Observation + safe export only — no destructive actions.

import * as api from '../api.js';
import * as fmt from '../format.js';

export async function mount(container) {
  container.innerHTML = `
    <div class="surface-loading">Loading your data…</div>
  `;

  // Parallel fetches. getStationStats() gives us conversations (thread count);
  // getStatus() gives us data_dir, data_dir_bytes, embedding info.
  let status, stats;
  try {
    [status, stats] = await Promise.all([
      api.getStatus(),
      api.getStationStats(),
    ]);
  } catch (e) {
    container.innerHTML = `
      <div class="surface-error">
        <h2>Couldn't read your data location.</h2>
        <p>${escapeHtml(e.message || String(e))}</p>
        <p>Expected file: <code>~/.geniuz/memory.db</code></p>
      </div>
    `;
    return;
  }

  const dataDir = status && status.data_dir;
  const dataDirBytes = status && status.data_dir_bytes;
  const memoryDbPath = dataDir ? joinPath(dataDir, 'memory.db') : null;

  // ---- Layout ---------------------------------------------------------
  const root = document.createElement('main');
  root.className = 'main';

  // Header
  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <div>
      <h1>Data &amp; Export</h1>
      <p class="mh-sub">Your memory lives on this Mac. Take it with you, anytime.</p>
    </div>
    <div class="mh-actions"></div>
  `;

  // Body
  const body = document.createElement('div');
  body.className = 'main-body';

  // Use the side-col grid (single column) for stacked panels.
  // .side-panel + .kv-row classes give us the standard look.
  const panelStack = document.createElement('div');
  panelStack.style.display = 'grid';
  panelStack.style.gridTemplateColumns = '1fr';
  panelStack.style.gap = '16px';
  panelStack.style.maxWidth = '720px';

  // ---- Panel 1: Location ---------------------------------------------
  const locPanel = document.createElement('div');
  locPanel.className = 'side-panel';

  if (!dataDir) {
    locPanel.innerHTML = `
      <div class="sp-title">Location</div>
      <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val">Couldn't determine data location</span></div>
    `;
  } else {
    const [folderNum, folderUnit] = fmt.bytes(dataDirBytes);
    locPanel.innerHTML = `
      <div class="sp-title">Location</div>
      <div class="kv-row"><span class="kv-key">Data folder</span><span class="kv-val"></span></div>
      <div class="path-display" id="dataDirPath">${escapeHtml(dataDir)}</div>
      <div class="kv-row"><span class="kv-key">Folder size</span><span class="kv-val">${folderNum} ${folderUnit} total</span></div>
      <div class="kv-row"><span class="kv-key">Memory file</span><span class="kv-val">memory.db</span></div>
      <div class="path-display">${escapeHtml(memoryDbPath || '')}</div>
      <div style="display:flex; gap:8px; margin-top:4px;">
        <button class="btn" id="showInFinderBtn">
          <span class="dot dot-good"></span>
          Show in Finder
        </button>
      </div>
    `;
    const finderBtn = locPanel.querySelector('#showInFinderBtn');
    finderBtn.addEventListener('click', async () => {
      try {
        await api.openPath(dataDir);
      } catch (e) {
        console.error('[geniuz] openPath failed:', e);
      }
    });
  }

  // ---- Panel 2: Inventory --------------------------------------------
  const invPanel = document.createElement('div');
  invPanel.className = 'side-panel';
  const memCount = status.memory_count != null ? status.memory_count : (stats && stats.total_memories);
  const embCount = status.embedding_count;
  const idxPct = status.indexed_pct;
  const embModel = status.embedding_model;
  const threadCount = stats && stats.conversations;

  invPanel.innerHTML = `
    <div class="sp-title">Inventory</div>
    <div class="kv-row"><span class="kv-key">Memories</span><span class="kv-val">${fmt.number(memCount)}</span></div>
    <div class="kv-row"><span class="kv-key">Threads</span><span class="kv-val">${fmt.number(threadCount)}</span></div>
    <div class="kv-row">
      <span class="kv-key">Indexed for search</span>
      <span class="kv-val">${fmt.number(embCount)}${idxPct != null ? ` <span style="color:var(--color-ink-tertiary); font-weight:400;">(${formatPct(idxPct)}% of total)</span>` : ''}</span>
    </div>
    <div class="kv-row"><span class="kv-key">Embedding model</span><span class="kv-val" style="font-family:var(--font-mono); font-size:var(--fs-12);">${escapeHtml(embModel || '(not set)')}</span></div>
  `;

  // ---- Panel 3: Export -----------------------------------------------
  // NOTE: v1 sends the export to ~/Desktop with a timestamped filename.
  // FOLLOW-UP: wire tauri-plugin-dialog so the user can pick the target
  // location with a native save panel.
  const exportPanel = document.createElement('div');
  exportPanel.className = 'side-panel';
  exportPanel.innerHTML = `
    <div class="sp-title">Export</div>
    <p style="font-size:var(--fs-14); color:var(--color-ink-secondary); line-height:1.55; margin:0;">
      Export a copy of your <code style="font-family:var(--font-mono); font-size:0.9em; background:var(--color-surface-subtle); padding:1px 6px; border-radius:4px;">memory.db</code> to your Desktop.
      The file is plain SQLite — you can open it with any sqlite tool, back it up, or move it to another machine.
    </p>
    <div style="display:flex; gap:8px; align-items:center;">
      <button class="btn btn-primary" id="exportBtn" ${dataDir ? '' : 'disabled'}>
        Export to Desktop
      </button>
      <span id="exportStatus" style="font-size:var(--fs-13); color:var(--color-ink-tertiary);"></span>
    </div>
    <div id="exportResult" style="display:none;"></div>
  `;

  const exportBtn = exportPanel.querySelector('#exportBtn');
  const exportStatus = exportPanel.querySelector('#exportStatus');
  const exportResult = exportPanel.querySelector('#exportResult');

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (!dataDir) return;
      exportBtn.disabled = true;
      exportStatus.textContent = 'Exporting…';
      exportStatus.style.color = 'var(--color-ink-tertiary)';
      exportResult.style.display = 'none';

      const targetPath = defaultExportPath(dataDir);
      try {
        const bytes = await api.exportMemoryDbTo(targetPath);
        const [num, unit] = fmt.bytes(bytes);
        exportStatus.textContent = '';
        exportResult.style.display = 'block';
        exportResult.innerHTML = `
          <div style="padding:12px 14px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:var(--r-md); display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px; font-size:var(--fs-13); font-weight:var(--fw-medium); color:#15803d;">
              <span class="dot dot-good"></span>
              Exported ${num} ${unit} to Desktop
            </div>
            <div class="path-display" style="margin:0;">${escapeHtml(targetPath)}</div>
            <div style="font-size:var(--fs-12); color:var(--color-ink-quaternary);">${new Date().toLocaleString()}</div>
          </div>
        `;
      } catch (e) {
        exportStatus.textContent = '';
        exportResult.style.display = 'block';
        exportResult.innerHTML = `
          <div style="padding:12px 14px; background:#fef2f2; border:1px solid #fecaca; border-radius:var(--r-md); font-size:var(--fs-13); color:var(--color-bad);">
            Export failed: ${escapeHtml(e.message || String(e))}
          </div>
        `;
      } finally {
        exportBtn.disabled = false;
      }
    });
  }

  panelStack.appendChild(locPanel);
  panelStack.appendChild(invPanel);
  panelStack.appendChild(exportPanel);
  body.appendChild(panelStack);

  // Footer (local-private signature)
  const footer = document.createElement('footer');
  footer.className = 'main-footer';
  footer.innerHTML = `
    <span>${dataDir ? escapeHtml(dataDir) : 'data location unknown'}</span>
    <span class="local-signature">
      <span class="dot"></span>
      local <span class="sep">·</span> private <span class="sep">·</span> yours
    </span>
  `;

  root.appendChild(header);
  root.appendChild(body);
  root.appendChild(footer);
  container.innerHTML = '';
  container.appendChild(root);
}

// ---- helpers --------------------------------------------------------

// Derive the Desktop path from the data_dir. data_dir is the absolute path to
// the .geniuz folder, e.g. /Users/mars/.geniuz or C:\Users\mars\.geniuz.
// The parent of data_dir is the user's home, and Desktop sits next to .geniuz.
// Cross-platform: detect separator from the path itself.
function defaultExportPath(dataDir) {
  const sep = dataDir.includes('\\') && !dataDir.includes('/') ? '\\' : '/';
  // Strip trailing separator if any, then drop the final segment (.geniuz).
  const trimmed = dataDir.replace(/[\/\\]+$/, '');
  const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const homeDir = lastSep > 0 ? trimmed.slice(0, lastSep) : trimmed;

  // YYYY-MM-DD-HHMMSS from local-ish ISO string.
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `${homeDir}${sep}Desktop${sep}geniuz-export-${stamp}.db`;
}

function joinPath(dir, file) {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const trimmed = dir.replace(/[\/\\]+$/, '');
  return `${trimmed}${sep}${file}`;
}

function formatPct(p) {
  if (p === null || p === undefined || Number.isNaN(p)) return '—';
  // If p comes in as 0..1, scale; if it's already 0..100, leave it.
  const v = p <= 1 ? p * 100 : p;
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
