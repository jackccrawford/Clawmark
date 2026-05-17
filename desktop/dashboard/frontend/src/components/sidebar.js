// sidebar.js — left navigation with brand, nav groups, and footer signature.

import { navigate, subscribe, getState } from '../store.js';

const NAV_ITEMS = [
  {
    group: 'memory',
    surfaces: [
      { id: 'recent', label: 'Recent', icon: 'clock', count: (s) => s.totalMemories },
      { id: 'find', label: 'Find', icon: 'search' },
      { id: 'add', label: 'Add files', icon: 'upload' },
    ],
  },
  {
    group: 'workspace',
    label: 'Workspace',
    surfaces: [
      { id: 'status', label: 'Status', icon: 'check' },
      { id: 'data', label: 'Data & export', icon: 'database' },
      { id: 'settings', label: 'Settings', icon: 'gear' },
    ],
  },
];

const ICONS = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m5.66 5.66 4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m5.66-5.66 4.24-4.24"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

export function sidebar({ version, stats }) {
  const aside = document.createElement('aside');
  aside.className = 'sidebar';

  const brand = `
    <div class="sidebar-brand">
      <img src="assets/geniuz-mark.svg" alt="" class="sb-logo" />
      <div>
        <div class="sb-name">Geniuz</div>
        <div class="sb-version">v${version || '—'}</div>
      </div>
    </div>
  `;

  const renderGroup = (group) => {
    const items = group.surfaces.map((item) => {
      const isActive = item.id === getState().currentSurface;
      const count = item.count ? item.count(stats) : null;
      const countHtml = count != null ? `<span class="ni-count">${count}</span>` : '';
      return `
        <a class="nav-item ${isActive ? 'active' : ''}" data-surface="${item.id}" href="#${item.id}">
          ${ICONS[item.icon] || ''}
          ${item.label}
          ${countHtml}
        </a>
      `;
    }).join('');
    const label = group.label ? `<div class="nav-group-label">${group.label}</div>` : '';
    return `<div class="nav-group">${label}${items}</div>`;
  };

  aside.innerHTML = `
    ${brand}
    ${NAV_ITEMS.map(renderGroup).join('')}
    <div class="sidebar-footer">
      <span class="local-signature">
        <span class="dot"></span>
        local <span class="sep">·</span> private <span class="sep">·</span> yours
      </span>
    </div>
  `;

  aside.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const surface = el.dataset.surface;
      if (surface) navigate(surface);
    });
  });

  subscribe((s) => {
    aside.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.surface === s.currentSurface);
    });
  });

  return aside;
}
