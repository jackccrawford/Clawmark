// format.js — presentation helpers.
// Pure functions, no DOM, no Tauri calls. Easy to test, easy to reuse.

export function number(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString();
}

export function bytes(b) {
  if (b === null || b === undefined) return ['—', ''];
  if (b < 1024) return [b.toString(), 'B'];
  if (b < 1024 * 1024) return [(b / 1024).toFixed(1), 'KB'];
  if (b < 1024 * 1024 * 1024) return [(b / (1024 * 1024)).toFixed(1), 'MB'];
  return [(b / (1024 * 1024 * 1024)).toFixed(2), 'GB'];
}

// SQLite's datetime('now', 'utc') produces "YYYY-MM-DD HH:MM:SS" (space-separated,
// no Z). JS Date constructor parses that as local time on some browsers, UTC on
// others. Normalize by replacing space with T and appending Z if absent.
export function parseSqliteIso(s) {
  if (!s) return null;
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const withZ = /Z$|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : normalized + 'Z';
  const ms = Date.parse(withZ);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export function ago(iso, refMs = Date.now()) {
  const d = parseSqliteIso(iso);
  if (!d) return '—';
  const secs = Math.max(0, (refMs - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.round(secs / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function timeFull(iso) {
  const d = parseSqliteIso(iso);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function dayPer(rate) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return '—';
  // Round to 1 decimal, trim trailing .0
  const r = Math.round(rate * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
}
