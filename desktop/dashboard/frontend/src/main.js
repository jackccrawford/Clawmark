// main.js — entry point. Bootstraps the app, mounts sidebar, routes surfaces.

import * as api from './api.js';
import { sidebar } from './components/sidebar.js';
import * as recent from './surfaces/recent.js';
import * as detail from './surfaces/detail.js';
import * as find from './surfaces/find.js';
import * as status from './surfaces/status.js';
import * as placeholder from './surfaces/placeholder.js';
import { subscribe, getState, setState } from './store.js';

// Tag the document so CSS can target Tauri-specific rules.
if (window.__TAURI__) {
  document.documentElement.classList.add('is-tauri');
}

const SURFACE_MOUNTS = {
  recent: recent.mount,
  detail: detail.mount,
  find: find.mount,
  status: status.mount,
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

let renderToken = 0;
let lastRenderKey = null;
async function renderSurface(mainHost) {
  const s = getState();
  // Re-render when surface OR the surface-specific input changes
  // (selectedMemoryUuid for detail, searchQuery for find).
  const key = `${s.currentSurface}|${s.selectedMemoryUuid || ''}|${s.searchQuery || ''}`;
  if (key === lastRenderKey) return;
  lastRenderKey = key;
  const myToken = ++renderToken;
  const mounter = SURFACE_MOUNTS[s.currentSurface];
  if (mounter) {
    await mounter(mainHost);
  } else {
    await placeholder.mount(mainHost, s.currentSurface);
  }
  // If another render started while we were mounting, defer to it.
  if (myToken !== renderToken) return;
}

bootstrap();
