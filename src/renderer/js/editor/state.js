// The editor's shared state. One editor exists at a time (the open note), so
// this is a module-level object rather than a class: every editor module reads
// and writes it through ops.js, and nothing else holds the blocks.

export const S = {
  host: null,          // the element that holds the blocks (#nt-blocks)
  page: null,          // the page being edited
  blocks: [],          // [{ id, type, indent, ... }], the model. Always kept in step with the page
  tables: [],          // the page's tables; a table block names one
  els: new Map(),      // block id -> its root element
  builders: {},        // block type -> (block) => element, for the non-text types
  after: [],           // functions run after every sync (footnote numbers, find highlights)
  hooks: { change: () => {}, notify: () => {} },
  history: [],         // JSON snapshots, oldest first
  future: [],
  histLock: false,
  lastTypeAt: 0,
  overwrite: false,    // Insert key: typed text replaces the next character
  selected: new Set(), // block ids selected as whole blocks
  pending: null,       // look for the next typed character, { m, c, bg }, after a toggle with no selection
  lastId: null,        // the block that last had the caret
  dirty: false,
};

// `immediate`: a structural edit the page should save at once, not after the typing pause.
export function changed(immediate = false) {
  S.dirty = true;
  S.hooks.change(immediate);
}
