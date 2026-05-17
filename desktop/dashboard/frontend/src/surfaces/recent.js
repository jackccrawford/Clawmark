// recent.js — the default surface. Stats, recent memories, activity, folder panel.

import * as api from '../api.js';
import * as fmt from '../format.js';
import { statCard } from '../components/statCard.js';
import { memoryItem } from '../components/memoryItem.js';
import { searchBox } from '../components/searchBox.js';
import { activityChart } from '../components/activityChart.js';
import { folderPanel } from '../components/folderPanel.js';

export async function mount(container) {
  container.innerHTML = `
    <div class="surface-loading">Loading your memory…</div>
  `;

  // Parallel data fetches — one round-trip per concern, all canonical-handler calls.
  let stats, recent, activity;
  try {
    [stats, recent, activity] = await Promise.all([
      api.getStationStats(),
      api.getRecentMemories(24),
      api.getActivity(14),
    ]);
  } catch (e) {
    container.innerHTML = `
      <div class="surface-error">
        <h2>Couldn't read your station.</h2>
        <p>${e.message || e}</p>
        <p>Expected file: <code>~/.geniuz/memory.db</code></p>
      </div>
    `;
    return;
  }

  const [storageNum, storageUnit] = fmt.bytes(stats.storage_bytes);

  // ---- Build the layout ------------------------------------------------
  const root = document.createElement('main');
  root.className = 'main';

  // Header
  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <div>
      <h1>Your memory</h1>
      <p class="mh-sub">Saved by your AI agents <span style="color:var(--color-ink-senary)">·</span> stored on this Mac <span style="color:var(--color-ink-senary)">·</span> searchable by meaning</p>
    </div>
    <div class="mh-actions"></div>
  `;
  const actions = header.querySelector('.mh-actions');
  actions.appendChild(
    searchBox({
      placeholder: 'Search your memories…',
      onQuery: (q) => handleSearch(q, listEl, metaEl, stats),
    })
  );

  // Stat row
  const statRow = document.createElement('div');
  statRow.className = 'stat-row';
  statRow.appendChild(
    statCard({
      label: 'Total memories',
      value: fmt.number(stats.total_memories),
      meta: `+${fmt.number(stats.this_week)} last 7 days · ~${fmt.dayPer(stats.daily_average_recent)}/day average`,
      featured: true,
    })
  );
  statRow.appendChild(
    statCard({
      label: 'This week',
      value: fmt.number(stats.this_week),
      meta: 'across 7 days',
    })
  );
  statRow.appendChild(
    statCard({
      label: 'Ongoing topics',
      value: fmt.number(stats.conversations),
    })
  );
  statRow.appendChild(
    statCard({
      label: 'Storage used',
      valueHtml: `${storageNum}<span style="font-size:0.6em;color:var(--color-ink-tertiary);font-weight:500;margin-left:4px;">${storageUnit}</span>`,
      meta: 'on this Mac',
    })
  );

  // Content row: memory list + folder panel
  const body = document.createElement('div');
  body.className = 'main-body';
  body.innerHTML = `
    <div class="content-col">
      <div class="content-head">
        <h2>Recent memories</h2>
        <div class="filter-meta" id="filterMeta"></div>
      </div>
      <div class="memory-list" id="memoryList"></div>
    </div>
    <div class="side-col" id="sideCol"></div>
  `;
  const listEl = body.querySelector('#memoryList');
  const metaEl = body.querySelector('#filterMeta');
  const sideCol = body.querySelector('#sideCol');

  // Folder panel
  sideCol.appendChild(folderPanel({ stats }));

  // Activity chart in the side column
  const activityWrap = document.createElement('div');
  activityWrap.className = 'side-panel';
  activityWrap.innerHTML = '<div class="sp-title">Activity · 14 days</div>';
  const activityDays = expandDaysIntoFull(activity, 14);
  activityWrap.appendChild(activityChart({ days: activityDays }));
  sideCol.appendChild(activityWrap);

  // Footer
  const footer = document.createElement('footer');
  footer.className = 'main-footer';
  footer.innerHTML = `
    <span>${fmt.number(stats.total_memories)} memories indexed</span>
    <span class="local-signature">
      <span class="dot"></span>
      local <span class="sep">·</span> private <span class="sep">·</span> yours
    </span>
  `;

  // Render the initial recent list
  renderList(listEl, recent, metaEl, stats.total_memories, 'sorted by recency');

  // ---- Mount ----------------------------------------------------------
  root.appendChild(header);
  root.appendChild(statRow);
  root.appendChild(body);
  root.appendChild(footer);
  container.innerHTML = '';
  container.appendChild(root);
}

// Render the list with the given memories.
function renderList(listEl, memories, metaEl, total, captionTail) {
  listEl.innerHTML = '';
  if (!memories || memories.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No memories to show.</div>';
    if (metaEl) metaEl.textContent = '';
    return;
  }
  for (const m of memories) listEl.appendChild(memoryItem(m));
  if (metaEl) {
    metaEl.textContent = `${memories.length} of ${total != null ? fmt.number(total) : '?'} ${captionTail}`;
  }
}

// Search handler. Empty query restores recent.
async function handleSearch(query, listEl, metaEl, stats) {
  if (!query) {
    try {
      const recent = await api.getRecentMemories(24);
      renderList(listEl, recent, metaEl, stats.total_memories, 'sorted by recency');
    } catch (e) {
      console.error('[geniuz] recent reload failed:', e);
    }
    return;
  }
  try {
    const results = await api.semanticSearch(query, 20);
    listEl.innerHTML = '';
    if (results.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No matches for "${escapeHtml(query)}".</div>`;
    } else {
      for (const r of results) listEl.appendChild(memoryItem(r));
    }
    if (metaEl) {
      metaEl.textContent = `${results.length} matches for "${query}" · ranked by meaning`;
    }
  } catch (e) {
    console.error('[geniuz] semantic_search failed:', e);
    if (metaEl) metaEl.textContent = `Search failed: ${e.message || e}`;
  }
}

// Given activity buckets (date, count) for days that had activity, expand to
// a length-N array (oldest first) with zeros filled for missing days.
function expandDaysIntoFull(buckets, days) {
  if (!buckets) return [];
  const map = new Map(buckets.map((b) => [b.date, b.count]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push(map.get(iso) || 0);
  }
  return out;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
