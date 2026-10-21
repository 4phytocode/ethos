// The homepage quote.
//
// The list is curated and bundled. BrainyQuote blocks automated requests (it
// answers 403 and offers no public API), and ZenQuotes' free API returns quotes
// on any topic, so it cannot be restricted to motivational ones. A local list
// is the only source that can guarantee the subject.
//
// Each launch picks one at random, avoiding the one shown last time. The last
// pick is kept in localStorage; if that is unavailable the choice is still
// random, just without the repeat check.

const QUOTES = [
  {
    text: 'The impediment to action advances action. What stands in the way becomes the way.',
    author: 'Marcus Aurelius',
  },
  {
    text: 'I learned that courage was not the absence of fear, but the triumph over it.',
    author: 'Nelson Mandela',
  },
  {
    text: 'The only way to do great work is to love what you do.',
    author: 'Steve Jobs',
  },
  {
    text: 'You gain strength, courage, and confidence by every experience in which you really stop to look fear in the face.',
    author: 'Eleanor Roosevelt',
  },
  {
    text: 'Fail again. Fail better.',
    author: 'Samuel Beckett',
  },
  {
    text: 'Although the world is full of suffering, it is also full of the overcoming of it.',
    author: 'Helen Keller',
  },
];

const LAST_KEY = 'ethos.lastQuote';

function lastIndex() {
  try {
    const n = Number(localStorage.getItem(LAST_KEY));
    return Number.isInteger(n) && n >= 0 && n < QUOTES.length ? n : -1;
  } catch { return -1; }
}

function pick() {
  const avoid = lastIndex();
  // With a list this short, a fixed retry would be overkill; choose from the
  // rest directly.
  const pool = QUOTES.map((_, i) => i).filter(i => i !== avoid);
  const index = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(LAST_KEY, String(index)); } catch { /* ignore */ }
  return QUOTES[index];
}

export function initQuote() {
  const root = document.getElementById('home-quote');
  if (!root) return;
  const q = pick();
  root.querySelector('.quote-text').textContent = '“' + q.text + '”';
  root.querySelector('.quote-author').textContent = '— ' + q.author;
}
