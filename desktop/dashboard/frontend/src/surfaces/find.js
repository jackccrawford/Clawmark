// find.js — Find surface in Tool register.
//
// Large prominent input, mode toggle (Meaning | Keyword), ranked results
// rendered as the same dense .memory-row layout used by recent.js. Mode is
// local to the surface; the active query persists to the store so navigating
// to detail and back restores the input.
//
// Mirrors recent.js's discipline: mount(container) signature, escapeHtml,
// handle loading / empty / error states inside the result region.

import * as api from '../api.js';
import * as fmt from '../format.js';
import { getState, setState, navigate } from '../store.js';

const MODES = {
  semantic: {
    label: 'Meaning',
    placeholder: 'Search by meaning…',
    call: (q, n) => api.semanticSearch(q, n),
  },
  keyword: {
    label: 'Keyword',
    placeholder: 'Search by keyword…',
    call: (q, n) => api.keywordSearch(q, n),
  },
};

const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 40;

export async function mount(container) {
  // Mount-scoped state. Local `mounted` flag drops late results when the
  // router replaces this surface mid-flight.
  let mounted = true;
  let mode = 'semantic';
  let query = (getState().searchQuery || '');
  let debounceTimer = null;
  let inFlight = 0; // monotonic ticket; ignore replies older than the latest.

  // ---- Scaffold -------------------------------------------------------
  const root = document.createElement('main');
  root.className = 'main';

  const header = document.createElement('header');
  header.className = 'main-header';
  header.innerHTML = `
    <h1 class="main-header__title">Find</h1>
    <p class="main-header__sub">Search across everything you've remembered, by meaning or by word.</p>
  `;
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'main-body';
  root.appendChild(body);

  // ---- Input + mode toggle -------------------------------------------
  const inputWrap = document.createElement('div');
  inputWrap.className = 'find-input-wrap';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'find-input';
  input.placeholder = MODES[mode].placeholder;
  input.value = query;
  input.autocomplete = 'off';
  input.spellcheck = false;
  inputWrap.appendChild(input);
  body.appendChild(inputWrap);

  const toggle = document.createElement('div');
  toggle.className = 'find-mode-toggle';
  const modeButtons = {};
  for (const key of Object.keys(MODES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = MODES[key].label;
    if (key === mode) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      if (mode === key) return;
      mode = key;
      for (const k of Object.keys(modeButtons)) {
        modeButtons[k].classList.toggle('is-active', k === mode);
      }
      input.placeholder = MODES[mode].placeholder;
      // Re-run immediately against the current query on mode change.
      runSearch(query, /* immediate */ true);
      input.focus();
    });
    modeButtons[key] = btn;
    toggle.appendChild(btn);
  }
  body.appendChild(toggle);

  // ---- Results region -------------------------------------------------
  const resultsEl = document.createElement('div');
  resultsEl.className = 'find-results';
  body.appendChild(resultsEl);

  // ---- Input wiring ---------------------------------------------------
  input.addEventListener('input', (e) => {
    query = e.target.value;
    setState({ searchQuery: query });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch(input.value, /* immediate */ true);
    }
  });

  // ---- Paint ----------------------------------------------------------
  container.innerHTML = '';
  container.appendChild(root);

  // Focus and place cursor at end of any restored query.
  input.focus();
  if (query) {
    input.setSelectionRange(query.length, query.length);
    runSearch(query, /* immediate */ true);
  } else {
    renderHint();
  }

  // Surface tear-down — when the router replaces our DOM, drop in-flight work.
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      mounted = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      observer.disconnect();
    }
  });
  if (container.parentNode) observer.observe(container.parentNode, { childList: true, subtree: true });

  // ---- Search ---------------------------------------------------------
  async function runSearch(rawQ, immediate = false) {
    if (immediate && debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const q = (rawQ || '').trim();
    if (!q) {
      renderHint();
      return;
    }
    const ticket = ++inFlight;
    renderLoading();
    let results;
    try {
      results = await MODES[mode].call(q, RESULT_LIMIT);
    } catch (e) {
      if (!mounted || ticket !== inFlight) return;
      renderError(e);
      return;
    }
    if (!mounted || ticket !== inFlight) return;
    renderResults(results);
  }

  // ---- Render states --------------------------------------------------
  function renderHint() {
    resultsEl.innerHTML = `
      <div class="surface-empty">
        Type to search. Meaning ranks by semantic similarity; Keyword matches words directly.
      </div>
    `;
  }

  function renderLoading() {
    resultsEl.innerHTML = `<div class="surface-loading">Searching…</div>`;
  }

  function renderError(err) {
    resultsEl.innerHTML = `
      <div class="surface-error">
        <h2>Search failed.</h2>
        <p>${escapeHtml(err?.message || String(err))}</p>
      </div>
    `;
  }

  function renderResults(results) {
    if (!results || results.length === 0) {
      resultsEl.innerHTML = `<div class="surface-empty">No matches in your memory</div>`;
      return;
    }
    resultsEl.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'memory-list';
    for (const m of results) {
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
    resultsEl.appendChild(list);
  }
}

// ---- helpers ---------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
