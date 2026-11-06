// Ranking for the global search (js/search.js). Pure: no DOM, no state.
//
// An item is { title, body, extra, when }. `extra` is more searchable text that
// is not the body (a folder's tag names, a date). Scores, best first:
//   title is the query 100 · title starts with it 60 · a word of the title starts
//   with it 40 · title contains it 25 · every word is somewhere 12 · body or extra
//   contains it 10 · no match 0.
// Ties go to the most recent `when`.

// Lower case with accents removed, so "cafe" finds "Café".
export function norm(s) {
  return String(s === undefined || s === null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function score(item, rawQuery) {
  const q = norm(rawQuery).trim();
  if (!q) return 1;
  const title = norm(item.title);
  if (title === q) return 100;
  if (title.startsWith(q)) return 60;
  if (title.split(/[^a-z0-9]+/).some(w => w && w.startsWith(q))) return 40;
  if (title.includes(q)) return 25;
  const rest = norm((item.body || '') + ' ' + (item.extra || ''));
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every(w => title.includes(w) || rest.includes(w))) return 12;
  if (rest.includes(q)) return 10;
  return 0;
}

// The best `limit` items for the query. With no query, the most recent ones.
export function rank(items, query, limit = 50) {
  return items
    .map(item => ({ item, s: score(item, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.item.when || 0) - (a.item.when || 0))
    .slice(0, limit)
    .map(x => x.item);
}

// Where the query sits in the title, for bold: [start, end] or null. Only when
// normalising did not change the length, so the indexes still fit the real text.
export function matchRange(title, rawQuery) {
  const q = norm(rawQuery).trim();
  const t = norm(title);
  if (!q || t.length !== String(title).length) return null;
  const i = t.indexOf(q);
  return i < 0 ? null : [i, i + q.length];
}
