// store.js — minimal pub/sub state container.
// Single source of truth for cross-surface app state. Components subscribe
// to changes; surfaces dispatch via setState.

const state = {
  currentSurface: 'recent', // 'recent' | 'detail' | 'find' | 'status' | 'settings' | 'data'
  selectedMemoryUuid: null, // when on 'detail' surface
  searchQuery: '',          // active search query (empty = recent view)
  appVersion: null,         // set on bootstrap
  dataDir: null,            // set on bootstrap
  // Recent surface sort direction. 'desc' = newest first (default), 'asc' = oldest first.
  // Memory numbers stay stable per memory regardless of direction.
  sortDirection: 'desc',
  // Where to return when the user backs out of detail. Set by `navigate()`
  // before switching to detail; the Detail surface's back button reads it.
  returnTo: 'recent',
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// navigate — when switching to 'detail', remember where we came from so the
// Back button has somewhere to send the user. When leaving detail (or
// navigating from sidebar), reset returnTo to the natural fallback.
export function navigate(surface, extras = {}) {
  const current = state.currentSurface;
  let returnTo = state.returnTo;
  if (surface === 'detail' && current !== 'detail') {
    returnTo = current;
  } else if (surface !== 'detail') {
    returnTo = surface;
  }
  setState({ currentSurface: surface, returnTo, ...extras });
}
