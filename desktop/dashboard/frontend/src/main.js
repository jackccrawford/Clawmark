// main.js — entry point. Bootstraps the app, mounts sidebar, routes surfaces.

import * as api from './api.js';
import { sidebar } from './components/sidebar.js';
import * as recent from './surfaces/recent.js';
import * as detail from './surfaces/detail.js';
import * as find from './surfaces/find.js';
import * as status from './surfaces/status.js';
import * as settings from './surfaces/settings.js';
import * as dataSurface from './surfaces/data.js';
import * as placeholder from './surfaces/placeholder.js';
import { subscribe, getState, setState, navigate } from './store.js';

// Tag the document so CSS can target Tauri-specific rules.
if (window.__TAURI__) {
  document.documentElement.classList.add('is-tauri');
}

const SURFACE_MOUNTS = {
  recent: recent.mount,
  detail: detail.mount,
  find: find.mount,
  status: status.mount,
  settings: settings.mount,
  data: dataSurface.mount,
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

// Wire native menu events from Rust → surface navigation / actions.
// IDs match those declared in build_menu() in src/lib.rs.
async function wireMenuEvents() {
  if (!window.__TAURI__) return;
  const { listen } = window.__TAURI__.event;
  await listen('menu', async (event) => {
    const id = event.payload;
    switch (id) {
      case 'menu_recent':
        navigate('recent');
        break;
      case 'menu_find':
        navigate('find');
        break;
      case 'menu_status':
        navigate('status');
        break;
      case 'menu_settings':
        navigate('settings');
        break;
      case 'menu_export':
        navigate('data');
        break;
      case 'menu_refresh':
        // Force a re-render of the current surface by toggling the key.
        // Setting state with an unchanged value still notifies subscribers.
        setState({ _refresh: Date.now() });
        break;
      case 'menu_website':
        try {
          await api.openPath('https://geniuz.life');
        } catch (e) {
          console.error('[geniuz] open website failed:', e);
        }
        break;
      case 'menu_about':
        // Lightweight About — no modal yet; surface a console log + alert.
        // Eventually this becomes a real About panel.
        alert(`Geniuz ${getState().appVersion || ''}\nManaged Ventures LLC\nhttps://geniuz.life`);
        break;
      default:
        console.warn('[geniuz] unhandled menu event:', id);
    }
  });
}

bootstrap();
wireMenuEvents();
