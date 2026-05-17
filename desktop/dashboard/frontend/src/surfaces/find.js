// find.js — dedicated semantic-search surface.
// Large prominent input, mode toggle (semantic | keyword), ranked results.
// Mirrors recent.js's .main / .main-header / .main-body shape.

import * as api from '../api.js';
import { memoryItem } from '../components/memoryItem.js';
import { getState, setState } from '../store.js';

const MODES = {
  semantic: { label: 'Semantic', caption: 'ranked by meaning', call: api.semanticSearch },
  keyword: { label: 'Keyword', caption: 'ranked by keyword density', call: api.keywordSearch },
};

const DEBOUNCE_MS = 220;
const MIN_QUERY_LEN = 2;
const RESULT_LIMIT = 20;

export async function mount(container) {
  // Mount-scoped state. No globals, no DOM-mounted lifecycle hooks — we use a
  // local `stillMounted` flag to drop late results when the surface is replaced.
  let stillMounted = true;
  let mode = 'semantic';
  let query = (getState().searchQuery || '').trim();
  let debounceTimer = null;
  let inFlight = 0; // monotonic counter; ignore replies older than the latest.

  const root = document.createElement('main');
  root.className = 'main';

  // ---- Header ---------------------------------------------------------
  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <div style="flex:1;">
      <h1>Find</h1>
      <p class="mh-sub">Search your memory by meaning — or fall back to plain keywords.</p>
      <div class="filter-row" id="modeRow" style="margin-top:12px;margin-bottom:0;"></div>
    </div>
  `;
  const modeRow = header.querySelector('#modeRow');
  const chips = {};
  for (const key of Object.keys(MODES)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip' + (key === mode ? ' active' : '');
    chip.textContent = MODES[key].label;
    chip.addEventListener('click', () => {
      if (mode === key) return;
      mode = key;
      for (const k of Object.keys(chips)) chips[k].classList.toggle('active', k === mode);
      // Rerun against current query immediately (no debounce when toggling).
      runSearch(query, /* immediate */ true);
    });
    chips[key] = chip;
    modeRow.appendChild(chip);
  }

  // ---- Body -----------------------------------------------------------
  const body = document.createElement('div');
  body.className = 'main-body';
  body.innerHTML = `
    <div class="content-col" style="max-width:760px;margin:0 auto;width:100%;">
      <div class="search-field" id="findInput" style="padding:14px 18px;margin-bottom:16px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" placeholder="Search your memories…" style="font-size:var(--fs-16);" />
      </div>
      <div class="filter-meta" id="findMeta" style="margin-bottom:12px;min-height:18px;"></div>
      <div class="memory-list" id="findList"></div>
    </div>
  `;
  const inputWrap = body.querySelector('#findInput');
  const input = inputWrap.querySelector('input');
  const metaEl = body.querySelector('#findMeta');
  const listEl = body.querySelector('#findList');

  input.value = query;
  input.addEventListener('input', (e) => {
    query = e.target.value.trim();
    // Persist so navigating to detail and back restores the query.
    setState({ searchQuery: query });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  });

  // ---- Initial paint --------------------------------------------------
  root.appendChild(header);
  root.appendChild(body);
  container.innerHTML = '';
  container.appendChild(root);

  // Auto-focus once in the DOM; place cursor at end of any restored query.
  input.focus();
  if (query) {
    input.setSelectionRange(query.length, query.length);
    runSearch(query, /* immediate */ true);
  } else {
    renderEmpty();
  }

  // Surface tear-down: when the container's contents are replaced (router
  // swaps surfaces), our node detaches. Watch for that and flip stillMounted.
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      stillMounted = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      observer.disconnect();
    }
  });
  if (container.parentNode) observer.observe(container, { childList: true });

  // ---- Search ---------------------------------------------------------
  async function runSearch(q, immediate = false) {
    if (immediate && debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!q || q.length < MIN_QUERY_LEN) {
      renderEmpty();
      return;
    }
    const myTicket = ++inFlight;
    renderSearching(q);
    let results;
    try {
      results = await MODES[mode].call(q, RESULT_LIMIT);
    } catch (e) {
      if (!stillMounted || myTicket !== inFlight) return;
      renderError(q, e);
      return;
    }
    if (!stillMounted || myTicket !== inFlight) return;
    renderResults(q, results);
  }

  // ---- Render states --------------------------------------------------
  function renderEmpty() {
    metaEl.textContent = '';
    listEl.innerHTML = `
      <div class="empty-state" style="padding:48px 24px;text-align:center;">
        <div style="font-size:var(--fs-14);color:var(--color-ink-tertiary);max-width:480px;margin:0 auto;line-height:1.5;">
          Type to search semantically across all your memories.<br/>
          Results are ranked by meaning, not keyword overlap.
        </div>
      </div>
    `;
  }

  function renderSearching(q) {
    metaEl.textContent = `Searching for "${q}"…`;
  }

  function renderResults(q, results) {
    listEl.innerHTML = '';
    if (!results || results.length === 0) {
      const alt = mode === 'semantic' ? 'try keyword mode or a different phrasing' : 'try fewer terms or switch to semantic';
      metaEl.textContent = `No matches for "${q}"`;
      listEl.innerHTML = `
        <div class="empty-state" style="padding:36px 24px;text-align:center;">
          <div style="font-size:var(--fs-14);color:var(--color-ink-tertiary);">
            No matches for "${escapeHtml(q)}" — ${alt}.
          </div>
        </div>
      `;
      return;
    }
    metaEl.textContent = `${results.length} match${results.length === 1 ? '' : 'es'} for "${q}" · ${MODES[mode].caption}`;
    for (const r of results) listEl.appendChild(memoryItem(r));
  }

  function renderError(q, err) {
    metaEl.textContent = `Search failed for "${q}"`;
    listEl.innerHTML = `
      <div class="surface-error" style="padding:24px;">
        <p>Search failed: ${escapeHtml(err && err.message ? err.message : String(err))}</p>
        <p style="color:var(--color-ink-tertiary);font-size:var(--fs-13);">Try again, or switch search mode.</p>
      </div>
    `;
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
