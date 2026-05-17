// api.js — typed wrappers around Tauri invoke calls.
// Every Tauri command the dashboard uses lives here as a named function.
// One file = one map between the JS frontend and the Rust commands in
// desktop/dashboard/src/lib.rs.

function invoke(cmd, args) {
  if (!window.__TAURI__) {
    return Promise.reject(new Error(`[api] Tauri not available; tried to call ${cmd}`));
  }
  return window.__TAURI__.core.invoke(cmd, args);
}

export const isTauri = () => !!window.__TAURI__;

export function getAppVersion() {
  return invoke('get_app_version');
}

export function getStationStats() {
  return invoke('get_station_stats');
}

export function getRecentMemories(limit = 24) {
  return invoke('get_recent_memories', { limit });
}

export function getActivity(days = 14) {
  return invoke('get_activity', { days });
}

export function semanticSearch(query, limit = 20) {
  return invoke('semantic_search', { query, limit });
}

export function keywordSearch(query, limit = 20) {
  return invoke('keyword_search', { query, limit });
}

export function getDataDir() {
  return invoke('get_data_dir');
}

export function openPath(path) {
  return invoke('plugin:opener|open_path', { path });
}
