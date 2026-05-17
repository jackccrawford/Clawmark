// activityChart.js — 14-bar daily-counts histogram.

export function activityChart({ days, labels }) {
  const el = document.createElement('div');
  el.className = 'activity-chart';
  if (!days || days.length === 0) {
    el.innerHTML = `<div class="ac-empty">No activity in this window.</div>`;
    return el;
  }
  const max = Math.max(1, ...days);
  const bars = days
    .map((v, i) => {
      const peak = v === max && v > 0 ? ' peak' : '';
      const heightPct = (v / max) * 100;
      const label = labels && labels[i] ? labels[i] : '';
      return `<div class="bar${peak}" style="height:${heightPct}%" title="${v} memories${label ? ` · ${label}` : ''}"></div>`;
    })
    .join('');
  el.innerHTML = `<div class="bars" id="activityBars">${bars}</div>`;
  return el;
}
