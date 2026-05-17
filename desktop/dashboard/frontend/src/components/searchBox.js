// searchBox.js — search input with debounced semantic-search invocation.

export function searchBox({ onQuery, placeholder = 'Search your memories…' }) {
  const wrap = document.createElement('div');
  wrap.className = 'search-field';
  wrap.style.minWidth = '280px';
  wrap.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
    <input type="text" placeholder="${placeholder}" />
    <kbd>⌘K</kbd>
  `;
  const input = wrap.querySelector('input');
  let timer = null;
  input.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onQuery(q), 250);
  });
  return wrap;
}
