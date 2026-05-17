// detail.js — single-memory detail surface.
// Shows one memory's full content plus its thread context. Reached by
// clicking a memory row in Recent (which sets selectedMemoryUuid).

import * as api from '../api.js';
import * as fmt from '../format.js';
import { renderMd } from '../md.js';
import { getState, navigate } from '../store.js';

export async function mount(container) {
  const { selectedMemoryUuid } = getState();

  if (!selectedMemoryUuid) {
    renderShell(container, errorBody('No memory selected.', 'Click Recent in the sidebar to choose one.'));
    return;
  }

  container.innerHTML = `<div class="surface-loading">Loading memory…</div>`;

  // Fetch detail + thread in parallel. Thread is best-effort: if it fails,
  // we still show the memory.
  let memory;
  let thread = [];
  try {
    const [m, t] = await Promise.allSettled([
      api.getMemoryDetail(selectedMemoryUuid),
      api.getThreadChain(selectedMemoryUuid, 100),
    ]);
    if (m.status === 'rejected') throw m.reason;
    memory = m.value;
    if (t.status === 'fulfilled' && Array.isArray(t.value)) thread = t.value;
  } catch (e) {
    renderShell(container, errorBody("Couldn't load memory.", e.message || String(e)));
    return;
  }

  if (!memory) {
    renderShell(container, errorBody('Memory not found.', 'The UUID may be invalid or the memory was archived.'));
    return;
  }

  // ---- Build layout ----------------------------------------------------
  const root = document.createElement('main');
  root.className = 'main';

  // Header: back + gist
  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <div style="min-width:0;flex:1;">
      <button type="button" class="back-link" style="
        background:none;border:0;padding:0;margin:0 0 8px 0;cursor:pointer;
        font-size:var(--fs-12);color:var(--color-ink-tertiary);
        text-transform:uppercase;letter-spacing:0.04em;font-weight:var(--fw-medium);
      ">← Recent</button>
      <h1 style="font-size:var(--fs-20);line-height:1.3;">${renderMd(memory.gist || '(no gist)')}</h1>
      <p class="mh-sub">${metaLine(memory)}</p>
    </div>
  `;
  header.querySelector('.back-link').addEventListener('click', () => navigate('recent'));

  // Body — content column + thread side column
  const body = document.createElement('div');
  body.className = 'main-body';

  const hasThread = thread && thread.length > 1;
  body.innerHTML = `
    <div class="${hasThread ? 'split-panes' : ''}">
      <div class="content-col">
        <div class="side-panel" style="padding:24px 28px;">
          <div class="sp-title">Full memory</div>
          <div class="detail-content" style="
            font-size:var(--fs-15);line-height:1.7;color:var(--color-ink);
            white-space:pre-wrap;word-break:break-word;
          ">${contentHtml(memory.content)}</div>
        </div>
      </div>
      ${hasThread ? '<div class="side-col" id="threadCol"></div>' : ''}
    </div>
  `;

  if (hasThread) {
    const threadCol = body.querySelector('#threadCol');
    threadCol.appendChild(threadPanel(thread, memory.uuid));
  }

  // Footer
  const footer = document.createElement('footer');
  footer.className = 'main-footer';
  footer.innerHTML = `
    <span>UUID ${escapeHtml(shortUuid(memory.uuid))}</span>
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

// ---- Helpers -----------------------------------------------------------

// Render a minimal shell (header with back button + a body block). Used for
// error / empty states so the user can always get back to Recent.
function renderShell(container, bodyHtml) {
  const root = document.createElement('main');
  root.className = 'main';
  root.innerHTML = `
    <header class="main-header">
      <div>
        <button type="button" class="back-link" style="
          background:none;border:0;padding:0;margin:0 0 8px 0;cursor:pointer;
          font-size:var(--fs-12);color:var(--color-ink-tertiary);
          text-transform:uppercase;letter-spacing:0.04em;font-weight:var(--fw-medium);
        ">← Recent</button>
        <h1>Memory detail</h1>
      </div>
    </header>
    <div class="main-body" style="display:block;">${bodyHtml}</div>
  `;
  root.querySelector('.back-link').addEventListener('click', () => navigate('recent'));
  container.innerHTML = '';
  container.appendChild(root);
}

function errorBody(title, detail) {
  return `
    <div class="empty-state" style="max-width:560px;margin:48px auto;text-align:left;">
      <p style="font-size:15px;line-height:1.6;color:var(--color-ink-secondary);">
        <strong>${escapeHtml(title)}</strong>
      </p>
      <p style="font-size:13px;color:var(--color-ink-quaternary);margin-top:12px;">
        ${escapeHtml(detail)}
      </p>
    </div>
  `;
}

// Metadata line under the gist: category, full time, ago, uuid prefix.
function metaLine(m) {
  const parts = [];
  if (m.category) {
    parts.push(`<span class="tag-prefix tp-${escapeHtml(m.category.toLowerCase().replace(/\s+/g, ''))}"
      style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:var(--fs-12);
      font-weight:var(--fw-medium);text-transform:uppercase;letter-spacing:0.04em;
      background:var(--color-surface-warm);color:var(--color-ink-tertiary);
      border:1px solid var(--color-border-subtle);">${escapeHtml(m.category)}</span>`);
  }
  parts.push(escapeHtml(fmt.timeFull(m.created_at)));
  parts.push(escapeHtml(fmt.ago(m.created_at)));
  parts.push(`<span style="font-family:var(--font-mono,monospace);color:var(--color-ink-quaternary);">${escapeHtml(shortUuid(m.uuid))}</span>`);
  return parts.join(' <span style="color:var(--color-ink-senary)">·</span> ');
}

function contentHtml(content) {
  if (!content || !content.trim()) {
    return `<span style="color:var(--color-ink-quaternary);font-style:italic;">(no body — gist-only memory)</span>`;
  }
  return renderMd(content);
}

// Build the right-column thread panel.
function threadPanel(thread, currentUuid) {
  const wrap = document.createElement('div');
  wrap.className = 'side-panel';
  wrap.innerHTML = `
    <div class="sp-title">Thread · ${thread.length} ${thread.length === 1 ? 'memory' : 'memories'}</div>
    <div class="memory-list thread-list"></div>
  `;
  const list = wrap.querySelector('.thread-list');
  for (const t of thread) list.appendChild(threadRow(t, t.uuid === currentUuid));
  return wrap;
}

function threadRow(m, isCurrent) {
  const el = document.createElement('div');
  el.className = 'memory-item compact' + (isCurrent ? ' is-threaded' : '');
  el.style.cursor = isCurrent ? 'default' : 'pointer';
  if (isCurrent) {
    el.style.background = 'var(--color-surface-warm)';
  }
  el.innerHTML = `
    <span class="m-marker ${m.parent_uuid ? 'threaded' : ''}" aria-hidden="true"></span>
    <div class="m-body">
      <div class="m-gist">${renderMd(m.gist || '(no gist)')}</div>
      <div class="m-meta">${escapeHtml((m.category || '').toLowerCase())}</div>
    </div>
    <div class="m-time">${escapeHtml(fmt.ago(m.created_at))}</div>
  `;
  if (!isCurrent) {
    el.addEventListener('click', () => navigate('detail', { selectedMemoryUuid: m.uuid }));
  }
  return el;
}

function shortUuid(uuid) {
  if (!uuid) return '—';
  return uuid.slice(0, 8);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
