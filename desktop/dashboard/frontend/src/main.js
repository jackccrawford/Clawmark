// main.js — entry point. Bootstraps the app, mounts sidebar, routes surfaces.

import * as api from './api.js';
import { sidebar } from './components/sidebar.js';
import * as recent from './surfaces/recent.js';
import * as placeholder from './surfaces/placeholder.js';
import { subscribe, getState, setState } from './store.js';

// Tag the document so CSS can target Tauri-specific rules.
if (window.__TAURI__) {
  document.documentElement.classList.add('is-tauri');
}

const SURFACE_MOUNTS = {
  recent: recent.mount,
};

async function bootstrap() {
  // Bootstrap meta first so the sidebar knows the version + counts.
  let version = '—';
  let dataDir = null;
  let stats = { total_memories: null, conversations: null };
  if (api.isTauri()) {
    try {
      [version, dataDir, stats] = await Promise.all([
        api.getAppVersion(),
        api.getDataDir(),
        api.getStationStats(),
      ]);
    } catch (e) {
      console.error('[geniuz] bootstrap failed:', e);
    }
  }
  setState({ appVersion: version, dataDir });

  // Sidebar
  const appShell = document.getElementById('app-shell');
  appShell.innerHTML = '';
  const aside = sidebar({
    version,
    stats: { totalMemories: stats.total_memories ?? null },
  });
  appShell.appendChild(aside);

  // Main mount target
  const mainHost = document.createElement('div');
  mainHost.id = 'main-host';
  mainHost.style.flex = '1';
  mainHost.style.minWidth = '0';
  mainHost.style.display = 'flex';
  mainHost.style.flexDirection = 'column';
  appShell.appendChild(mainHost);

  // Render the current surface, and re-render whenever it changes.
  await renderSurface(mainHost);
  subscribe((s) => renderSurface(mainHost));
}

let lastSurface = null;
async function renderSurface(mainHost) {
  const s = getState();
  if (s.currentSurface === lastSurface) return; // avoid spurious re-renders
  lastSurface = s.currentSurface;
  const mounter = SURFACE_MOUNTS[s.currentSurface];
  if (mounter) {
    await mounter(mainHost);
  } else {
    await placeholder.mount(mainHost, s.currentSurface);
  }
}

bootstrap();
