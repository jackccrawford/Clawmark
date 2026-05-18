// recent.js — home surface in Tool register.
//
// Stats strip mirrors the menubar popover language (Memories · Week · Threads).
// Memories render as dense rows grouped by Today / Yesterday / Earlier this
// week / Older. Click a row to open detail.
//
// Reference surface for the Tool register: parallel implementers of the other
// five surfaces should match this register (system font, dense layout, hairline
// dividers, hover at --bg-elevated, no decoration that doesn't earn its place).

import * as api from '../api.js';
import * as fmt from '../format.js';
import { navigate } from '../store.js';

export async function mount(container) {
  container.innerHTML = `<div class="surface-loading">Loading your memory…</div>`;

  let stats, recent;
  try {
    [stats, recent] = await Promise.all([
      api.getStationStats(),
      api.getRecentMemories(40),
    ]);
  } catch (e) {
    container.innerHTML = `
      <main class="main">
        <div class="surface-error">
          <h2>Couldn't read your station.</h2>
          <p>${escapeHtml(e?.message || String(e))}</p>
          <p>Expected file: <code>~/.geniuz/memory.db</code></p>
        </div>
      </main>
    `;
    return;
  }

  const [storageNum, storageUnit] = fmt.bytes(stats.storage_bytes);

  const root = document.createElement('main');
  root.className = 'main';

  // Header
  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <h1 class="main-header__title">Your memory</h1>
    <p class="main-header__sub">Everything you've remembered, most recent first.</p>
  `;
  root.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'main-body';
  root.appendChild(body);

  // Stats strip — mirrors the menubar popover (3 cells)
  const strip = document.createElement('div');
  strip.className = 'stats-strip';
  strip.innerHTML = `
    <div class="stats-strip__cell">
      <div class="stats-strip__value">${fmt.number(stats.total_memories)}</div>
      <div class="stats-strip__label">Memories</div>
    </div>
    <div class="stats-strip__cell">
      <div class="stats-strip__value">${fmt.number(stats.this_week)}</div>
      <div class="stats-strip__label">This week</div>
    </div>
    <div class="stats-strip__cell">
      <div class="stats-strip__value">${fmt.number(stats.conversations)}</div>
      <div class="stats-strip__label">Threads</div>
    </div>
  `;
  body.appendChild(strip);

  // Memory list — grouped by day-section
  if (!recent || recent.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'surface-empty';
    empty.textContent = 'No memories yet. Use the geniuz CLI or your MCP client to remember something.';
    body.appendChild(empty);
    return;
  }

  const groups = groupByDaySection(recent);
  for (const [label, items] of groups) {
    const section = document.createElement('section');
    section.className = 'day-section';
    const lbl = document.createElement('div');
    lbl.className = 'day-section__label';
    lbl.textContent = label;
    section.appendChild(lbl);

    const list = document.createElement('div');
    list.className = 'memory-list';
    for (const m of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'memory-row';
      row.innerHTML = `
        <span class="memory-row__gist">${escapeHtml(m.gist || '(no gist)')}</span>
        ${m.category ? `<span class="memory-row__chip">${escapeHtml(m.category)}</span>` : '<span></span>'}
        <span class="memory-row__time">${fmt.ago(m.created_at)}</span>
      `;
      row.addEventListener('click', () => navigate('detail', { selectedMemoryUuid: m.uuid }));
      list.appendChild(row);
    }
    section.appendChild(list);
    body.appendChild(section);
  }

  // Footer disk size as a quiet line (knowledge-worker apps don't shout
  // about their database size; they mention it).
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:24px;padding:12px 0;color:var(--ink-3);font-size:var(--fs-micro);';
  footer.textContent = `${storageNum} ${storageUnit} on this Mac`;
  body.appendChild(footer);

  container.innerHTML = '';
  container.appendChild(root);
}

// ---- helpers ---------------------------------------------------------------

function groupByDaySection(memories) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfThisWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  const today = [];
  const yesterday = [];
  const thisWeek = [];
  const older = [];

  for (const m of memories) {
    const d = fmt.parseSqliteIso(m.created_at);
    const ts = d ? d.getTime() : 0;
    if (ts >= startOfToday)         today.push(m);
    else if (ts >= startOfYesterday) yesterday.push(m);
    else if (ts >= startOfThisWeek)  thisWeek.push(m);
    else                              older.push(m);
  }

  const out = [];
  if (today.length)     out.push(['Today', today]);
  if (yesterday.length) out.push(['Yesterday', yesterday]);
  if (thisWeek.length)  out.push(['Earlier this week', thisWeek]);
  if (older.length)     out.push(['Older', older]);
  return out;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
