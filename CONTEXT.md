# Ethos — maintenance context

Everything needed to pick this codebase up cold. Read this before changing
anything; read `todo.md` for what is planned next.

Last updated 2026-10-23 (housekeeping pass; the retro redesign is planned in PLAN-retro-demo.md). Before that, 2026-10-21, after the homepage / journal pass (backdrop, mood log,
homepage habits, journal prompts and paper). See section 14 for that pass.

---

## 1. What this is

An Electron desktop productivity app: a schedule (calendar), to-dos, a habit
tracker, journals with tags, and a Notes section with folders.

### Where it is going (keep in mind; not built)

- **Cross-device reach.** Reminders must eventually reach the user wherever
  they are: iPhone, other phones, other machines. Today only Windows gets a
  banner. This needs accounts and sync first; see todo.md "Integrations".
- **EthosBlock, a browser extension (Chrome first).** Blocks large parts of
  websites during deep-work periods and greyscales sites the user still has to
  use. The desktop app is the source of truth for *when*; the extension does
  the blocking. Not designed yet.
- **"Liquid" interaction everywhere.** The schedule is the reference: you draw
  on it, and what you draw follows the pointer on a spring (§3, "The
  schedule"). Every other segment is meant to move the same way.

**It will ship commercially: a lifetime subscription purchase behind a login /
user-account system.** It is not intended to stay standalone open-source
software. That matters for day-to-day decisions:

- The renderer is untrusted. Paying users can open devtools. Never put a
  trust decision, an entitlement check or a secret in renderer code.
- Data must stay server-syncable: stable opaque ids, a `schemaVersion` on
  disk, no machine-local paths baked into records.
- Keep persistence and any future auth in the main process behind validated
  IPC, so a local vault can become a per-user synced store without a rewrite.

No auth, accounts, telemetry or network calls exist yet. Do not add them
speculatively.

---

## 2. Running it

```
npm start          # electron .
npm run check      # 84 model-layer checks, plain node, no Electron
npm run test:ui    # 55 end-to-end checks in a real window, throwaway vault (~50s)
```

`npm run check` is the fast feedback loop. It imports `src/main/{vault,store,
schema}.js`, which deliberately require nothing from `electron`, so the whole
data layer is testable in plain node. **Run it before and after touching
anything under `src/main`.**

---

## 3. Layout

```
src/main/        the only code that touches disk or holds authoritative state
  index.js       app lifecycle, BrowserWindow, security posture
  protocol.js    the app://ethos scheme, CSP, path containment
  ipc.js         the 25 IPC handlers, each wrapped in an { ok, error } envelope
  store.js       authoritative state + mutations + debounced saving
  vault.js       atomic disk I/O, the on-disk layout, quarantine
  schema.js      validation and migrations, shared by disk and IPC
  reminders.js   to-do and event reminder scheduler (no electron import; testable in node)
  tray.js        tray icon, drawn in code, so Ethos can run with its window closed

src/preload/
  index.js       contextBridge surface; exposes functions, never ipcRenderer

src/renderer/    rendering only; no fs, no business logic, no authority
  index.html
  styles/        base, clock, intro, journals, tags, todo, habits, settings,
                 sidebar, schedule, notes, graph, notifications, backdrop, home, prompts, fonts, quote
  js/
    app.js           entry point: load state, then wire views
    state.js         cache of main-process state + the only bridge calls
    views.js         view switching, onEnter/onLeave hooks, context menu
    sidebar.js       Notion-style sidebar: hide / show, Ctrl+\
    schedule.js      the schedule: views, draw/move/stretch gestures, editor, date helpers
    notes.js         Notes section: sidebar tree + notes view + links between notes
    graph.js         graph view: every note and folder on a canvas (§16)
    journals.js      journals list, tabs, display modes, note editor
    journal-streak.js  contribution grid + the daily goal toast
    todo.js          to-do page, homepage card, tick box, reminder toast
    habits.js        habit tracker: grid, today's tick boxes, daily goal toast
    clock.js         homepage clock: ticks, hands, readout
    settings.js      appearance prefs, font registry, Settings UI
    tags.js          tag row, create panel, reuse picker
    intro.js         launch animation
    theme.js         light/dark
    notifications.js toast stack (module; exports `notify`)
    backdrop.js      moving gradient / user image behind views; Settings > Background
    mood.js          homepage "How are you feeling?" card + Mood log page
    prompts.js       journal prompts, empty-page nudge, plain/lines/grid paper
    prompts-data.js  the Gratitude and "Surprise me" prompt lists
    quotes.js        the homepage quote list (see "Homepage quote")
    todo-parse.js    typed times in the to-do input (pure, no DOM)

renderer/fonts/       IBM Plex Mono, OFL; the licence texts are alongside
renderer/backgrounds/ bundled preset backdrops; credits in its README

scripts/check.js             the model-layer checks
assets/          icon.ico + icon.png, the app icon (see "The app icon")
imgs/            source artwork supplied by the user; not read at runtime
todo.md            roadmap and known gaps
```

The two `.pre-restructure.bak` files were deleted on 2026-10-23; their history is
in commit `6336f28`. `backups/` holds an older copy of `src/` and is kept for now.

---

### Chrome that belongs to only some views

`views.js` writes the active view id to `document.body.dataset.view`, and CSS
keys off it. The fixed habit bar used this rule until it was removed on 2026-10-21 (see
"Homepage layout"). The rule still holds for any fixed edge element: over a
scrolling view it eats the content underneath, so scope it by view.
`initViews()` seeds the attribute before the first navigation, so it is correct
on first paint.

### Chrome that reveals on hover

The theme toggle rests as a small round cover at the bottom left and flows open
on hover. The pattern, if anything else gets the same treatment:

- Open on `:hover` **and `:has(:focus-visible)`** — never `:focus-within`.
  Clicking a button focuses it, so `:focus-within` latches the control open
  after the pointer has gone. `:focus-visible` matches keyboard focus only.
- Hide with `opacity` and `pointer-events`, never `display:none` or
  `visibility:hidden` — both remove the control from the tab order, which
  makes it unreachable by keyboard.
- Put the easing overshoot on the size transition. That is what separates
  "fluid" from merely "animated".
- Give the whole thing a `prefers-reduced-motion` escape.
- Never animate `display`. The sidebar label used to be `display:none` until
  `:hover`, which cannot transition, so it popped in while the button was still
  growing. Use `max-width` + `opacity` instead.

The theme toggle (`#toggle`) uses this, with `cubic-bezier(0.34, 1.4, 0.64, 1)`;
the sidebar used to, before it became a full-width list (below).

### The sidebar

A Notion-style list on the right (`sidebar.js`, `styles/sidebar.css`): Home,
Schedule, To-do's, Habit tracker, Journal, then the Notes tree, then Settings
at the foot. Items are `.sidebar-btn[data-view]`, which `views.js` wires and
marks `.active`.

Its width is **one custom property, `--sb-w` on `<body>`** (236px, or 0 with
`body.sb-hidden`). `.view`, `.habit-bar` and the toast stack take their right
edge from it, so hiding the sidebar is one class flip and everything flows
into the space on the same spring. Anything new pinned to the right edge must
read `--sb-w` too. Hide with the `»` button or Ctrl+\; the `«` button appears
top right while hidden. The state is in `localStorage` (`ethos.sidebar.hidden`).

**`[hidden] { display: none !important }` is global** (`base.css`). Without
it, a class that sets `display: flex` beats the UA rule, and a "hidden"
element stays in the layout, invisible but catching clicks. That is exactly
how the schedule's closed editor swallowed every drag's pointerup.

### The schedule

`schedule.js` draws week, day and month views over the event model. The rule
that makes it feel the way it does: **nothing changes on screen by snapping.**

- **Gestures, not forms.** Drag on the grid to draw an event (a click makes a
  one-hour one), drag an event to move it across days, drag its lower edge to
  stretch it. All snap to 15 minutes. In month view and the all-day row, chips
  drag between days; clicking an empty cell makes an all-day event.
- **The ink.** During a gesture one `.sc-ink` element follows the pointer
  through `Spring` (under-damped: it trails, overshoots a little, settles).
  Its velocity leans it (`skewX`) and thins it, which is what reads as liquid.
  It enters as a drop that spreads into a block (`sc-ink-in`), a new event
  wipes open (`.born`), a dropped one wobbles as it settles (`.landed`).
  `prefers-reduced-motion` turns all of it into plain snapping.
- **The record changes once, on release**, through the normal validated IPC
  call. Nothing is written while dragging.
- **Rendering is coalesced to one frame** (`scheduleRender`) and **skipped
  while a gesture is live** (it would pull the grid out from under the
  pointer); it catches up on release. Coalescing is also what lets a
  mutation's return value (the new event's id) be marked `born` before the
  redraw runs.
- **Gesture listeners go on `window`**, with pointer capture as a bonus. Under
  synthetic input `hasPointerCapture` came back false; window listeners make
  the release land regardless.
- **The editor saves as you type**; there is no Save button. A freshly drawn
  event dismissed with no title and nothing changed is deleted again, like an
  unfinished sketch. Delete offers Undo (it re-creates the event, new id).
- **Scroll position is read from `scroll` events only.** A hidden view reports
  `scrollTop` 0, and trusting that on a redraw threw the user back to midnight.
- Keys while the schedule is in front: `N` new, `T` today, `D`/`W`/`M` view,
  arrows step, `Delete` removes the selected event, `Esc` closes the editor.
- Mode (`ethos.schedule.mode`) is remembered per machine.

### Notes

`notes.js` keeps the sidebar tree and the notes view in step. A *page* is a
Notes document (`p_` id, one file each in `pages/`); a *folder* is a small
record (`f_` id, all in `folders.json`). Pages are separate from journal notes
on purpose: different lifecycle, and the journal streak counts only journals.
A page with `folderId: null` is loose; `temporary: true` marks scratch pages,
listed under "Temporary". **Nothing expires temporary pages yet** — that rule
is an open decision. Deleting a folder unfiles its pages; it never deletes
them. First pass; the user plans to revamp it.

### Homepage quote

`renderer/js/quotes.js` shows one quote under the homepage heading, in place of
"Welcome back." It is a **curated, bundled list** of motivational quotes, and
the list is the source of truth. The reasons, so they are not re-litigated:

- BrainyQuote answers automated requests with HTTP 403 and has no public API.
  Its robots.txt also disallows `/api/`. Working around that block is off the
  table.
- ZenQuotes has a free API, but it returns quotes on any topic and cannot be
  limited to motivational ones. Its free tier serves data cached hourly.

A quote is picked at random on each launch and never repeats the one shown last
time (stored in `localStorage` as `ethos.lastQuote`). The author line is
revealed on hover and on keyboard focus, and it wraps in full: do not add
`text-overflow: ellipsis` to the attribution.

To change the list, edit `QUOTES`. Check every attribution before adding one,
because misattributed quotes are common.

### Logo, scrollbar

The brand (`.brand`, the "e" mark) is `position: fixed`, so scrolled content
passes underneath it. It carries a `filter: drop-shadow(...)` halo in the page
colour (`--bg`), which knocks back content around the letters. Because the
colour is the page background it is invisible on an empty page and follows dark
and light. Keep that halo if the mark is moved or restyled.

Scrollbars use the standard `scrollbar-width` and `scrollbar-color` properties
on `*` in `base.css`, with the thumb set from `--fg` at 26% opacity. That tints
it to the theme in both modes. **Do not add `::-webkit-scrollbar` rules
alongside them.** The webkit rules broke scrolling in this Electron build, and
the two styles conflict.

### Homepage layout

Top to bottom: heading; `.home-top` (quote + the mood card); `.home-row` (clock
+ **to-do card**); `.home-habits` (today's habits, tickable, with a quick-add
field). The fixed bottom `.habit-bar` was **removed** on 2026-10-21, so no view
reserves bottom padding for it any more (the "view-scoped chrome" note above is
still the rule for anything fixed). Homepage card styles beyond the to-do card
are in `styles/home.css`. The to-do card: the clock on the left
(`.home-row` > `.home-clock`), the **to-do card** beside it (`.todo-card`). The card's heading is lowercase `to-do's`. It lists today's tasks, with
remember-items on one dashed line below (§15).

### The homepage clock

`renderer/js/clock.js` draws tick marks, three hands and the exact time with
the weekday in the middle — no ring, no numerals. Two things in it are not
obvious:

- **Hand angles are a running total, never reset into 0-360.** At the top of a
  minute the second hand goes 354 → 360, not 354 → 0, so the CSS transition
  carries it forward instead of unwinding a full turn backwards. `forward()`
  enforces that; do not "simplify" it to a modulo.
- **It ticks on the second boundary**, `1000 - (Date.now() % 1000)`, rather
  than every 1000ms, so the readout cannot drift behind the real clock. It
  stops while the window is hidden and catches up on return.

The digital readout sits **above** the face, not inside it. In the middle it
crowded the pivot and had to mask the hands with a slab of background colour;
moving it out left the centre clear and removed the mask.

`.clock-face` sets `shape-rendering: geometricPrecision`. The default, `auto`,
lets the renderer fall back to `optimizeSpeed`, and thin diagonal strokes then
look like a low-resolution bitmap rather than vector lines.

### Appearance and fonts

One switchable family for the whole app, set in Settings > Appearance and
applied through a single custom property:

```
--font-ui   on :root, set by settings.js
body        font-family: var(--font-ui, system-ui, sans-serif)
```

Everything else inherits, including buttons, inputs and the journal editor, so
a new surface needs no font rule of its own. **Do not pin a family anywhere.**
The journal editor used to hard-code Times New Roman and was the one place the
setting could not reach.

`initAppearance()` runs before `initTheme()` and `initViews()` so the family is
set before anything is measured or painted.

Fonts must be either installed on the machine or shipped by us — the CSP allows
`font-src 'self'`, so a Google Fonts entry would silently fall back and the
setting would be lying. `settings.js` measures each candidate against a
deliberately absent family and marks any that are missing, rather than letting
a fallback masquerade as the chosen face.

**Two choices: IBM Plex Mono (default, `FONTS[0]`) and System UI.** Plex Mono is the first
*shipped* face: five TTFs in `renderer/fonts/` (OFL 1.1, see its README),
declared in `styles/fonts.css`, so it needs no `probe`. `applyFont()` also sets
`html[data-font]`, and `fonts.css` uses it to tune the mono face (lighter
headings, tighter tracking, a smaller writing surface) without touching System
UI. Add a family by adding an entry to `FONTS`; give it a `probe` only if it
relies on an installed font.

Stored preferences that name a removed font fall back to System UI, because
`load()` only accepts ids that are still in `FONTS`.

### The app icon

The Ethos logo is a white, italic lowercase "e" followed by a full stop, on
black. The user's original is `imgs/logo(1).png` (800x800, palette PNG). It
replaces Electron's default icon on the window, title bar and taskbar.

- `assets/icon.ico` (16, 24, 32, 48, 64, 128, 256) and `assets/icon.png`
  (512x512) are generated from that source with Pillow (`Image.LANCZOS`).
  Re-run the resize if the artwork changes; there is no build script yet.
- `src/main/index.js` passes `icon: ICON` in `windowOptions()`: the `.ico` on
  Windows (crisp at every taskbar size), the PNG elsewhere.
- `assets/` sits **outside `src/renderer`** on purpose. The `app://` handler
  only serves files inside `src/renderer`, so the icon is never reachable from
  the page.
- Still on the old mark: the **tray icon** (`tray.js`, a dot beside a ring
  drawn in code) and the **in-app brand and intro "e"** (inline SVG set in
  Helvetica, `index.html` and `intro.js`). They were left alone because the
  request was to replace the Electron logo. The new logo is a different
  letterform from the SVG "e" (italic, with a full stop), so swapping those
  would be a design decision, not a swap.
- `npm start` runs `electron.exe`, so a *pinned* taskbar shortcut and Task
  Manager still show Electron's icon in development. The window itself shows
  the Ethos icon. A packaged build needs the `.ico` handed to the packager as
  the executable icon; no packager is configured yet.

## 4. The four layers, and the rule for each

| Layer | Runs in | Owns | Never does |
|---|---|---|---|
| Storage | main | atomic disk I/O, one vault dir | know about views |
| Model | main | notes, tags, future habits | touch the DOM |
| IPC | preload | a narrow validated surface | take a caller-chosen channel |
| UI | renderer | drawing, input | touch fs, hold authority |

The renderer holds a **cache**, not the truth. Every mutation goes to main and
returns a fresh snapshot that replaces the cache wholesale. That is deliberate:
two copies of the truth is the bug class this structure exists to prevent.

---

## 5. Data model

Current `SCHEMA_VERSION` is **7** (2 added the schedule, 3 added to-dos and
habits, 4 added event colour + reminders and the Notes section, 5 added the
mood log, 6 added to-do `kind` and `startMinute`, 7 added page `links`).

```js
tag    = { id: 't_<uuid>', name, color, createdAt }
note   = { id: 'n_<uuid>', title, content, tagIds: [], createdAt, updatedAt }
event  = { id: 'e_<uuid>', title, date, startMinute, durationMinutes,
           note, done, tagIds: [], color, remindMinutes, notified,
           createdAt, updatedAt }
folder = { id: 'f_<uuid>', name, createdAt, updatedAt }
page   = { id: 'p_<uuid>', title, content, folderId, temporary,
           links: ['p_<uuid>', ...],   outgoing only; backlinks are derived
           createdAt, updatedAt }
todo  = { id: 'k_<uuid>', title, kind: 'task'|'remember', date, minutes,
          startMinute, done, dueAt, notified, createdAt, updatedAt }
habit = { id: 'h_<uuid>', name, doneDates: ['YYYY-MM-DD', ...],
          createdAt, updatedAt }
mood  = { id: 'm_<uuid>', date: 'YYYY-MM-DD', feeling: 'good'|'bad'|'note',
          text (<=280), createdAt, updatedAt }   one per day; re-logging replaces
```

### To-dos and the plan

A to-do belongs to one local calendar day. `minutes` is the user's estimate
(`null` = none). **`dueAt` is never supplied by the renderer**: the store works
it out, and the renderer only displays it.

The plan exists for *today only*. Pending tasks run end to end in list order
starting from now, so each pending task with an estimate gets a `dueAt` — when
the plan says it will be finished. Rules that are easy to break:

- Finishing a task early pulls everything after it forward, because every
  change re-plans from `now`.
- A task whose reminder has already fired (`notified`) **keeps its `dueAt`**.
  Otherwise adding an unrelated task would grant an overdue task a whole new
  estimate.
- Changing a task's estimate or day, or reordering, resets `notified` so the
  new plan can remind again.
- A task with no estimate has no `dueAt` and does not move the others.
- Another day's tasks have no `dueAt` until that day arrives; `ensurePlan()`
  gives them one on the next scheduler tick.

Every store method that touches the plan takes `now` as a parameter. That is
deliberate: it is how the planning logic is tested to the minute without
waiting on a clock. Do not replace it with `Date.now()` internally.

### Event colour and reminders (v4)

`color` is `null` (monochrome default) or one of `TAG_COLORS`, enforced by the
same palette check as tags, because it is written into a style property.
`remindMinutes` is `null` (no reminder) or 0..10080 minutes before the start;
an all-day event cannot fire one (it has no start). `notified` is set by main
when the reminder fires and **reset by `updateEvent` whenever the trigger time
changes**, so moving an event re-arms it. A reminder whose event has already
ended (the app was closed through it) is dropped, not announced late. All
three default on load, so a v3 event reads as "no colour, no reminder".
`store.eventStart/eventTrigger` turn the local date + minute into an instant;
that instant is computed, never stored.

### Habits

`doneDates` is sorted and de-duplicated. A day in the grid is dark when every
habit that *existed* on that day was done, the middle shade when some were,
empty when none were. A habit "exists" from its creation date, or from its
earliest ticked day if that is sooner (a day filled in after the fact). A
future day cannot be ticked. The grid is derived in the page and never stored.

**Event dates are `'YYYY-MM-DD'` strings in the user's local calendar, never
timestamps.** A timestamp would let an event drift across midnight when the
machine's timezone changed, which in a planner is a correctness bug, not a
rounding detail. All date arithmetic goes through the helpers at the top of
`renderer/js/schedule.js`, which use the local `Date` constructor so month and
year rollover and DST are handled without a timezone ever entering the record.

`startMinute` is minutes from midnight (`null` = all-day) so sorting and
overlap checks are plain arithmetic. `durationMinutes` requires a
`startMinute`; an all-day event with a duration is rejected. Because a *patch*
can create that combination by clearing only the start, `store.updateEvent`
validates the **merged** record rather than the patch alone.

**Notes reference tags by id and never copy them.** This is the single most
important invariant. The pre-restructure code stored `{name, color}` on the
note, which meant recolouring a tag left old notes on the old colour and
renaming one silently forked it into a second tag. Rendering always resolves
ids against the live tag list (`state.tagsOf(note)`).

`tagIds` is an array although the UI currently applies one tag per note. That
is so many-to-many tagging is a UI change later, not a second migration. Do
not "simplify" it to a single `tagId`.

### On disk

```
<userData>/vault/
  meta.json          { schemaVersion }
  tags.json          { tags: [...] }
  events.json        { events: [...] }
  todos.json         { todos: [...] }
  habits.json        { habits: [...] }
  folders.json       { folders: [...] }      Notes folders
  moods.json         { moods: [...] }        daily check-ins
  notes/<id>.json    one file per journal note
  pages/<id>.json    one file per Notes page
  .tmp/              staging for atomic writes, cleared on startup
```

Events share one file rather than getting one each: they are small fixed-shape
records, not documents, so the blast radius of a bad write is already small and
a day's agenda is one read away. Notes keep a file each because they are
documents that grow. That split is the rule to follow for new collections.

`meta.json` is written whenever the stored version is not the current one,
**including for a brand new vault**, so a vault always carries a version
marker. A vault with data but no `meta.json` is treated as version 1 — the
earliest version that could have produced it — never as the current version,
because assuming current would skip every migration.

On Windows `<userData>` is `%APPDATA%/Ethos`.

One file per note, not one blob: a torn or hand-edited file costs one note
instead of the journal, and a per-note record is the shape a per-user sync
would push. JSON rather than Markdown-with-frontmatter because frontmatter
needs a parser we would have to write and debug, in the one layer that holds
user data. Markdown export stays a pure function over the model if wanted.

A file that fails to parse is **renamed to `.corrupt-<timestamp>`**, not
deleted and not silently skipped. `#loadNotes` only reads `.json`, so a
quarantined file is never re-read.

---

## 6. Invariants — do not break these

1. **Validate at the boundary.** Everything off disk or in over IPC goes
   through `schema.js`. Add a parser there, not an ad-hoc check at the call
   site.
2. **Tag colours are restricted to the palette** (`TAG_COLORS`). A colour is
   written straight into a style property, so an arbitrary string would be a
   CSS injection. `schema.color()` enforces this.
3. **Ids are validated before any path is built from one.** `vault.noteFile()`
   re-asserts the id pattern even though `schema` already checked it, because
   that function concatenates a filename. There is a check for this.
4. **Never `innerHTML` anything user-supplied.** Build elements and use
   `textContent`. The moment note content renders as Markdown or rich text,
   sanitize it — in Electron, XSS is close to RCE.
5. **Mutations return a snapshot; snapshots are copies.** `store.snapshot()`
   deep-copies so a renderer reference cannot mutate main's state. Tested.
6. **No inline script or style, ever.** The CSP forbids both. A `<style>`
   element built at runtime *is* blocked — that is why notification CSS lives
   in a stylesheet. Setting `el.style.foo` from JS is fine and is not affected.
7. **The preload exposes functions, never `ipcRenderer` and never a
   caller-supplied channel name.** Otherwise any script in the page gets the
   whole handler surface instead of 10 calls.
8. **Writes are atomic.** `#writeAtomic` does temp → `fsync` → `rename`. Never
   write a vault file in place.
9. **Bump `schemaVersion` and add a migration** for any change to the on-disk
   shape. A vault from a newer build is refused, not read with wrong
   assumptions.

---

## 7. IPC surface

Twenty-five channels. Each returns `{ ok: true, ... }` or `{ ok: false, error }`;
the preload unwraps that into a normal promise, so renderer code uses
try/catch. Exceptions never cross the bridge — a main-process stack is not
something a renderer should see.

| Channel | Preload | Returns |
|---|---|---|
| `state:load` | `ethos.loadState()` | snapshot + `tagColors` |
| `state:flush` | `ethos.flush()` | forces pending writes |
| `notes:create` | `ethos.notes.create()` | `note` + snapshot |
| `notes:update` | `ethos.notes.update(id, patch)` | `note` + snapshot |
| `notes:delete` | `ethos.notes.remove(id)` | `deleted` + snapshot |
| `tags:create` | `ethos.tags.create({name, color})` | `tag` + snapshot |
| `tags:delete` | `ethos.tags.remove(id)` | `deleted` + snapshot |
| `events:create` | `ethos.events.create({date, ...})` | `event` + snapshot |
| `events:update` | `ethos.events.update(id, patch)` | `event` + snapshot |
| `events:delete` | `ethos.events.remove(id)` | `deleted` + snapshot |
| `todos:create` | `ethos.todos.create({title, date, minutes})` | `todo` + snapshot |
| `todos:update` | `ethos.todos.update(id, patch)` | `todo` + snapshot |
| `todos:delete` | `ethos.todos.remove(id)` | `deleted` + snapshot |
| `todos:move` | `ethos.todos.move(id, -1 or 1)` | `todo` + snapshot (within its own list) |
| `todos:place` | `ethos.todos.place(id, {kind, index})` | `todo` + snapshot (drag and drop) |
| `habits:create` | `ethos.habits.create({name})` | `habit` + snapshot |
| `habits:delete` | `ethos.habits.remove(id)` | `deleted` + snapshot |
| `habits:toggle` | `ethos.habits.toggle(id, {date, done})` | `habit` + snapshot |
| `moods:set` | `ethos.moods.set({date, feeling, text})` | `mood` + snapshot (upsert by date) |
| `folders:create` | `ethos.folders.create({name})` | `folder` + snapshot |
| `folders:rename` | `ethos.folders.rename(id, {name})` | `folder` + snapshot |
| `folders:delete` | `ethos.folders.remove(id)` | `deleted` + snapshot (pages unfiled) |
| `pages:create` | `ethos.pages.create({folderId, temporary})` | `page` + snapshot |
| `pages:update` | `ethos.pages.update(id, patch)` | `page` + snapshot (patch may carry `links`) |
| `pages:delete` | `ethos.pages.remove(id)` | `deleted` + snapshot |

`events:create` / `events:update` also take `color` and `remindMinutes`.

There are two **main to page** events. `reminder` (to-dos), exposed as
`ethos.onReminder(callback)`, hands over `id`, `title`, `minutes`.
`event-reminder` (schedule), exposed as `ethos.onEventReminder(callback)`,
hands over `id`, `title`, `date`, `startMinute`. Plain data only: the IPC
event object, and with it the sender, never crosses. Both return an
unsubscribe function.

Main-side changes that are not a reply to a call (a reminder marking itself
`notified`) do **not** push a snapshot; the page sees them on its next
mutation. Harmless today; worth knowing before anything relies on it.

A patch carries only editable fields. Ids and timestamps are set in main and
cannot be supplied by the renderer.

### Saving

Two debounces in series. The renderer holds typing ~400ms
(`journals.js: TYPING_SAVE_MS`) then sends a patch; the store holds the disk
write ~500ms (`store.js: SAVE_DEBOUNCE_MS`). Flushed by: the note editor being
navigated away from (`views.onLeave`), closing the window, and `app.before-quit`.

`store.flush()` **queues a pass behind the one in flight** and never joins it.
A pass takes the dirty flags when it starts, so an edit made during a slow write
is still dirty and goes out in the next pass. `hasPendingWrites` counts queued
passes as well, so a quit cannot slip through during a write.

Closing the window is a handshake (`index.js` `requestCommit`): main keeps the
window open, sends `commit-request`, the page saves both editors (journal
`commitPending`, Notes `commitNotes`) and answers `closeReady()`
(`window:close-ready`), then the window closes. Grace is 1.5s, so a hung page
cannot block closing. Do not go back to saving on `beforeunload`: the message
races the teardown. If a write still fails at quit, the user is asked to
"Try again" or "Quit anyway". `store.dispose()` drops a pending debounce
without writing — for shutdown paths that already flushed, and for tests.

---

### Reminders and running in the background

Reminders are delivered by the **main** process (`reminders.js`), because the
plan lives in the store and the page may be closed or hidden — a timer in the
page stops mattering exactly when it is needed. It ticks every 15 seconds.

**Schedule events always raise a Windows notification**, window in front or
not, plus the in-app toast (with an Open button). That is the user's explicit
ask (2026-10-19): calendar alerts reach Windows itself. To-dos keep the
quieter rule below. Clicking any banner brings the window back, from the tray
if needed. `app.setAppUserModelId('com.ethos.app')` is set on Windows; without
it toasts from a dev build are mislabelled or dropped, and a packaged build's
installer must use the same id.

Delivery order is the design: the **in-app toast always goes first**, being the
product's own voice. A system notification is added only when the window is not
visible and focused, since a banner over the window the user is already looking
at is noise. The reminder is marked `notified` *before* delivery is attempted,
so a failure loses one reminder instead of repeating it every 15 seconds.

The scheduler is started from `ipc.register`'s `onRendererReady` callback, not
at boot, plus 1.5s for the page's listener to attach. Starting it earlier would
deliver a reminder that came due while the app was closed into a page that had
not loaded, and it would be marked sent and lost.

**Closing the window** hides it to the tray only while a reminder is still
pending (`store.hasUpcomingReminders()`); otherwise the app quits as before.
Once the window is hidden and nothing is left to remind about, the app quits
by itself (`onIdle`). `webPreferences.backgroundThrottling` is `false`, since a
hidden page is exactly when it is being relied on. The tray icon is drawn in
`tray.js` with zlib rather than shipped as a file. Quit for real from the tray
menu. `isQuitting` is set first thing in `before-quit`, which is what lets the
`close` handler tell "hide" from "really closing".

## 8. Notifications

Every noticeable thing the app does tells the user through one in-app toast
system: `renderer/js/notifications.js`, imported as `notify`. It is not on
`window` any more. Operating-system banners are raised only by main, for
reminders (see "Reminders and running in the background").

```js
notify.success(title, message)   // something the user did worked
notify.info(title, message)      // something happened worth noticing
notify.warn(title, message)      // nothing broke, but look
notify.error(title, message)     // an action failed; message is err.message
notify.show({ title, message, type, duration, action })
```

The surface is translucent with a backdrop blur, enters on the app's spring
(`cubic-bezier(0.34, 1.42, 0.64, 1)`) and leaves faster and without overshoot —
a bounce on the way out reads as indecision. The height collapse on `.out` is
what slides the rest of the stack down. The countdown length is passed from JS
as `--notif-duration` so the animation itself stays in the stylesheet.

`duration: 0` keeps a toast until it is dismissed. `action: { label, onClick }`
adds one inline button and dismisses the toast once it runs. At most 4 show at
once and the rest queue. Hovering pauses the countdown.

### What fires today

| Moment | Type | Text |
|---|---|---|
| Font changed in Settings | success | "Font changed" + the family |
| Task added | success | "Task added" + when the plan now ends |
| Task's estimated time is up | warn, sticky | "Time's up" + the task, with a Mark done button |
| Task deleted | info | "Task deleted" + its title |
| Habit added / deleted | success / info | "Habit added" / "Habit deleted" + its name |
| Every habit done today | success | "All habits done for today!" (once a day) |
| Daily journal goal reached | success | "You've hit your daily journal goal!" |
| Journal deleted | info | "Journal deleted" + its title |
| Event reminder | info, sticky | the event's title + "Starts at …", with Open |
| Event deleted | info | "Event deleted" + its title, with Undo |
| Note / folder deleted | info | "Note deleted" + title / "Folder deleted" + name |
| Vault failed to open | error, sticky | "Could not open your vault" |
| Any create/save/rename/delete/tag failure | error | "Could not …" + `err.message` |

### Rules for adding one

1. **Significant and user-initiated, or a milestone.** Routine saves stay
   silent — the app autosaves constantly and a toast per save would be noise.
2. **Every failed action gets an `error` toast.** A thrown IPC error that only
   reaches the console is a silent failure to the user.
3. **Name what it happened to.** "Journal deleted" plus the title, not just
   "Deleted" — deletion has no undo, so the toast is the only record.
4. **A milestone fires once.** The daily goal is guarded two ways: it only
   fires on the *transition* into the achieved state (opening the app on an
   already-finished day is silent), and then only once per calendar day via
   `localStorage`. Copy that shape for any future streak or goal.
5. **Titles and messages are set with `textContent`**, never parsed as markup.

### The daily journal goal

`renderer/js/journal-streak.js` owns it. A day counts as journalled when a note
was **created** that day and its content is non-empty (`MIN_CHARS`, currently
1 — raise it to make the goal "write something substantial"). The streak grid,
the calendar's filled-in days and the toast all read from that one definition,
so they cannot disagree.

## 9. Environment traps

These cost real time to rediscover.

- **`ELECTRON_RUN_AS_NODE=1` is set inside the VSCode/Claude Code shell.** It
  makes `electron.exe` run as plain node, so `require('electron')` yields a
  path string and `protocol`/`app` are `undefined`. Symptom: *"Cannot read
  properties of undefined (reading 'registerSchemesAsPrivileged')"*. Fix:
  `unset ELECTRON_RUN_AS_NODE` before launching. A normal user terminal is
  unaffected.
- **Electron on Windows is a GUI-subsystem binary: `console.log` from the main
  process does not reach a parent pipe.** `console.error` sometimes does.
  To get output from an automated run, write to a file.
- **Git lives in `H:/ethos` itself** (since 2026-10-21), pushed to the private
  repo `https://github.com/4phytocode/ethos` (`origin`, branch `main`). There
  is also an old, empty repo at the drive root `H:/`, owned by
  `NT AUTHORITY/SYSTEM`; git refuses it with *dubious ownership*, but the one
  in `H:/ethos` is found first, so that no longer matters. Do not "fix" it with
  `safe.directory H:/`, which would scope a repo to the whole drive.
  Line-ending warnings (LF → CRLF) on `git add` are harmless (`core.autocrlf`).
- **`protocol.handle` takes the scheme without a colon** — `'app'`, not
  `'app:'`. With the colon nothing matches and the page fails `ERR_FAILED`.
- **Use `pathToFileURL()`, never `'file://' + path`.** On Windows the latter
  reads the drive letter as the hostname.
- **Electron auto-quits when all windows close if nothing listens for
  `window-all-closed`.** Relevant to test harnesses that destroy a window
  mid-run.
- **`:hover` cannot be faked with `dispatchEvent`.** Hover-reveal UI has to be
  driven with `webContents.sendInputEvent` against a *shown* window, and the
  window must be focused with at least two moves (a neutral point, then the
  target) or the first event can land before the window is active and no hover
  transition runs. A single move is flaky and passes some runs.
- **An unfocused or occluded window gets its timers throttled.** Anything
  measured against a short `setTimeout` — a toast's 220ms removal, a 32ms
  class flip — then fails intermittently while the code is fine. Call
  `win.focus()` after load in any harness that measures timing, and re-run a
  suspicious failure before believing it.
- **`:focus-visible` needs a real key event.** A bare `.focus()` call does not
  set Chromium's focus modality, so send a real `Tab` first or the selector
  will not match and the test proves nothing.
- **`color-mix()` serialises as `color(srgb r g b / a)`, not `rgba()`.** A test
  that matches on the `rgba` prefix will report a translucent surface as
  opaque. Read the alpha from whichever form came back.
- **Driving the app from a harness.** An Electron entry script that calls
  `app.setPath('userData', <temp dir>)` *before* `require('src/main/index.js')`
  runs the real app against a throwaway vault (never point it at the real
  one). `capturePage()` for screenshots, `sendInputEvent` for mouse and keys,
  `insertText` for typing, `console-message` piped to a file for logs. Calls
  made straight through `window.ethos.*` bypass `state.js`, so the page's cache
  does not see them; go through the UI or `state.js`. Under `sendInputEvent`,
  `hasPointerCapture` reports false, so do not rely on capture alone.
- Shell heredocs in this environment mangle backslashes. When scripting an
  edit, anchor on text without escape sequences, or build backslashes with
  `chr(92)`.

---

## 10. Security posture

Set in `src/main/index.js` and `src/main/protocol.js`:

- Served over `app://ethos`, a standard + secure scheme. **This is load-bearing
  beyond tidiness** — the old `data:` URL had an opaque origin, which is why a
  CSP was impossible and why `localStorage`/`IndexedDB` threw. Persistence was
  unreachable, not merely unimplemented.
- CSP: `default-src 'none'`, `script-src 'self'`, `style-src 'self'`,
  `img-src 'self' data:`, `base-uri 'none'`, `form-action 'none'`,
  `frame-ancestors 'none'`.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `devTools` off when packaged.
- Navigation pinned to our origin; `setWindowOpenHandler` denies everything;
  webviews refused; all permission requests denied. External links go to the
  real browser via `shell.openExternal`, https only.
- Path containment in the protocol handler: `decodeURIComponent` first, then
  resolve, then require the result to sit inside `src/renderer`.
- Single-instance lock, so two windows cannot fight over one vault.
- `webContents.executeJavaScript` is **not** used anywhere and should not come
  back. Notification code used to be read off disk and evaluated at runtime,
  which made renderer code a function of a file's contents.

Verified by harness: `require` and `process` are `undefined` in the page, no
raw invoke is exposed, `/../main/vault.js` returns 404, a runtime `<style>` is
blocked, `localStorage` works.

---

## 11. Adding a feature

Every new subsystem (the Notes section was the latest) follows this exactly:

1. Add entity parsers and limits to `schema.js`. Bump `SCHEMA_VERSION` and add
   a migration if the on-disk shape changes.
2. Add load/save to `vault.js` using `#writeAtomic`. Decide the crash-blast
   radius: per-record files for documents, one file for a set of small records.
3. Add state and mutations to `store.js`. Keep them synchronous and pure over
   in-memory state; mark dirty and let the debounce write.
4. Add a channel to `ipc.js` and a function to the preload. Validate arguments
   in `schema.js`, not in the handler.
5. Add checks to `scripts/check.js`, including at least one restart
   round-trip and one rejected-input case.
6. Only then write renderer code. It calls through `state.js`, subscribes for
   redraws, and holds no authority.

---

## 12. Known gaps

Tracked in `todo.md`; repeated here because they shape design choices.

- The vault is **plain unencrypted JSON** under `userData`.
- No vault backup or export.
- Tag rename and recolour work in the model but have **no UI**.
- Deleting a note has no undo and no confirmation. Deleting an event at least
  names it in a toast.
- **Events accept `tagIds` in the model but there is no UI to set them.**
- The schedule has no recurring or multi-day events, and a timed event cannot
  be dragged into the all-day row (todo.md "Schedule").
- Notes are a first pass: no nesting, no rich text, no expiry for temporary
  notes, no delete confirmation.
- The journal streak counts a note on the day it was **created**. Writing up
  yesterday's entry today counts for today, and there is no way to backdate.
- Journal view preferences and appearance live in `localStorage`, so they are
  per-machine and will not follow a user to another install once accounts exist.
- **Blockers is a placeholder.** The button and its "Coming soon, EthosBlock"
  caption exist; it does nothing. Blocking websites cannot be done from inside
  Electron: it needs the planned browser extension, and a way for Ethos to tell
  it what to block (native messaging or a local port). Not designed yet.
- Real operating-system notification delivery has not been exercised on a
  second machine. The scheduler's choice to raise one is tested; the banner
  itself is Electron's `Notification`.
- Past days cannot be ticked from the habit page (the model supports it).
- The habit grid duplicates the drawing code in `journal-streak.js`. They share
  only CSS. A shared `drawGrid` would remove it.
- The homepage scrolls at small window heights now that the to-do card is
  bigger.
- Settings has only an Appearance section. No text size, no data/vault
  controls, no account section.
- Reminders reach Windows only. Nothing reaches a phone yet (§1).
- No TypeScript, no linter; `scripts/check.js` is a hand-rolled runner.

Given the subscription direction, encryption at rest and export are the two
worth doing before a paid release.

---

## 13. Decisions already made (do not silently reverse)

| Decision | Why |
|---|---|
| Obsidian's local-first model, not Notion's synced block tree | single-user desktop app; server-authoritative complexity buys multiplayer that isn't needed, and local files mean data outlives the app |
| JSON per note, not Markdown + frontmatter | no hand-written parser in the layer holding user data; export stays a pure function |
| Hand-written validators, no Zod | ~150 lines, no dependency in a paid build, nothing to be compromised upstream |
| Ids opaque and prefixed (`n_`/`t_`) | safe as filenames, stable across sync, no meaning to leak |
| Full snapshot returned on every mutation | eliminates cache drift; the data is tiny at this scale |
| Mutations return copies | a renderer reference cannot mutate main's state |
| `tagIds` array with a one-tag UI | many-to-many later is UI work, not a migration |
| Event dates as local `YYYY-MM-DD`, times as minutes from midnight | no timezone in the record; sorting and overlap are arithmetic |
| Events in one file, notes one file each | records vs. documents; see §5 |
| The schedule was built before the habit tracker | user's call, 2026-10-18; it also exercised the migration path while the vault was still young |
| ~~Schedule UI removed, model kept~~ *(superseded 2026-10-19: the schedule was rebuilt)* | user's call, 2026-10-18: it needs rework, and keeping the validated model makes resuming cheap |
| View-scoped chrome via `body[data-view]` | a fixed bar over a scrolling view silently eats its content; see §3 |
| One `--font-ui` for the whole app | the editor's hard-coded serif was the one surface the setting could not reach |
| The plan is computed in main, not the page | reminders have to fire with the window closed, and two copies of the plan would disagree |
| To-dos chain end to end from now | the user asked for finish times across several tasks; per-task fixed start times were not requested |
| Close hides to the tray only while a reminder is pending | running in the background for the whole session would be an unwelcome surprise for an app with nothing to remind about |
| Reminder scheduler waits for the page | an overdue reminder at launch must not be sent into a page that has not loaded |
| The Ethos "e." logo is the app icon | user's call, 2026-10-19: replaces Electron's default; tray and in-app marks left as they were |
| IBM Plex Mono is the default font | user's call: calm and professional across the whole app; System UI remains as an option. Shipped in `renderer/fonts`, never fetched |
| Schedule rebuilt on the kept model; gestures over forms | user's call, 2026-10-19: Google Calendar-like but minimal, "drawing like liquid". References in `references/` |
| Event reminders always raise a Windows banner | user asked for calendar alerts to reach Windows; to-dos keep the quieter in-front rule |
| Event colour from the tag palette, not free choice | a colour is written into a style property; the palette check is the CSS-injection guard |
| A dismissed, untouched new event is deleted | drawing should feel like sketching; an unnamed stroke is rubbed out |
| Sidebar on the right, Notion-style, hideable | user's call, 2026-10-19: full names instead of initials |
| Notes are a separate model from journals | different lifecycle; the journal streak counts journals only. Merge is an open question |
| Deleting a Notes folder keeps its notes | deletion has no undo; losing a folder's contents to one click is too costly |
| Work order: schedule, journals, sidebar, notes, then a debugging pass | user's call, 2026-10-19; bugs are logged in bugs.md, not fixed inline, unless they block the work |
| Note links stored by id on the page (`links`), not as `[[Title]]` text | a title in the text breaks on rename; an id cannot. Same rule as tags (§5) |
| The graph only reads the model; links are made in the note | one place that writes links; the graph stays a picture |
| Graph drawn on a canvas with a hand-written force layout | no library under the CSP; a few hundred nodes stay cheap; springs match the schedule's feel |

---

## 14. 2026-10-21 pass: homepage and journal

- **Backdrop** (`backdrop.js`, `backdrop.css`). `#backdrop` is the first child
  of `<body>`, fixed, no z-index, `pointer-events: none`, so everything paints
  over it. `body[data-bg]` = off | gradient | image, `body[data-bg-scope]` =
  home | all. Always under a `--bg` veil (0.42 light / 0.5 dark / 0.72 image):
  **that veil is the readability guarantee; do not weaken it.** Default is
  gradient on the homepage. Gradient: palettes aurora / dawn / ocean / forest /
  dusk (light + dark variants in CSS via `body[data-bg-palette]`) or custom
  (three colours set inline as `--bd-a/b/c`, hex-validated), speed slow / normal
  / fast via `body[data-bg-speed]`. Image: eight bundled Unsplash presets in
  `renderer/backgrounds/` (credits in its README; bundled so the CSP stays
  "no remote anything"), or the user's own file, read with FileReader (the CSP
  has no `blob:`), downscaled to 2560px JPEG (q 0.9) and kept in localStorage
  `ethos.backdropImage`. `protocol.js` now serves `.jpg`.
- **Mood** (`mood.js`). Card next to the quote: Good / Bad / Write down, then
  an optional 1-2 sentence field and Done (Enter also saves). "Write down"
  requires text. Saved via `moods:set`; the Mood log view (`#mood-page`,
  sidebar "Mood log", card "Log" button) lists the last 30 days newest first,
  "Show earlier days" adds 30. Gaps render as "Not logged" and are never stored.
- **Homepage habits** (`habits.js renderHome`). Replaces the fixed habit bar.
- **Homepage grid**: `#home` is a two-column grid (quote / mood, clock / to-do,
  habits across both). `.home-top` and `.home-row` are `display: contents`.
  Left edges and right edges line up; `test:ui` asserts it. One column under 900px.
  With the sidebar hidden (`body.sb-hidden`) the grid centres in the window.
- **UI test** (`scripts/ui-test.js`): loads the real main process with
  `userData` pointed at a temp folder, drives the page via `executeJavaScript`,
  saves screenshots there. VS Code terminals set `ELECTRON_RUN_AS_NODE`, which
  makes `electron` run as plain node (`app` is undefined): unset it first.
- **`data-view-link`**: any button with it navigates to that view (views.js).
- **Journal list**: "+ New Journal" now sits under the tabs, search and filter
  bars, directly above the list.
- **Journal prompts** (`prompts.js`). "Show prompts" is always visible top right
  of the journal page. After `NUDGE_MS` (30s; the UI test shortens it through `ethos.test.nudgeMs`) of no
  typing on a page with fewer than 12 characters, a nudge offers prompts, once
  per idle spell. Panel: Gratitude / Surprise me, Another, Use this (inserts the
  prompt as the first line and saves), No thanks. Lists are in `prompts-data.js`,
  the Gratitude list is the 50 prompts from `references/journalling.txt` (loaded 2026-10-23; bugs.md 8.1).
- **Paper**: Plain / Lines / Grid on every journal page. Rules are `1lh` apart so
  they follow the font size, `background-attachment: local` so they scroll with
  the text. Per note in localStorage `ethos.paper` (`{ notes: {id: mode}, last }`),
  falling back to the last choice.

## 15. 2026-10-21 pass: the day plan (to-do revamp)

Modelled on the daily-list habit from Cal Newport's *How to Become a Straight-A
Student*: each morning, write specific tasks, give each a time, and let the plan
say when the day's work ends. All wording in the UI is our own.

- **Two lists per day.** `kind: 'task'` (planned, can be timed) and
  `kind: 'remember'` (kept in mind, never timed; `parseTodo` strips minutes and
  `startMinute` from it). The page shows them side by side: To do | To remember.
- **Typed times.** One input; `js/todo-parse.js` reads "45m", "1h30", "1.5 hours",
  "at 2pm", "@ 14:30", "2-3pm", "10:30-11:15" out of the text and removes them
  from the title. A bare "at 3" (1-7, no am/pm) is the afternoon. Pure module;
  `formatEntry` writes the inverse for the inline editor. A live preview under
  the input shows length, start and finish ("Done about" when unpinned; that one
  is approximate, main's plan is authoritative).
- **Pinned tasks.** `startMinute` fixes a task to a time. `#rechain` places
  pinned blocks first, then chains unpinned tasks from now, stepping each past
  any pinned block it would overlap. Tested in check.js.
- **Drag and drop.** HTML5 DnD on rows; a drop line marks the spot; dropping
  calls `todos:place` with the target list and index (index counts that day's
  items of that kind). Moving into "remember" drops the times. Alt+Up/Down
  reorders by keyboard (`todos:move`, now scoped to the item's own list).
- **Inline edits.** Double-click a title to rename; click the time line to type
  a new time (same parser). Renders are skipped while an inline input is focused.
- **Schedule.** `todo.js plannedSpan(t)` gives a task's minutes on the clock
  (today: from `dueAt`; any day: from `startMinute`). schedule.js draws these as
  dashed `.sc-todo` blocks that share the event column layout, and remember items
  + untimed tasks as `.sc-todo-chip` in the all-day row; month cells get an
  "N to-dos" chip. They are read-only there: click opens that day's list
  (`openTodoDay`). They stop pointerdown so they never start an event drag.
- **Notifications.** Adding a task toasts its finish time and slot, with a
  "Show schedule" action. The existing "Time's up" reminder still fires at `dueAt`.
- Homepage card lists tasks only, with remember items on one dashed line below.

## 16. Note links and the graph view (2026-10-21)

Modelled on Obsidian's graph. Covers the Notes section (pages and folders);
journal notes are not in it.

- **Links.** `page.links` is the list of pages a page links to, by id. Backlinks
  ("Linked from") are worked out from every other page's links and never
  stored, so the two directions cannot disagree. `parsePage` drops a link to
  itself and collapses duplicates; `store.updatePage` drops links to pages that
  do not exist (a stale cache); `store.deletePage` strips the deleted id from
  every page that linked to it. Cap: 200 links per page. A v6 page has no
  `links` and reads as `[]`.
- **In the note.** Under the title: a "Links" row of chips (click opens, ×
  unlinks) and "+ Link note", a picker filtered as you type (arrows, Enter,
  Esc). "Linked from" shows only when something links here. Chips are redrawn on
  every snapshot; only a new chip animates in (`.settled` holds the rest still).
- **The graph** (`#graph-page`, `graph.js`, `graph.css`) is its own view.
  Toggled by the graph icon in the sidebar's Notes header, the "Graph view"
  button on the Notes home, or **Ctrl+G** anywhere; toggling again (or Esc, or
  ×) goes back to the view you came from. Pages are dots sized by link count
  (temporary ones hollow), folders are rings, the open note wears an outer ring.
  Solid line = link (thicker when both ways), dashed = page in folder.
- **Layout** is a small force simulation in the page: pairwise push, springs on
  lines, a weak pull to the centre, all scaled by a cooling `alpha`. The frame
  loop runs only while something moves, and stops when the view is left. First
  open settles out of sight, then fits. Positions are kept across rebuilds (a
  new node starts beside a neighbour), not across sessions.
- **Input.** Drag a dot to move it (neighbours follow on their springs), drag
  empty space to pan, wheel to zoom at the pointer, double-click empty space or
  F to fit, +/- to zoom. Hover lights a node and its neighbours (a spring swells
  the dot); a one-way link shows an arrowhead while lit. Click a page to open it;
  click a folder to keep its family lit. A press that travels under 4px is a click.
- **Panel.** Counts, a find box (lights matches; Enter centres the first),
  toggles for Folders / Unlinked notes / Temporary (localStorage `ethos.graph`),
  Fit to view. Fit uses the space beside the panel.
- **Keyboard and screen readers.** `#gr-list` is a visually hidden list of every
  note as a button; Tab reaches each, focusing one lights it and brings it into
  view, Enter opens it. The UI test drives the graph through it.
- Colours come from `--fg` / `--muted` / `--bg` and are re-read on
  `onThemeChange`. The canvas exposes `data-nodes` / `data-links` for tests.

---

## 17. Start here (for the next session)

Read in this order, and stop as soon as you have what you need. Only open a
source file once a section here or in `Efficiencies.md` has sent you to it.

1. **This file, sections 1, 2, 6 and 13.** What the app is, how to run and
   test it, invariants, and decisions already made.
2. **`progress.md`.** What was done last, and what is next.
3. **`bugs.md`, sections 8 to 10.** The newest open items. Earlier sections
   (1-7) are the 2026-10-18 audit and still stand.
4. **`Efficiencies.md`, Storage section.** The storage plan and its estimates.
5. The section of this file that covers the feature you are changing (3, 5,
   8, 14, 15). Only then the file it names.

### Where things live, by feature

| Feature | Main process (authority) | Renderer (drawing) | Tests |
|---|---|---|---|
| Vault / disk | `src/main/vault.js` | none | `check.js` restart cases |
| Validation / schema | `src/main/schema.js` (`SCHEMA_VERSION` 7) | none | `check.js` rejected inputs |
| Store / plan | `src/main/store.js` (`#rechain`) | `js/todo.js` (display only) | `check.js` "to-do day plan" |
| Reminders | `src/main/reminders.js` | `js/todo.js` `initReminders` | `check.js` schedule reminders |
| Schedule | IPC `events:*` | `js/schedule.js` | `ui-test.js` to-do section |
| To-do page | IPC `todos:*` | `js/todo.js`, `js/todo-parse.js` | `ui-test.js`, `check.js` |
| Habits | IPC `habits:*` | `js/habits.js` | `check.js` habits |
| Mood log | IPC `moods:set` | `js/mood.js` | `check.js` moods |
| Journals / Notes | IPC `notes:*`, `pages:*` | `js/journals.js`, `js/notes.js` | `check.js` note links |
| Note links / graph | `pages:update` (`links`), `store.deletePage` | `js/notes.js`, `js/graph.js` | `check.js` note links, `ui-test.js` graph section |
| Prompts / paper | none (local prefs) | `js/prompts.js`, `js/prompts-data.js` | `ui-test.js` journal section |
| Backdrop / settings | none (local prefs) | `js/backdrop.js`, `js/settings.js` | `ui-test.js` background section |

### Rules for the next session
- **Run `npm run check` (84 checks) and `npm run test:ui` (55 checks)** before
  and after any change. Use `env -u ELECTRON_RUN_AS_NODE` in VS Code terminals.
- **Log every change here or in `progress.md`**, and every bug you notice in
  `bugs.md`, not inline.
- **Do not add a feature that needs the network** (accounts, sync, Unsplash
  at runtime) without a CSP change and a decision recorded in section 13.
- **Storage work** follows `Efficiencies.md`, Storage, in that order.

### Open decisions waiting on the user
- Pinned to-do in the past: move it to now, or keep its slot (bugs.md 9.1).
- Whether to move the uploaded background image into the vault (bugs.md 10.2).
- Packaging: Electron with electron-builder (about 80-95 MB installer) or a
  rewrite to Tauri (about 5-10 MB). See Efficiencies.md.

