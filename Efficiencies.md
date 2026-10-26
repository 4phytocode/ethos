# Ethos — efficiency review

A read-only pass over `src/main`, `src/preload`, `src/renderer` (JS, CSS, HTML)
and the schema. **Nothing was changed and nothing was profiled.** Every item is
from reading the code, so the costs below are about how work *scales*, not
measured milliseconds. Today's vault is tiny and none of this is hurting; the
point is what will hurt as notes, habits and to-dos accumulate.

Bugs found along the way are in `bugs.md` §6, not here.

Impact: **high** = grows with the whole vault on a hot path · **med** = wasted
work that is noticeable at scale · **low** = tidiness or small constant factors.
Effort: S under an hour · M a few hours · L a design change.

---

## Summary

| # | Item | Impact | Effort |
|---|---|---|---|
| 1 | Every mutation returns, copies and re-renders the whole vault | high | M–L |
| 2 | All views redraw on every state change, even hidden ones | high | M |
| 3 | Journal search lowercases every note on every keystroke | med | S |
| 4 | Habit grid recomputes per-habit dates 140 times per draw | med | S |
| 5 | Notes are read sequentially at startup | med | S |
| 6 | Streak derivation trims every note's full text | med | S |
| 7 | Tag lookups are linear and run inside list rendering | med | S |
| 8 | Fonts: five full TTFs, no subsetting or woff2 | med | S |
| 9 | Startup waterfall: 11 stylesheets and a module chain | med | S–M |
| 10 | Reminders poll every 15 s instead of sleeping until due | low | S |
| 11 | Forever-timers that render hidden views | low | S |
| 12 | Pretty-printed JSON and one fsync per file | low | S |
| 13 | `id()` compiles a RegExp on every call | low | S |
| 14 | Duplicated date helpers and grid drawing | low | S |
| 15 | SVG icons rebuilt attribute by attribute | low | S |
| 16 | Per-card listeners instead of delegation | low | S |
| 17 | Dead code and leftover files | low | S |

---

## High

### 1. Every mutation returns, copies and re-renders the whole vault

`ipc.js` spreads `store.snapshot()` into **every** reply, and `snapshot()`
deep-copies every note (full `content`), tag, event, to-do and habit
(`store.js:69`). Each snapshot is then structured-cloned across IPC, and
`state.apply()` replaces the renderer cache wholesale.

The hot path is typing. `journals.js` saves a patch 400 ms after the last
keystroke, so while someone writes, roughly twice a second the app copies,
serialises and deserialises **every journal ever written** just to confirm one
note changed. A note may be 2 MB (`MAX_CONTENT`), so the cost is proportional
to total journal size, not to the edit. Ticking a habit or a to-do pays the
same price.

This is a documented decision (CONTEXT §13: "full snapshot on every mutation
eliminates cache drift; the data is tiny at this scale"). It is right today and
wrong at roughly a few hundred long notes. Options, cheapest first:

- Return the changed entity plus a small `{ rev }` and patch the cache in place.
  Keep the full snapshot only for `state:load`. The "two copies of the truth"
  worry is handled by `rev`: a mismatch triggers one full reload.
- Keep full snapshots, but make the **list** payload light: send notes without
  `content` (or with a ~300 character preview, which is all the cards use) and
  fetch the full body when a note is opened. This also removes the 2 MB × N
  worst case. It touches search, which currently scans `content` (see 3).
- Whatever is chosen, `notes:update` is the one that matters. The others are
  rare by comparison.

### 2. All views redraw on every state change, even hidden ones

`state.apply()` calls every subscriber after every reply. The subscribers are
`journals.renderList`, `journal-streak.renderStreak`, `habits.render`,
`todo.render` and `tags` (row + picker). So a save from the note editor, a
screen the user is staring at, rebuilds the journal card grid, all 140 streak
cells, the habit list, the habit grid and the to-do page and card, none of
which are visible.

- Gate each subscriber on its view being active (`document.body.dataset.view`
  is already maintained), and mark it stale instead; redraw it in `show()` the
  next time its view opens.
- Or have `apply()` compare cheap per-collection fingerprints (a `rev` per
  collection from main, see 1) and only notify subscribers whose collection
  changed. A note edit would then skip habits and to-dos entirely.
- Side effect worth knowing: `renderList` runs `grid.innerHTML = ''` on every
  update, which destroys an in-progress rename input (`startRename`). Gating
  fixes that too.

---

## Medium

### 3. Journal search lowercases every note on every keystroke

`visibleNotes()` (`journals.js:179`) runs `n.content.toLowerCase().includes(q)`
for every note on every `input` event, allocating a lowercased copy of every
note's full text each time, with no debounce. Fix: keep a lowercased search
string per note (rebuilt only when that note changes, which a rev-aware cache
from item 1 makes easy), and debounce the input by ~120 ms. It also fully
re-renders the list per keystroke, so the same gating as item 2 helps.

### 4. Habit grid recomputes per-habit dates 140 times per draw

`dayTally()` (`habits.js:99`) is called once per cell (20 weeks × 7 = 140) and,
for each habit, calls `startOf(h)`, which builds a `Date` and formats it, then
does a linear `doneDates.includes()`. That is 140 × H date constructions plus
140 × H array scans. `fullDayStreak()` then calls `dayTally` again for every
day of the streak, and `renderBar`, `maybeCelebrate` and `renderGrid` each
repeat it for today.

Fix: once per render, build `{ start, doneSet }` per habit, then each cell is
two cheap lookups. Compute today's tally once and pass it around.

### 5. Notes are read sequentially at startup

`vault.#loadNotes()` awaits each file inside a `for` loop
(`vault.js:195`), so startup time is the sum of N disk reads, and
`whenReady` blocks on it before the window exists. Reading with a bounded
`Promise.all` (say 16 at a time) is a few lines and keeps the quarantine
behaviour. The window could also be created before the vault finishes loading,
with `state:load` waiting on the promise, so the intro animation overlaps the
load instead of following it.

### 6. Streak derivation trims every note's full text

`journalledDays()` (`journal-streak.js:49`) does `n.content.trim().length`
for every note. `trim()` allocates a copy of up to 2 MB per note, and the
function runs on every state update (streak), again for the calendar, and
`isoOf(new Date(...))` is computed per note each time. With `MIN_CHARS = 1`
the question is just "is there a non-whitespace character", which
`/\S/.test(content)` answers without a copy and stops at the first hit. Better
still, have main store `hasText` or a char count so the renderer never needs
the body for this at all (it pairs with item 1). `renderCalendar` also calls it
a second time over the same notes.

### 7. Tag lookups are linear and run inside list rendering

`state.tag(id)` is `Array.find`, and `tagsOf(note)` calls it per id, so
rendering a list is O(notes × tags × tagIds). Build a `Map` of tags (and
notes by id) once in `apply()`; `note()`, `tag()`, `todo()` and `habit()` all
become O(1). Main has the same shape (`this.notes.find`, `.findIndex`), which
is harmless below a few thousand entries.

### 8. Fonts: five full TTFs, no subsetting or woff2

New with Plex Mono. The five TTFs are ~110 KB each (~560 KB) and contain
Latin, Cyrillic, Greek and more. They load lazily and only when selected, so
System UI users pay nothing, but Plex Mono is now the default, so everyone
does. Converting to woff2 and subsetting to Latin plus the punctuation the app
uses should land near 15–25 KB per face. Drop Italic if nothing renders italic
(the textarea does not). The main-process mime table already knows `.woff2`.
A one-off script under `scripts/` is enough; the licence (OFL) permits
subsetting but asks that the renamed font not reuse the "Plex" reserved name
if modified, so check that before shipping a subset.

### 9. Startup waterfall

`index.html` links 18 stylesheets (as of 2026-10-23), each a separate request through the custom
protocol, all render-blocking, then one `<script type="module">` whose imports
are discovered only as each file parses (`app.js` → 19 import lines).
Every request is `fs.stat` then `net.fetch(file://)` (`protocol.js:88–96`), two
filesystem operations per asset.

- Add `<link rel="modulepreload">` for the module graph. No build step needed
  and CSP-safe.
- Concatenate the CSS (or `@import`-free bundle it) at package time. Not
  worth a build pipeline yet; worth it when the installer is built.
- In the protocol handler, `fs.readFile` / `createReadStream` would avoid the
  extra `stat` + `net.fetch` hop, and a `Cache-Control` header is free.
- The 2.9 s intro runs on every launch. Whether to skip or shorten it after
  the first run is a product call, but it is the largest single contributor to
  time-to-usable, and `playIntro` starts only after `state.load()` resolves.

---

## Low

### 10. Reminders poll every 15 s instead of sleeping until due

`Reminders` ticks on a 15 s interval for the whole session, each tick
filtering the to-do list three times (`ensurePlan`, `dueReminders`,
`hasUpcomingReminders`). Reminders can fire up to 15 s late. A single
`setTimeout` to the earliest `dueAt` (re-armed after any plan change) is more
precise and idle in between. Not urgent, but with `backgroundThrottling: false`
this timer keeps the process fully awake while hidden in the tray.

### 11. Forever-timers that render hidden views

`todo.js:137` re-renders the to-do page and the homepage card every 30 s for
the life of the app, including when the window is hidden to the tray and when
another view is showing. Pause it on `document.hidden` the way `clock.js`
already does, and skip the page half unless `todo-page` is the active view.
(The comment above it says "once a minute"; it is 30 s. See `bugs.md` §6.)

### 12. Pretty-printed JSON and one fsync per file

Every save uses `JSON.stringify(x, null, 2)` and an fsync (`vault.js`). The
indentation is roughly 20–40 % extra bytes for the small record files and costs
CPU on a 2 MB note; compact JSON is just as safe, and hand-readability can be
traded for it. The fsync is correct for atomicity and stays; but in `flush()`
the independent files (tags, todos, habits) are written one after another, and
could be written concurrently with `Promise.all`. Also, `#rechain` calls
`#touchTodos()` itself and every caller does too, so the dirty flag is set
twice per mutation (harmless but redundant).

### 13. `id()` compiles a RegExp on every call

`schema.js:46` does `new RegExp('^' + prefix + '_[0-9a-f-]{36}$')` per id
validated. Hoist five constants (`n t e k h`). It is on every `parseNote`,
every tag id on every note, and every `doneDates` entry is an `isoDate` regex
plus `split`/`Date.UTC` (up to 4000 per habit at load). Hoisting both regexes
is trivial.

### 14. Duplicated date helpers and grid drawing

`pad`/`isoOf` are copied into `journals.js`, `journal-streak.js`, `habits.js`,
`todo.js` and (as `localISO`) `store.js`. The streak grid and habit grid are
the same 40 lines (already tracked in `todo.md`). One `dates.js` and one
`drawGrid()` removes ~100 lines and a class of drift bugs (one copy reads
`dataset.level` differently, one sets `title=''` for future cells, the other
omits it).

### 15. SVG icons rebuilt attribute by attribute

`tickButton`, `iconButton`, the journal display icon and the notification close
icon each make an `svg` and 8–10 `setAttribute` calls per element, per row,
per render. Define the icons once as `<template>`s in `index.html` (or a small
`icons.js` returning `cloneNode(true)`).

### 16. Per-card listeners instead of delegation

`attachRowBehaviour` adds a `click` and a `contextmenu` listener to every card
and row, then `renderList` throws them all away and redoes it. One delegated
listener on `#pages-grid` using the existing `data-note-id` is smaller and
removes churn (and the stale-closure risk if a card is reused).

### 17. Dead code and leftover files

Safe removals once confirmed, none of them urgent:

- The font probe machinery in `settings.js` (`isInstalled`,
  `flagAvailability`) and the `.set-font-missing` / `.set-font.missing` CSS:
  every `FONTS` entry has `probe: null`, so it can never run.
- `minutesInDay` is sent in `state:load` and never read.
- `state.event / eventsOn / removeTag`, `notify.clear / count / queued`,
  `tray.iconImage` export have no callers.
- `main.js.pre-restructure.bak` and `notifications.js.pre-restructure.bak`
  were deleted on 2026-10-23 (they are in commit `6336f28`).
- The dormant events subsystem still costs a copy and a clone per snapshot
  and three IPC channels (`CONTEXT.md` §7 has the removal checklist).

---

## Suggested order

1. **Item 8** (font weight) and **13** (RegExp hoist): quick, no design risk.
2. **3, 4, 6, 7**: local fixes inside one function each; no behaviour change.
3. **5**: parallel note load.
4. **2** (gate redraws), then **1** (lighter replies). Do these together:
   both need a notion of "what changed", and `rev` per collection from main
   serves both. Update CONTEXT §13 when you do, since it reverses a decision
   that was right at the time.
5. **9–12, 14–17** as housekeeping when touching those files.

Before starting 1 and 2, it is worth generating a vault with a few hundred
long notes and timing a save, so the win is measured rather than assumed.

---

## Storage (measured 2026-10-21)

Measured on disk, dev folder `H:\ethos` = **401 MB**.

| Item | Size | Shipped? | Notes |
|---|---|---|---|
| `node_modules/electron/dist` | 368 MB | yes, as the runtime | the Electron binary and its DLLs |
| &nbsp;&nbsp;`electron.exe` | 234 MB | yes | cannot shrink |
| &nbsp;&nbsp;`dxcompiler.dll` + `dxil.dll` | 27 MB | yes | GPU shader compiler; only needed for WebGPU/shader paths the app does not use |
| &nbsp;&nbsp;`LICENSES.chromium.html` | 20 MB | yes | keep in a distributed build (licence obligation) |
| &nbsp;&nbsp;`locales/` (55 files) | 49 MB | yes | en-GB + en-US are ~1.1 MB; the rest are ~48 MB |
| &nbsp;&nbsp;`resources.pak`, `icudtl.dat` | 23 MB | yes | cannot shrink |
| &nbsp;&nbsp;`vk_swiftshader*.dll`, `vulkan-1.dll` | 6.5 MB | yes | software Vulkan; unused unless WebGL/Vulkan paths are hit |
| `src/renderer/backgrounds/` | 16 MB | yes | eight 3840px JPEGs + thumbs. Largest app-owned item |
| `src/` code | ~1 MB | yes | JS/CSS/HTML |
| `src/renderer/fonts/` | 0.6 MB | yes | IBM Plex Mono, five weights |
| `references/` | 4.9 MB | **no** | includes a 4.4 MB PNG and the `ui design/` folder; design reference only (measured 2026-10-23) |
| `backups/` | 0.9 MB | **no** | old source snapshot |
| `*.pre-restructure.bak` | 40 KB | **no** | delete once git works |
| `imgs/` | 16 KB | **no** | source artwork |

### Estimate

| Build | Now | After the steps below | Notes |
|---|---|---|---|
| Dev folder (with node_modules) | ~401 MB | ~330 MB | locale pruning and removing dev-only folders. A fresh `npm install` restores node_modules (~380 MB), so this is a checkout size, not a shipped size. |
| Packaged app, unpacked | ~385 MB | ~290 MB | locale pruning (-48 MB), backgrounds to WebP (-9 MB), removing unused DLLs (-7 to -27 MB) |
| Packaged installer (compressed) | ~130 MB (est.) | **114 MB (measured 2026-10-23)** | electron-builder with asar and max compression. Electron's floor is roughly 75-80 MB. |
| Route to a drastically smaller app | n/a | **~5-10 MB** | replace Electron with Tauri (system WebView2). Main-process code (vault, store, IPC) is plain JS and would need porting to Rust or a sidecar. This is a rewrite, not a tweak. |

These are estimates, not measured builds. The first real build will settle them.

**Measured 2026-10-23** (`npm run dist`, electron-builder 26.15.3, en-GB + en-US locales,
asar with maximum compression): installer **114 MB**, `win-unpacked` **337 MB**, of which
`app.asar` is 17 MB (backgrounds 16 MB). The locale prune removed the 48 MB of other
locales as planned. The rest is the Electron runtime (`electron.exe` 234 MB, `dxcompiler.dll`
26 MB). The installer is above the 80-95 MB estimate; see bugs.md 12.9.

### Steps, in order of payoff for effort

1. **Prune locales to en-GB and en-US** (-48 MB unpacked). Build config: `electronLanguages: ['en-GB', 'en-US']` in electron-builder. Zero code change.
2. **Re-encode backgrounds as WebP** at 3840px, quality ~82 (-8 to -10 MB, about 40% smaller than JPEG at the same look). Presets live in `src/renderer/backgrounds/`; update `backdrop.js` `imageUrl()` and the `.jpg` MIME entry in `protocol.js` (`.webp: image/webp`). Keep the thumbs as WebP too.
3. **Exclude dev-only folders from the build**: `references/`, `backups/`, `imgs/`, `*.bak`, `scripts/`, `node_modules` except runtime deps. Use electron-builder `files` globs. Saves ~2.5 MB of files that do nothing at runtime.
4. **Turn on asar packing and max compression** in the packager. Electron then stores the app as one compressed archive. Saves a few MB and speeds start-up.
5. **Test removing dxcompiler/dxil and vk_swiftshader** in a packaged build with `npm run test:ui`. Only if every view still renders. Saves ~27-34 MB. Risky: a Chromium feature the app never calls can still be reached at start-up, so verify before keeping.
6. **Decide on Tauri** before the first paid build. It is the only route under 20 MB and it changes the process model. Not a near-term task.

### Things that are not worth doing
- Compressing `electron.exe` with UPX: breaks code signing and triggers antivirus false positives.
- Shrinking the fonts by hand during development: 0.6 MB total, and they are the default face. The WOFF2 subsetting in item 8 is the one exception, and only at packaging time (PLAN-retro-demo.md, task 9.2).
- Splitting the vault into a second package: the vault is user data, not app size, and it is tiny.

