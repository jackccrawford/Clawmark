// tauri-bridge.js — Tauri-specific frontend bootstrap.
//
// Replaces [data-version-display] elements with the live build's version
// from Cargo.toml via env!("CARGO_PKG_VERSION"), so the displayed version
// can never drift from the binary's version. Falls back silently if Tauri
// is not present (e.g. opening the HTML directly in a browser).

// Mark the document as running inside Tauri so CSS can hide
// browser-preview-only chrome (fake traffic lights, max-width framing).
// Set on <html> before paint so there's no flash of fake chrome.
if (typeof window !== 'undefined' && window.__TAURI__) {
  document.documentElement.classList.add('is-tauri');
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!window.__TAURI__) return;
  try {
    const { invoke } = window.__TAURI__.core;
    const v = await invoke('get_app_version');
    document.querySelectorAll('[data-version-display]').forEach((el) => {
      el.textContent = `v${v}`;
    });
  } catch (_e) {
    // Leave hardcoded fallback in place.
  }
});
