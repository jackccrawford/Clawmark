// md.js — minimal markdown renderer for memory gists and content.
// Handles **bold**, *italic*, `code`, ==highlight==, and [TAG] prefixes.
// HTML-escapes input first; safe to embed in innerHTML.

export function renderMd(txt) {
  if (!txt) return '';
  // 1. HTML-escape
  let s = txt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Protect code spans with a sentinel so later regexes don't munge them
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `CODE${codes.length - 1}`;
  });

  // 3. [TAG] prefix at start of string
  s = s.replace(/^\[([A-Z][A-Z\s]+)\]\s*/, (_, tag) => {
    const cls = 'tp-' + tag.toLowerCase().replace(/\s+/g, '');
    return `<span class="tag-prefix ${cls}">${tag.trim()}</span>`;
  });

  // 4. Bold, italic (italic avoids eating ** by requiring non-* boundary), highlight
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');

  // 5. Restore code spans
  s = s.replace(/CODE(\d+)/g, (_, i) => `<code>${codes[+i]}</code>`);

  return s;
}
