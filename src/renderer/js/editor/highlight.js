// A small syntax highlighter for code blocks. Pure: text in, tokens out.
//
// tokenize(text, lang) -> [{ t, k }] where k is kw | str | com | num | fn | punct
// | plain, and the tokens always add up to exactly the input text (the code
// block lays them over a textarea, so they must line up character for character).
// Hand-written lexers for a handful of language families; not a parser, so an
// unusual construct may be coloured plainly, but it is never changed.

export const CODE_LANGS = ['plain', 'javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'c', 'cpp',
  'csharp', 'java', 'go', 'rust', 'sql', 'markdown'];
export const LANG_NAMES = { plain: 'Plain text', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', html: 'HTML', css: 'CSS',
  json: 'JSON', bash: 'Bash', c: 'C', cpp: 'C++', csharp: 'C#', java: 'Java', go: 'Go', rust: 'Rust', sql: 'SQL', markdown: 'Markdown' };

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
const JS = 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await static get set null true false undefined';
const C = 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL';

const KEYWORDS = {
  javascript: words(JS),
  typescript: words(JS + ' interface type enum implements namespace declare readonly abstract public private protected as any number string boolean unknown never keyof'),
  python: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self'),
  bash: words('if then else elif fi for while do done case esac in function select until return exit export local echo cd'),
  c: words(C),
  cpp: words(C + ' class namespace template typename public private protected virtual new delete this try catch throw using bool true false nullptr override final constexpr auto std'),
  csharp: words('abstract as base bool break byte case catch char class const continue decimal default delegate do double else enum event false finally float for foreach if in int interface internal is lock long namespace new null object out override private protected public readonly ref return sealed short static string struct switch this throw true try typeof uint ulong using var virtual void while async await'),
  java: words('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void volatile while'),
  go: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'),
  rust: words('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'),
  sql: words('select from where and or not insert into values update set delete create table alter drop index join inner left right outer on group by order having limit offset as distinct null is in like between union all case when then else end primary key foreign references default'),
  json: words('true false null'),
};

const CONFIG = {
  javascript: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'", '`'] },
  typescript: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'", '`'] },
  python: { line: ['#'], strings: ['"', "'"], triple: true },
  bash: { line: ['#'], strings: ['"', "'", '`'] },
  c: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'"] },
  cpp: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'"] },
  csharp: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'"] },
  java: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'"] },
  go: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'", '`'] },
  rust: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'"] },
  sql: { line: ['--'], block: ['/*', '*/'], strings: ["'", '"'], nocase: true },
  json: { strings: ['"'], keys: true },
  css: { block: ['/*', '*/'], strings: ['"', "'"], css: true },
};

const PUNCT = /[{}()[\];,.<>+\-*/%=!&|^~?:@#]/;
const IDENT = /[A-Za-z_$][\w$-]*/y;
const IDENT_PLAIN = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;

function lex(text, cfg, kw) {
  const out = [];
  const n = text.length;
  let i = 0;
  const push = (t, k) => { if (t) out.push({ t, k }); };
  const nextNonSpace = (j) => { while (j < n && (text[j] === ' ' || text[j] === '\t')) j += 1; return text[j]; };
  outer: while (i < n) {
    const c = text[i];
    for (const lc of cfg.line || []) {
      if (text.startsWith(lc, i)) {
        const j = text.indexOf('\n', i);
        const end = j < 0 ? n : j;
        push(text.slice(i, end), 'com');
        i = end;
        continue outer;
      }
    }
    if (cfg.block && text.startsWith(cfg.block[0], i)) {
      const j = text.indexOf(cfg.block[1], i + cfg.block[0].length);
      const end = j < 0 ? n : j + cfg.block[1].length;
      push(text.slice(i, end), 'com');
      i = end;
      continue;
    }
    if (cfg.triple && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const q = text.slice(i, i + 3);
      const j = text.indexOf(q, i + 3);
      const end = j < 0 ? n : j + 3;
      push(text.slice(i, end), 'str');
      i = end;
      continue;
    }
    if ((cfg.strings || []).includes(c)) {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '\n' && c !== '`') break;
        j += 1;
      }
      const end = Math.min(n, j + 1);
      const s = text.slice(i, end);
      // A JSON key (a string before a colon) reads as a name.
      push(s, cfg.keys && nextNonSpace(end) === ':' ? 'fn' : 'str');
      i = end;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(text[i + 1] || ''))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      if (m && m.index === i) {
        let end = i + m[0].length;
        // CSS units stay with their number (12px, 50%).
        if (cfg.css) while (end < n && /[a-z%]/i.test(text[end])) end += 1;
        push(text.slice(i, end), 'num');
        i = end;
        continue;
      }
    }
    if (cfg.css && c === '#' && /[0-9a-fA-F]/.test(text[i + 1] || '')) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(text[j])) j += 1;
      push(text.slice(i, j), 'num');
      i = j;
      continue;
    }
    if (cfg.css && c === '@') {
      IDENT.lastIndex = i + 1;
      const m = IDENT.exec(text);
      if (m && m.index === i + 1) { push(text.slice(i, i + 1 + m[0].length), 'kw'); i += 1 + m[0].length; continue; }
    }
    if (/[A-Za-z_$]/.test(c)) {
      const re = cfg.css ? IDENT : IDENT_PLAIN;
      re.lastIndex = i;
      const m = re.exec(text);
      const word = m[0];
      const key = cfg.nocase ? word.toLowerCase() : word;
      let k = 'plain';
      if (kw && kw.has(key)) k = 'kw';
      else if (cfg.css) k = nextNonSpace(i + word.length) === ':' ? 'fn' : 'plain';
      else if (nextNonSpace(i + word.length) === '(') k = 'fn';
      push(word, k);
      i += word.length;
      continue;
    }
    push(c, PUNCT.test(c) ? 'punct' : 'plain');
    i += 1;
  }
  return out;
}

function html(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  const push = (t, k) => { if (t) out.push({ t, k }); };
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const j = text.indexOf('-->', i + 4);
      const end = j < 0 ? n : j + 3;
      push(text.slice(i, end), 'com');
      i = end;
    } else if (text[i] === '<' && /[A-Za-z/!]/.test(text[i + 1] || '')) {
      let j = i + 1;
      push('<', 'punct');
      if (text[j] === '/') { push('/', 'punct'); j += 1; }
      const m = /[A-Za-z!][\w:-]*/y;
      m.lastIndex = j;
      const name = m.exec(text);
      if (name && name.index === j) { push(name[0], 'kw'); j += name[0].length; }
      // Attributes, until the tag closes.
      while (j < n && text[j] !== '>') {
        const c = text[j];
        if (c === '"' || c === "'") {
          const e = text.indexOf(c, j + 1);
          const end = e < 0 ? n : e + 1;
          push(text.slice(j, end), 'str');
          j = end;
        } else if (/[A-Za-z_:@-]/.test(c)) {
          const a = /[\w:@.-]+/y;
          a.lastIndex = j;
          const w = a.exec(text);
          push(w[0], 'fn');
          j += w[0].length;
        } else { push(c, c === '=' || c === '/' ? 'punct' : 'plain'); j += 1; }
      }
      if (j < n) { push('>', 'punct'); j += 1; }
      i = j;
    } else {
      const j = text.indexOf('<', i + 1);
      const end = j < 0 ? n : j;
      push(text.slice(i, end), 'plain');
      i = end;
    }
  }
  return out;
}

function markdown(text) {
  const out = [];
  for (const line of text.split(/(?<=\n)/)) {
    const m = /^(\s*(?:#{1,6}\s|[-*+]\s|>\s|\d+\.\s))/.exec(line);
    let rest = line;
    if (m) { out.push({ t: m[1], k: 'kw' }); rest = line.slice(m[1].length); }
    const parts = rest.split(/(`[^`\n]*`|\*\*[^*\n]+\*\*|\[[^\]\n]*\]\([^)\n]*\))/);
    for (const p of parts) {
      if (!p) continue;
      out.push({ t: p, k: p.startsWith('`') ? 'str' : p.startsWith('**') ? 'fn' : p.startsWith('[') ? 'num' : 'plain' });
    }
  }
  return out;
}

export function tokenize(text, lang) {
  if (!text) return [];
  if (lang === 'html') return html(text);
  if (lang === 'markdown') return markdown(text);
  if (lang === 'plain' || !CONFIG[lang] && lang !== 'css') return [{ t: text, k: 'plain' }];
  return lex(text, CONFIG[lang], KEYWORDS[lang]);
}
