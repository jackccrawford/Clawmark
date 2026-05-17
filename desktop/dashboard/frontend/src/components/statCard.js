// statCard.js — one stat tile.

export function statCard({ label, value, valueHtml, meta, featured = false, sparkline = null }) {
  const el = document.createElement('div');
  el.className = 'stat-card' + (featured ? ' featured' : '');
  const num = valueHtml ? `<div class="sc-num">${valueHtml}</div>` : `<div class="sc-num">${value ?? '—'}</div>`;
  const metaRow = meta ? `<div class="sc-meta"><span>${meta}</span></div>` : '';
  el.innerHTML = `
    <div class="sc-label">${label}</div>
    ${num}
    ${metaRow}
    ${sparkline || ''}
  `;
  return el;
}
