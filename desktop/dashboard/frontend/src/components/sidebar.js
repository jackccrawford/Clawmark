// sidebar.js — left navigation in Tool register.
// Compact rows, system-icon style, active state via subtle background + accent
// on the icon. Brand at top, footer signature at bottom.

import { navigate, subscribe, getState } from '../store.js';

const NAV_ITEMS = [
  {
    surfaces: [
      { id: 'recent',   label: 'Memories', icon: 'clock',     count: (s) => s.totalMemories },
      { id: 'remember', label: 'Remember', icon: 'plus' },
      { id: 'find',     label: 'Find',     icon: 'search' },
    ],
  },
  {
    label: 'Workspace',
    surfaces: [
      { id: 'status',   label: 'Status',         icon: 'check' },
      { id: 'data',     label: 'Data & export',  icon: 'database' },
      { id: 'settings', label: 'Settings',       icon: 'gear' },
    ],
  },
];

const ICONS = {
  plus:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  clock:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  search:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>',
  check:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6"/></svg>',
  gear:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  wave:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2 0 2-4 4-4s2 8 4 8 2-10 4-10 2 6 4 6 2-2 4-2"/></svg>',
};

export function sidebar({ version, stats }) {
  const aside = document.createElement('aside');
  aside.className = 'sidebar';

  const brand = document.createElement('div');
  brand.className = 'sidebar-brand';
  brand.innerHTML = `
    <span class="sidebar-brand__mark">${ICONS.wave}</span>
    <span class="sidebar-brand__name">Geniuz</span>
    <span class="sidebar-brand__version">${version ? `v${version}` : ''}</span>
  `;
  aside.appendChild(brand);

  // Track all rendered button elements so we can update active state on
  // store changes without re-rendering the DOM.
  const buttons = [];

  for (const section of NAV_ITEMS) {
    const sec = document.createElement('div');
    sec.className = 'sidebar-section';
    if (section.label) {
      const lbl = document.createElement('div');
      lbl.className = 'sidebar-section__label';
      lbl.textContent = section.label;
      sec.appendChild(lbl);
    }
    for (const item of section.surfaces) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-item';
      btn.dataset.surface = item.id;
      const count = item.count ? item.count(stats || {}) : null;
      btn.innerHTML = `
        <span class="sidebar-item__icon">${ICONS[item.icon] || ''}</span>
        <span class="sidebar-item__label">${item.label}</span>
        ${count != null ? `<span class="sidebar-item__count">${count}</span>` : ''}
      `;
      btn.addEventListener('click', () => navigate(item.id));
      buttons.push(btn);
      sec.appendChild(btn);
    }
    aside.appendChild(sec);
  }

  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';
  footer.innerHTML = `
    <span class="sidebar-footer__dot"></span>
    <span>local · private · yours</span>
  `;
  aside.appendChild(footer);

  const applyActive = (currentSurface) => {
    for (const b of buttons) {
      b.classList.toggle('is-active', b.dataset.surface === currentSurface);
    }
  };
  applyActive(getState().currentSurface);
  subscribe((s) => applyActive(s.currentSurface));

  return aside;
}
