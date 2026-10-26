// Which edition this build is (PLAN-retro-demo.md, phase 8).
//
// 'demo' is the free standalone demo: the six demo systems (journal, to-do,
// habit tracker, graph notes, notes and folders, schedule). 'full' adds the
// systems the full version carries, which for now means the Mood log.
//
// The renderer is untrusted, and a paying user can open its devtools. So this
// flag only decides what the page shows. Nothing that must stay behind a
// purchase may rely on it: that check belongs here in main, when it exists
// (CONTEXT.md section 1).
//
// ETHOS_EDITION can override the default, for the test harness. It is ignored in
// a packaged build, so a shipped copy cannot be switched by its environment.

const { app } = require('electron');

const DEFAULT_EDITION = 'demo';
const KNOWN = ['demo', 'full'];

function resolveEdition() {
  const requested = process.env.ETHOS_EDITION;
  if (!app.isPackaged && KNOWN.includes(requested)) return requested;
  return DEFAULT_EDITION;
}

const EDITION = resolveEdition();

module.exports = { EDITION };
