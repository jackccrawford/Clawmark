// status.js — operational health for the local Geniuz station.
// Three concerns: memory health, data location, Claude Desktop wiring.
// Observation only: no auto-fix actions. User reads dots, takes action elsewhere.

import * as api from '../api.js';
import * as fmt from '../format.js';

export async function mount(container) {
  container.innerHTML = `<div class="surface-loading">Reading station status…</div>`;

  let status;
  try {
    status = await api.getStatus();
  } catch (e) {
    container.innerHTML = `
      <main class="main">
        <header class="main-header">
          <div>
            <h1>Status</h1>
            <p class="mh-sub">Health checks for your Geniuz station</p>
          </div>
        </header>
        <div class="main-body">
          <div class="empty-state" style="max-width:560px;margin:48px auto;text-align:left;">
            <p style="font-size:15px;line-height:1.6;color:var(--color-ink-secondary);">
              Couldn't read station status.
            </p>
            <p style="font-size:13px;color:var(--color-ink-quaternary);margin-top:12px;">
              ${escapeHtml(String(e && e.message ? e.message : e))}
            </p>
          </div>
        </div>
      </main>
    `;
    return;
  }

  const root = document.createElement('main');
  root.className = 'main';

  // ---- Header --------------------------------------------------------------
  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <div>
      <h1>Status</h1>
      <p class="mh-sub">Health checks for your Geniuz station</p>
    </div>
  `;
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'main-body';

  // ---- Empty-station short-circuit ----------------------------------------
  if (!status.memory_count) {
    body.innerHTML = `
      <div class="empty-state" style="max-width:560px;margin:48px auto;text-align:left;">
        <p style="font-size:15px;line-height:1.6;color:var(--color-ink-secondary);">
          Your station is empty. First memory will appear here.
        </p>
        <p style="font-size:13px;color:var(--color-ink-quaternary);margin-top:12px;">
          Saved at <code class="t-mono">${escapeHtml(status.data_dir || '~/.geniuz/')}</code>
        </p>
      </div>
    `;
    root.appendChild(body);
    container.innerHTML = '';
    container.appendChild(root);
    return;
  }

  // ---- Compute health for each piece --------------------------------------
  const indexedHealth =
    status.embedding_count === 0 ? 'warn'
    : status.indexed_pct >= 95 ? 'good'
    : 'warn';

  const modelHealth = status.embedding_model ? 'good' : 'warn';

  // Linux: config_path is None → neutral. Otherwise: configured + has_geniuz = good;
  // configured but missing geniuz key = amber; not configured at all = amber (advisory, not broken).
  const cdPath = status.claude_desktop_config_path;
  let cdHealth, cdNote;
  if (cdPath === null || cdPath === undefined) {
    cdHealth = 'neutral';
    cdNote = 'Not applicable on this platform';
  } else if (!status.claude_desktop_configured) {
    cdHealth = 'warn';
    cdNote = 'Not detected';
  } else if (!status.claude_desktop_has_geniuz) {
    cdHealth = 'warn';
    cdNote = 'Claude Desktop is configured, but no geniuz entry under mcpServers.';
  } else {
    cdHealth = 'good';
    cdNote = 'Geniuz is wired into Claude Desktop.';
  }

  // ---- Stat row: memory health -------------------------------------------
  const [sizeNum, sizeUnit] = fmt.bytes(status.data_dir_bytes);

  const statRow = document.createElement('div');
  statRow.className = 'stat-row';
  statRow.style.gridTemplateColumns = 'repeat(3, 1fr)';
  statRow.innerHTML = `
    <div class="stat-card featured">
      <div class="sc-label">Total memories</div>
      <div class="sc-num">${fmt.number(status.memory_count)}</div>
      <div class="sc-meta">${sizeNum}<span style="opacity:0.7;margin-left:3px;">${sizeUnit}</span> on disk</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Indexed</div>
      <div class="sc-num">${fmt.number(status.embedding_count)} <span style="font-size:0.55em;color:var(--color-ink-tertiary);font-weight:500;">/ ${fmt.number(status.memory_count)}</span></div>
      <div class="sc-meta">
        ${dot(indexedHealth)}
        ${Math.round(status.indexed_pct)}% indexed${status.embedding_count === 0 ? ' · run <code class="t-mono">geniuz backfill</code>' : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Embedding model</div>
      <div class="sc-num" style="font-size:var(--fs-18);font-weight:var(--fw-semi);line-height:1.3;word-break:break-word;">
        ${status.embedding_model ? escapeHtml(status.embedding_model) : '—'}
      </div>
      <div class="sc-meta">
        ${dot(modelHealth)}
        ${status.embedding_model ? 'active' : 'no model configured'}
      </div>
    </div>
  `;
  body.appendChild(statRow);

  // ---- Two-column: data location + Claude Desktop wiring ------------------
  const grid = document.createElement('div');
  grid.className = 'split-panes';
  grid.style.gridTemplateColumns = '1fr 1fr';

  // Data location panel
  const locPanel = document.createElement('div');
  locPanel.className = 'side-panel';
  locPanel.innerHTML = `
    <div class="sp-title">Data location</div>
    <div class="path-display">${escapeHtml(status.data_dir || '—')}</div>
    <div class="kv-row">
      <span class="kv-key">Size on disk</span>
      <span class="kv-val">${sizeNum} ${sizeUnit}</span>
    </div>
    <div class="kv-row">
      <span class="kv-key">Memories</span>
      <span class="kv-val">${fmt.number(status.memory_count)}</span>
    </div>
    <div style="margin-top:4px;">
      <button class="btn" data-action="open-data-dir">Show in Finder</button>
    </div>
  `;
  const openBtn = locPanel.querySelector('[data-action="open-data-dir"]');
  openBtn.addEventListener('click', async () => {
    if (!status.data_dir) return;
    try {
      await api.openPath(status.data_dir);
    } catch (e) {
      console.error('[status] openPath failed:', e);
    }
  });
  grid.appendChild(locPanel);

  // Claude Desktop panel
  const cdPanel = document.createElement('div');
  cdPanel.className = 'side-panel';
  const isLinux = cdHealth === 'neutral';

  cdPanel.innerHTML = `
    <div class="sp-title">Claude Desktop</div>
    ${cdPath
      ? `<div class="path-display">${escapeHtml(cdPath)}</div>`
      : `<div class="path-display" style="color:var(--color-ink-quaternary);">${escapeHtml(cdNote)}</div>`
    }
    <div class="kv-row">
      <span class="kv-key">Config detected</span>
      <span class="kv-val">
        ${isLinux ? dot('neutral') + ' n/a'
          : status.claude_desktop_configured
            ? dot('good') + ' yes'
            : dot('warn') + ' no'}
      </span>
    </div>
    <div class="kv-row">
      <span class="kv-key">Geniuz wired</span>
      <span class="kv-val">
        ${isLinux ? dot('neutral') + ' n/a'
          : status.claude_desktop_has_geniuz
            ? dot('good') + ' yes'
            : dot('warn') + ' no'}
      </span>
    </div>
    ${!isLinux && (!status.claude_desktop_configured || !status.claude_desktop_has_geniuz) ? `
      <div style="font-size:var(--fs-12);color:var(--color-ink-tertiary);line-height:1.5;margin-top:4px;">
        ${status.claude_desktop_configured
          ? 'Add a <code class="t-mono">geniuz</code> entry under <code class="t-mono">mcpServers</code> in the config above.'
          : 'Install Claude Desktop, then add <code class="t-mono">geniuz</code> under <code class="t-mono">mcpServers</code>.'}
      </div>
    ` : ''}
  `;
  grid.appendChild(cdPanel);

  body.appendChild(grid);

  root.appendChild(body);
  container.innerHTML = '';
  container.appendChild(root);
}

// Local helper: status dot markup. Uses design-system classes.
// Variants: 'good' (green), 'warn' (amber), 'bad' (red — unused for now but defined for symmetry),
// 'neutral' (grey, default .dot).
function dot(variant) {
  if (variant === 'good') return '<span class="dot dot-good" style="margin-right:4px;"></span>';
  if (variant === 'warn') return '<span class="dot dot-warn" style="margin-right:4px;"></span>';
  if (variant === 'bad')  return '<span class="dot" style="background:var(--color-bad);box-shadow:0 0 0 3px rgba(220,38,38,0.12);margin-right:4px;"></span>';
  return '<span class="dot" style="margin-right:4px;"></span>';
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
