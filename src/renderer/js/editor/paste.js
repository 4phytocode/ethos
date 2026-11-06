// Turning clipboard HTML or text into blocks.
//
// The HTML is parsed with DOMParser, which makes an inert document: scripts do
// not run and images are not fetched. Nothing from it is ever put into the page;
// it is read for headings, paragraphs, lists, quotes, code, rules, tables and
// inline marks, and everything else contributes only its text.

import * as M from './model.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'IMG', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'HEAD', 'META', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'CANVAS', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'FIGURE', 'FIGCAPTION']);
const HTTP = /^https?:\/\//i;
const MAX_ROWS = 500;
const MAX_COLS = 20;

const look = (l) => ({ ...l, m: l.m ? [...l.m] : undefined });
const addMark = (l, m) => { l.m = l.m || []; if (!l.m.includes(m)) l.m.push(m); };

function styleMarks(node, next) {
  const st = node.style;
  if (!st) return;
  const w = st.fontWeight;
  if (w === 'bold' || w === 'bolder' || Number(w) >= 600) addMark(next, 'b');
  if (st.fontStyle === 'italic') addMark(next, 'i');
  const d = st.textDecorationLine || st.textDecoration || '';
  if (d.includes('underline')) addMark(next, 'u');
  if (d.includes('line-through')) addMark(next, 's');
  if (st.verticalAlign === 'super') addMark(next, 'sup');
  if (st.verticalAlign === 'sub') addMark(next, 'sub');
}

function inline(node, l, spans) {
  if (node.nodeType === 3) {
    const t = node.nodeValue.replace(/[\r\n\t ]+/g, ' ');
    if (t) spans.push({ t, ...look(l) });
    return;
  }
  if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
  if (node.tagName === 'BR') { spans.push({ t: '\n', ...look(l) }); return; }
  const next = look(l);
  switch (node.tagName) {
    case 'STRONG': case 'B': addMark(next, 'b'); break;
    case 'EM': case 'I': addMark(next, 'i'); break;
    case 'U': addMark(next, 'u'); break;
    case 'S': case 'STRIKE': case 'DEL': addMark(next, 's'); break;
    case 'CODE': case 'KBD': case 'SAMP': addMark(next, 'code'); break;
    case 'SUP': addMark(next, 'sup'); break;
    case 'SUB': addMark(next, 'sub'); break;
    case 'A': { const h = node.getAttribute('href'); if (h && HTTP.test(h) && h.length <= 2000) next.href = h; break; }
    default: break;
  }
  styleMarks(node, next);
  for (const c of node.childNodes) inline(c, next, spans);
}

// Collapse spaces at the edges of a block.
function trimSpans(spans) {
  const out = M.normalize(spans.map(s => { const c = { ...s }; if (!c.m) delete c.m; return c; }));
  if (out.length && !M.isAtom(out[0])) out[0] = { ...out[0], t: out[0].t.replace(/^ +/, '') };
  const last = out.length - 1;
  if (last >= 0 && !M.isAtom(out[last])) out[last] = { ...out[last], t: out[last].t.replace(/ +$/, '') };
  return M.normalize(out);
}

function tableFrom(el) {
  const rows = [...el.querySelectorAll('tr')].slice(0, MAX_ROWS + 1);
  if (!rows.length) return null;
  const cells = rows.map(r => [...r.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH').slice(0, MAX_COLS).map(c => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 2000)));
  const width = Math.max(1, ...cells.map(r => r.length));
  const hasHead = rows[0].querySelector('th') !== null;
  const columns = Array.from({ length: width }, (_, i) => ({ id: M.newKey(), name: hasHead ? (cells[0][i] || '').slice(0, 40) : '', type: 'text', options: [] }));
  const body = (hasHead ? cells.slice(1) : cells).slice(0, MAX_ROWS);
  const data = body.map(r => { const row = { id: M.newKey(), cells: {} }; columns.forEach((c, i) => { if (r[i]) row.cells[c.id] = r[i]; }); return row; });
  return { id: M.newKey(), title: '', columns, rows: data };
}

// Returns { blocks, tables }.
export function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  const tables = [];

  const para = (type, node, indent, extra) => {
    const spans = [];
    for (const c of node.childNodes) {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) continue;
      inline(c, {}, spans);
    }
    blocks.push(M.newBlock(type, { spans: trimSpans(spans), indent: Math.min(indent, M.MAX_INDENT), ...extra }));
  };

  function walk(parent, indent) {
    let buf = [];
    const flush = () => {
      const spans = trimSpans(buf);
      if (spans.length) blocks.push(M.newBlock('p', { spans, indent: Math.min(indent, M.MAX_INDENT) }));
      buf = [];
    };
    for (const node of parent.childNodes) {
      if (node.nodeType === 3 || (node.nodeType === 1 && !BLOCK_TAGS.has(node.tagName))) { inline(node, {}, buf); continue; }
      if (node.nodeType !== 1 || SKIP.has(node.tagName)) continue;
      flush();
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) para('h' + Math.min(3, Number(tag[1])), node, 0);
      else if (tag === 'P') para('p', node, indent);
      else if (tag === 'BLOCKQUOTE') para('quote', node, 0);
      else if (tag === 'PRE') blocks.push(M.newBlock('code', { lang: 'plain', text: node.textContent.replace(/\n$/, '').slice(0, 100000), wrap: false }));
      else if (tag === 'HR') blocks.push(M.newBlock('divider'));
      else if (tag === 'TABLE') { const t = tableFrom(node); if (t) { tables.push(t); blocks.push(M.newBlock('table', { table: t.id })); } }
      else if (tag === 'UL' || tag === 'OL') {
        for (const li of node.children) {
          if (li.tagName !== 'LI') continue;
          const boxed = li.querySelector(':scope > input[type="checkbox"]');
          para(boxed ? 'todo' : (tag === 'OL' ? 'number' : 'bullet'), li, indent, boxed ? { checked: boxed.checked } : {});
          for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') walk({ childNodes: [sub] }, indent + 1);
        }
      } else if (tag === 'LI') para('bullet', node, indent);
      else {
        // div, section...: a paragraph if it holds only inline things, else its children.
        const hasBlock = [...node.querySelectorAll('*')].some(x => BLOCK_TAGS.has(x.tagName));
        if (hasBlock) walk(node, indent); else para('p', node, indent);
      }
    }
    flush();
  }
  walk(doc.body, 0);
  return { blocks, tables };
}

export function textToBlocks(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  return { blocks: lines.map(l => M.newBlock('p', { spans: M.spansFrom(l) })), tables: [] };
}

const LONE_URL = /^https?:\/\/\S+$/i;
export const isLoneUrl = (s) => LONE_URL.test(String(s).trim()) && String(s).trim().length <= 2000;
