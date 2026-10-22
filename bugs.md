# Ethos — bug audit

**Doc truth pass, 2026-10-23:** §3.2, §4, §6.7, §6.8, §8.1, §10.5, §10.10 and §10.12
are updated or closed in place; the original text is kept as the record.

**Fix pass, 2026-10-21 (night):** the data-loss races (§1), §2.2, §2.8, §6.1–6.5
are fixed; see headings and `progress.md`. Everything else below is still open.
The original text is kept as the record of what was found.

Findings from a read-only pass over every project `.js` file (`src/main`,
`src/preload`, `src/renderer/js`, `scripts`) plus the HTML/CSS, cross-checked
against `CONTEXT.md` and `todo.md`. Nothing was changed in code; this file is
state-only.

Severity key: **race** = can lose data · **logic** = wrong behaviour ·
**gap** = missing functionality · **cosmetic** = minor · **docs** = drift.

**Re-audited later the same day**, after edits landed between 22:48 and 23:11
(`settings.js`, `settings.css`, `package.json`, `index.html`, `base.css`,
`clock.css`, `todo.md`, `CONTEXT.md`; `scripts/build-pixel-font.js` and
`src/renderer/fonts/` deleted). Everything under `src/main`, `src/preload`,
and the renderer modules other than `settings.js` is untouched since the first
pass, so findings 1–3 all still stand. New material: §2.8 (new bug), §4
(re-checked drift), §5 (verified-clean re-audit of the changes).

---

## 1. Race conditions (data-loss class)

### 1.1 A debounced save can be swallowed by an in-flight flush — `src/main/store.js` (race, **fixed**)

`flush()` returns early with `if (this.flushing) return this.flushing` **before**
touching the dirty flags or the timer. Sequence:

1. Flush A starts (its timer already nulled itself when it fired).
2. An edit arrives mid-flush → `#schedule()` sets a new 500ms timer.
3. The timer fires while flush A is still running → the callback nulls the
   timer, calls `flush()`, which returns the in-flight promise A and does
   nothing else.
4. The newly-dirty notes are now marked dirty with **no timer scheduled**.

They stay unwritten until the *next* edit or an explicit flush. Requires a
flush to take >500ms (slow disk / network drive), but then it stalls silently.

### 1.2 `before-quit` can miss pending writes — `src/main/store.js` + `src/main/index.js` (race, **fixed**)

Two variants of the same underlying race:

- **(a)** A write is mid-flight, so its dirty flags were already cleared and
  `hasPendingWrites` is `false` → the `before-quit` handler returns
  immediately and the app can exit before the `rename` lands.
- **(b)** An edit arrives during an in-flight flush → `hasPendingWrites` is
  `true`, so the handler calls `store.flush()` — but that returns the *stale*
  in-flight promise (which does not contain the new edit) →
  `.finally(() => app.quit())` quits anyway.

Both lose the most recent change, which is exactly the window the comment in
`index.js` ("Anything typed in the last half second…") claims is protected.

### 1.3 `beforeunload` → `commitPending()` is fire-and-forget — `src/renderer/js/app.js` (race, **fixed**)

The IPC invoke is posted synchronously during `beforeunload` (so it usually
gets out), but its ordering against `window-all-closed` → `before-quit` in the
main process is not guaranteed, and the follow-up `state.flush()` almost
certainly never completes because the renderer is torn down. The last ≤400ms
of typing (`TYPING_SAVE_MS`) can be lost on window close.

### 1.4 Failed writes during quit are dropped silently — `src/main/store.js` + `src/main/index.js` (race/logic, **fixed**)

Per-write errors inside `flush()` are caught, re-marked dirty, and logged to
console — but `before-quit` sets `quitting = true` *before* flushing and never
checks the result, so the second `before-quit` exits unconditionally. A disk
error during quit loses that data with only a console line (which per
`CONTEXT.md` §9 does not reach any pipe on Windows in a packaged run).

---

## 2. Logic bugs

### 2.1 Stale filter ids keep the list filtered to nothing — `src/renderer/js/journals.js` (logic, currently latent)

`activeTagIds` is never pruned when a tag disappears. If a tag is deleted
while its filter is active, `visibleNotes()` matches nothing → the grid shows
"Nothing matches that." with **no visible pill to turn the filter off** (the
deleted tag's pill is gone from `renderFilterBar`). Workaround today: toggle
the whole filter bar off/on. Latent because no UI path can delete a tag yet
(`state.removeTag` has zero callers) — but the bug ships the moment tag
deletion gets a UI.

### 2.2 `no such note` / `no such event` reach the renderer as a generic error — `src/main/store.js`, `src/main/ipc.js` (logic, **fixed**)

`store.updateNote` / `store.updateEvent` throw plain `Error('no such note')`
and `Error('no such event')` (store.js:142, 195), not `ValidationError`s.
`ipc.js` only passes `ValidationError` messages through, so the renderer sees
the generic **"The operation failed."**, and the error is additionally logged
to main as an unexpected internal failure. Inconsistent with how every other
user-facing failure is reported.

### 2.3 `isoDate` rejects years 0001–0099 — `src/main/schema.js` (cosmetic, theoretical)

The round-trip probe uses `Date.UTC(y, …)`, and `Date.UTC` maps years 0–99 to
1900–1999, so e.g. `0050-01-01` fails the `getUTCFullYear() !== y` check.
Purely theoretical for a planner app.

### 2.4 The context menu can render off-screen — `src/renderer/js/views.js` (cosmetic; fixed 2026-10-23: clamped to the window)

`showCtx()` positions the menu at raw `event.clientX/clientY` with no
viewport clamping; a right-click near the right or bottom edge pushes it
partially or wholly off-screen.

### 2.5 `net.fetch` is unguarded in the protocol handler — `src/main/protocol.js` (cosmetic)

The file passes `stat`, then `net.fetch(pathToFileURL(target))` runs with no
`try/catch` and no `res.ok` check (status is hardcoded 200). If the file is
deleted between the two calls the handler throws instead of returning 404.
Theoretical. (A symlink inside `src/renderer` would also bypass the
containment check — not exploitable today, since nothing untrusted can create
files there.)

### 2.6 The font-availability probe cannot detect substitution — `src/renderer/js/settings.js` (cosmetic, currently dormant)

> Still dormant on 2026-10-23: Plex Mono and System UI both have `probe: null`.

The canvas-width probe treats a substituted face (e.g. `Helvetica` resolving to
Arial on Windows) as "installed", so the "Not installed — falls back" badge
only triggers for families with no substitute at all. **Dormant since the
re-audit:** the font registry was pared down to the single `system` entry,
whose `probe` is `null`, so `isInstalled(null)` short-circuits to `true` and
`flagAvailability` can never fire. The machinery — plus the `.set-font-missing`
and `.set-font.missing` rules still sitting in `settings.css` — is now
forward-compatibility scaffolding rather than live logic. It becomes a real
bug again the moment a `probe` is added without fixing the substitution
weakness.

### 2.7 Tag palette is empty if the vault fails to open — `src/renderer/js/state.js` + `src/renderer/js/tags.js` (cosmetic)

`tagColors` is populated only by `state.load()`. If that fails, `initTags()`
still runs and `buildSwatches()` renders **zero** swatches; `selectedColor`
stays `null`, so the first create attempt fails with the confusing
"tag.color must be a string". Moot in practice, because every IPC call would
fail in that state anyway.

### 2.8 "Font changed" fires even when nothing changed — `src/renderer/js/settings.js` (cosmetic, **fixed**)

`choose()` unconditionally toasts `notify.success('Font changed', …)`. Since
the re-audit the font section holds exactly one card — the already-active
`system` font — so the only interaction the Settings page offers is clicking
that card and being told the font "changed" to what it already was. The toast
should be skipped when `id === fontId`.

---

## 3. Missing functionality (gaps)

### 3.1 There is no way to remove a tag from a note — `src/renderer/js/tags.js` (gap)

`assign()` only ever sets `tagIds: [tagId]`, and clicking the already-selected
tag in the picker is a no-op (it re-sends the same single id, which the
store detects as unchanged). Once applied, a tag can only be *replaced*,
never cleared — the model happily accepts `tagIds: []`, the UI never offers it.

### 3.2 ~~The events/schedule model is fully built but dormant~~ (stale: the schedule was rebuilt 2026-10-19 and uses `events:*`)

`events:create/update/delete` channels, the three preload functions, and
`state.createEvent/updateEvent/removeEvent/eventsOn` all have **zero callers**;
`schedule-page` is an empty placeholder the sidebar still opens. This is
deliberate (schedule UI pulled 2025-10-18, see `todo.md`), but 3 of the 10 IPC
channels exist for nothing, and `state.eventsOn` / `state.removeTag` are dead
exports.

---

## 4. Documentation drift — `CONTEXT.md`, `todo.md` (re-checked after the doc update; still open)

> Closed 2026-10-23: the counts below were out of date (25 IPC channels, 84 checks). Fixed in the doc pass.

Both docs were updated after the first audit (23:01 and 23:11). The new
material is accurate — the homepage layout section, the habit-tracker
roadmap, the font pare-down ("Only System UI ships for now"), and the
dormant-`events:*` note all match the code. The original drift, however, was
**not** corrected:

- **IPC count:** `CONTEXT.md` §3 still says "the 7 IPC handlers", §7's
  heading still says "Seven channels", and `todo.md` still says "Validated
  IPC surface (7 calls)" — `ipc.js` registers **10**. It is now internally
  contradictory: §6 invariant 7 correctly says "10 calls", and the §7 table
  itself lists all 10 rows directly under the "Seven" heading.
- **Check count:** `CONTEXT.md` §2 and `todo.md` still say "12 model-layer
  checks" / "16 checks" — `scripts/check.js` now runs **28**. Re-verified
  this pass: `npm run check` → "28 passed, 0 failed".
- **Dead reference:** `CONTEXT.md` §5 still tells the reader that date
  arithmetic "goes through the helpers at the top of
  `renderer/js/schedule.js`" — that file no longer exists; its helpers now
  live as local `isoOf` copies in `journals.js` and `journal-streak.js`.

---

## 5. Second pass — the post-audit changes, checked one by one

Files touched after this report was first written: `settings.js`,
`settings.css`, `package.json`, `index.html`, `base.css`, `clock.css`,
`todo.md`, `CONTEXT.md`; `scripts/build-pixel-font.js` and
`src/renderer/fonts/` deleted. Result: the removals are consistent, the
additions are wired correctly, and the only new defect found is §2.8.

- **Pixel-font removal is complete and consistent.** `FONTS` is down to one
  `system` entry, `DEFAULT_FONT = 'system'`, the `font-pixel` class toggle
  and the `document.fonts` readiness probe are gone from `settings.js`, the
  `@font-face` is gone from `base.css`, the generator script and the
  `fonts/` directory are deleted, and the `build:font` npm script is
  removed from `package.json`. A grep for `ixel` across `src/` returns
  nothing — no dangling references anywhere.
- **Old stored prefs degrade gracefully.** An `ethos.appearance` value
  naming a removed font (`helvetica`, `pixel`, …) is ignored by `load()`'s
  `FONTS.some(...)` filter, so the app falls back to System UI instead of
  breaking. (Documented intent in `CONTEXT.md` §3; verified against the
  code.)
- **The new homepage pieces are wired correctly.** `.todo-card` is a static
  placeholder and its styles exist in `base.css`. `.habit-bar` is scoped to
  `home` + `habit-page` via `body[data-view]`, `#home` reserves 180px of
  bottom padding and `#habit-page` 140px for it — the overlap bug class the
  docs warn about does not recur. `views.js` seeds `data-view` before first
  paint, so the bar shows on the right views from the start.
- **Settings DOM ids all exist.** `set-theme`, `set-fonts`,
  `set-preview-title`, `set-preview-text` are all present in the updated
  `index.html`, so `initSettings()` cannot hit a null element.
- **Clock readout moved above the face** (`clock.css`) — matches the DOM
  order in `index.html` and the element map in `clock.js`; no mismatch, and
  `shape-rendering: geometricPrecision` is retained.
- **Intro art is theme-safe.** `#intro-e` is `fill="#ffffff"`, which looks
  like a light-mode bug, but `#intro` paints a fixed `#000000` backdrop
  until `.reveal` — intentional, checked and clean.
- **Model layer still healthy:** `npm run check` → **28 passed, 0
  failed** (including the quarantine and hostile-id cases).

---

## 6. Third pass (2026-10-19) — found while reviewing for efficiency

Read-only again; nothing was run except `npm run check` (60 passed, 0 failed).
Items marked *from reading* have not been reproduced in the app.

### 6.1 A refused or unreadable vault leaves Ethos running with no window — `src/main/index.js` (logic, **fixed**; not exercised in the running app)

`app.whenReady().then(async () => { … await vault.init(); await store.load(); … })`
has no `catch`. `store.load()` throws a `ValidationError` for a vault written
by a newer build (`schema.migrate`), or any I/O error from `vault.init`. The
rejection is unhandled, `createWindow()` is never reached and `ipc.register`
never runs, so the process sits in the background with no window, no tray and
nothing to tell the user. It also means the renderer's "Could not open your
vault" toast (`app.js`) can never appear for this case, because there is no
renderer. Needs a `catch` that shows an error box and quits.

### 6.2 The app stays at midnight on yesterday — `habits.js`, `journal-streak.js`, `journals.js` (logic, **fixed**)

Only `todo.js` has a timer (`setInterval(render, 30000)`). The habit list,
habit grid, the homepage habit bar, the journal streak and the calendar's
"today" are drawn from `todayISO()` at the moment of the last state change.
Leave the app open across midnight and the habit tick boxes still show
yesterday's state; ticking one then calls `todayISO()` afresh and ticks the new
day, so the box the user clicked and the day that changed disagree. `knownAchieved`
/ `knownAllDone` are also still yesterday's, so the first change after midnight
can fire or suppress the goal toast wrongly. Fix with a day-rollover check on
the existing timer (or `visibilitychange`) that re-renders those views.

### 6.3 A habit with more than 4000 ticks is dropped on the next launch — `schema.js` / `store.js` (race-class data loss, theoretical, **fixed**)

`parseHabit` rejects `doneDates.length > MAX_DONE_DATES (4000)`, but
`store.toggleHabit` appends with no such check. The 4001st tick (about 11
years of daily use) saves fine, then at the next load `parseHabit` throws and
`vault.#loadList` logs "dropping invalid habits entry" and discards the habit
and its whole history. Validate on write, or raise the cap well above what a
person can reach.

### 6.4 Failing the single-instance lock may still start a second app — `src/main/index.js` (logic, **fixed**; the lock is now taken before startup)

The lock check runs at module load and calls `app.quit()`, but the
`app.whenReady().then(…)` block above it is already registered. Whether
Electron skips it on a quit-before-ready is not something I could confirm; if
it runs, a second process loads the same vault, builds a `Store` and a window
for an instant, which is exactly the double-open the lock exists to prevent.
Cheap to make certain: do the lock check first and only register `whenReady`
in the success branch.

### 6.5 `todo.js` comment says once a minute, code says 30 s (docs, **fixed**)

`setInterval(render, 30000)` sits under a comment that says "redraw once a
minute".

### 6.6 Rename input is destroyed by unrelated updates — `journals.js` (cosmetic)

`startRename` swaps the title for an `<input>` inside the grid, and
`renderList()` begins with `els.grid.innerHTML = ''`. Any state change while
renaming (a to-do reminder's "Mark done", an autosave from elsewhere) wipes the
input and the half-typed title with it. Related to Efficiencies item 2.

### 6.7 More documentation drift — `CONTEXT.md`, `todo.md`, `bugs.md` (docs; closed 2026-10-23)

- `todo.md` still says "Validated IPC surface (7 calls)" and "12 model-layer
  checks" / "16 checks"; `npm run check` now runs **60**, and there are 17
  handlers (`ipc.js`). `bugs.md` §4 above still quotes "10" and "28", which
  were true at the time of that pass.
- `CONTEXT.md` §3 says git is unusable "(see §8)"; that is §9. §8 is
  Notifications.
- `CONTEXT.md` §6 invariant 7 says "instead of 10 calls"; `preload` and
  `ipc.js` say seventeen.
- `CONTEXT.md` §5 still names `renderer/js/schedule.js`, which no longer exists
  (carried over from §4).

### 6.8 Fonts: the OFL licence text is not in the repo yet (docs / compliance; closed 2026-10-23: `LICENSE-IBMPlexMono.txt`)

Plex Mono's licence requires its text to ship with the font. `fonts/README.md`
says so but does not include it. Add upstream `LICENSE.txt` before an installer
is built.

---

## 7. Found while building the schedule, sidebar and Notes (2026-10-19)

Logged for the beta debugging pass. Items marked **fixed** were blocking and
were fixed in the same session; the rest are open.

### 7.1 `hidden` attribute lost to class `display` rules — `styles/*.css` (logic, **fixed**)

A class that sets `display: flex` beats the UA `[hidden] { display: none }`.
The schedule's closed editor (`.sc-pop`) stayed laid out at opacity 0 and
caught the pointerup of every drag over it, so moving an event silently did
nothing. Fixed with a global `[hidden] { display: none !important }` in
`base.css` and `pointer-events: none` on the closed popover. Older per-class
`[hidden]` overrides (`.hb-add`, `.jr-filterbar`, `.jr-cal-nav`) are now
redundant but harmless.

### 7.2 Pointer capture not held under synthetic input — `schedule.js` (logic, partly mitigated)

With `webContents.sendInputEvent`, `hasPointerCapture()` returned false right
after `setPointerCapture()`. Gestures now listen on `window`, so the release
always lands. Not yet checked with a real mouse, pen or touchscreen whether
capture holds there; check before relying on it anywhere else.

### 7.3 Schedule jumped back to midnight after leaving and returning — `schedule.js` (logic, **fixed**)

A redraw while the view was hidden read `scrollTop` 0 and restored it. Scroll
is now tracked from `scroll` events only.

### 7.4 Short events lost their title — `schedule.css` (cosmetic, **fixed**)

On a one-line (under 45 min) event the time took all the width. The title now
keeps its room and the time truncates.

### 7.5 Main-side changes are not pushed to the page — `ipc.js` / `state.js` (gap)

A reminder marking an event or to-do `notified` changes main's state without a
snapshot reaching the page; the cache catches up on the next mutation.
Harmless today. Becomes a bug the moment the UI shows "reminder sent".

### 7.6 Events that cross midnight are cut off — `schedule.js` (gap)

The model allows `startMinute + durationMinutes` past 24:00. The grid clamps at
midnight and shows nothing on the next day. Needs either a model rule (cap at
midnight) or a continuation block.

### 7.7 Undo after deleting an event loses `done` and `tagIds`, and makes a new id — `schedule.js` (cosmetic)

Undo re-creates the event from its fields. Fine for now; a real undo needs a
restore call in main.

### 7.8 "Up next" and the now line refresh only while the schedule is open — `schedule.js` (cosmetic)

A once-a-minute redraw runs only when the schedule is the current view. On
return it redraws, so this is only visible if something else reads the list.

### 7.9 Notes: no confirmation, no undo, temporary notes never expire — `notes.js` (gap; confirmation added 2026-10-23, undo and expiry still open)

Deleting a note is immediate (a toast names it). "Temporary" is only a label
until the expiry rule is decided (todo.md).

### 7.10 Notes rename input can be wiped by an unrelated redraw — `notes.js` (cosmetic)

The tree redraws on every snapshot. If a snapshot lands while a folder name is
being edited (e.g. an autosave from the open note), the input is rebuilt from
the stored name. Same class of bug as §6.6 in journals.

### 7.11 Windows banners not verified by eye — `src/main/index.js` (gap; still open on 2026-10-23: the packaged app runs, but no banner was seen)

The scheduler's decision to raise one is tested (`npm run check`), and
`setAppUserModelId('com.ethos.app')` is set, but the banner itself has not
been looked at on a desktop, nor in a packaged build.

### 7.12 Harness-only: deprecated `console-message` arguments (docs)

Electron 44 warns that the positional arguments of `console-message` are
deprecated. Only the test harness uses it; switch to the event object when a
real Playwright suite replaces it.

---

## 8. Found during the 2026-10-21 homepage / journal pass

Logged, not fixed, unless noted.

### 8.1 `references/journalling.txt` is empty (gap; closed 2026-10-23: 50 prompts loaded)
0 bytes on disk, so the Gratitude prompts could not be taken from it. Ethos ships
its own list in `renderer/js/prompts-data.js` for now. Paste the prompts into the
file (or straight into `GRATITUDE`) and they can be swapped in.

### 8.2 `views.onEnter` / `onLeave` keep one hook per view (logic)
`hooks.leave[viewId] = fn` overwrites. A second module registering for the same
view silently replaces the first. The prompt aids work around it by being called
from journals.js's existing hook. Make the hooks a list before more modules need them.

### 8.3 git is unusable: "dubious ownership" on `H:/` (gap, **fixed** 2026-10-21: repo created in `H:/ethos`, pushed to a private GitHub repo; see CONTEXT §9)
`H:/` is owned by SYSTEM, so every git command fails (and the remember plugin
refuses to write its handoff). Fix with
`git config --global --add safe.directory H:/ethos` (or the drive root), or take
ownership of the folder. Until then the `.bak` files in the repo root are the only history.

### 8.4 Per-note paper choice is never cleaned up (cosmetic)
Paper lives in localStorage keyed by note id, so deleting a note leaves its
entry behind (tiny, harmless), and it will not follow a user across machines.

### 8.5 Background image lives in localStorage (gap)
Downscaled to 2560px JPEG (q 0.9) to fit the ~5MB quota; presets are 3840px. Moving uploads into the vault would lift the cap. A very large photo can still
fail; the user gets a message. Moving it to the vault would need a binary
asset path in `vault.js`. Fine for now.

### 8.6 Every subscribed list re-renders in full on every snapshot (cosmetic)
Homepage habits, habit page, to-do card and journals all rebuild on any
mutation anywhere. Cheap at this size; worth a diff-render later.

### 8.7 ~~Not verified in the running app~~ (fixed)
`npm run test:ui` now covers the nudge, prompts, mood log, paper and homepage
alignment: 24/24. Still worth a look by eye: the 1lh paper rules with Plex Mono.

### 8.8 ~~The custom background image cannot be removed~~ (fixed)
Settings > Background > Image has a Remove uploaded image button, shown only
when one is stored. Covered by test:ui.

### 8.9 `ELECTRON_RUN_AS_NODE` is set in VS Code terminals (environment trap)
`npm start` / `npm run test:ui` from the VS Code terminal run Electron as plain
node and crash on `app.setPath`. Run `env -u ELECTRON_RUN_AS_NODE npm run test:ui`
(bash) or `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell) first.

### 8.10 test:ui failed one check once in four runs (flaky)
Which check was not captured. All waits are fixed sleeps (mood save 500ms,
nudge 11.5s, view switches 300-600ms); replace them with polling for the
expected state before trusting a single red run.

---

## 9. Found during the to-do revamp (2026-10-21)

### 9.1 A pinned task in the past still claims its old slot (logic)
"Seminar at 2pm" added at 4pm is planned 2:00-2:45 and shown overdue at once,
and the summary can say "finished by 2:45 PM" while it is 4pm. Decide: shift a
pinned-but-past task to now, or ask the user.

### 9.2 No reminder at a pinned task's start (gap)
Reminders fire at `dueAt` (the planned finish). A task pinned to 2pm would
benefit from a "starting now" banner too; needs a second `notified` flag.

### 9.3 To-dos are not in the schedule's "Up next" rail (gap)
They show on the grid and the all-day row only.

### 9.4 Week view crowds when to-dos and events overlap (cosmetic)
To-dos share event columns, so a busy hour splits into thin slices.

### 9.5 The preview's "Done about" ignores pinned blocks (cosmetic)
It is an approximation; the saved task shows the real time from main.

---

## 10. Whole-app pass, 2026-10-21 (storage and status)

This pass re-checked the risky patterns across the whole renderer and main
process, and recorded everything found during this session. It did not re-read
every file line by line; section 1-7 findings from the earlier audit still
stand and were not re-verified here.

### 10.1 Renderer `innerHTML` is used only to clear (verified, no action)
Every `innerHTML` write in `src/renderer/js` is `= ''`. User text is always
set with `textContent` or `createElement`. Keep it that way: a new `innerHTML`
with a variable is a CSP and XSS risk (CONTEXT.md invariant 4).

### 10.2 The custom background image can fill localStorage (gap)
A 2560px JPEG at quality 0.9 is about 1-3 MB, stored as base64 (+33%). The
browser's localStorage quota is about 5 MB per origin, so a large photo can
crowd out other per-machine prefs. `decode()` catches the write failure and
says so, but the image should move to a vault file.

### 10.3 Preset backgrounds are the largest app-owned asset (cosmetic, storage)
16 MB total for eight 3840px JPEGs. Re-encoding as WebP at the same size would
save about 8-10 MB. See Efficiencies.md, Storage step 2.

### 10.4 `references/` and `backups/` ship with the app folder (storage)
About 2.3 MB that nothing at runtime reads. Exclude them from packaging. See
Efficiencies.md, Storage step 3.

### 10.5 `journalling.txt` is 0 bytes (gap; closed 2026-10-23)
Same as 8.1. The Gratitude prompts are hard-coded in `prompts-data.js`.

### 10.6 Pinned tasks in the past (logic)
Same as 9.1: a pinned task added after its start time keeps the old slot and
shows as overdue straight away.

### 10.7 Fixed sleeps in the UI test make it flaky (test)
Same as 8.10. One of 4 runs failed one check, which was not captured.
`scripts/ui-test.js` uses fixed `wait()` calls; replace them with polling for
the expected DOM state, and print the failing check name.

### 10.8 The UI test needs `ELECTRON_RUN_AS_NODE` unset (environment)
Same as 8.9. VS Code terminals set it, and Electron then runs as plain node.
`npm run test:ui` should unset it itself (`cross-env` or a small wrapper).

### 10.9 Every subscribed list rebuilds in full on any mutation (efficiency)
Same as 8.6. Homepage habits, the habit page, the to-do page and the journal
list all rebuild on every snapshot. Fine at this size.

### 10.10 Electron is a dev dependency but is the whole runtime (packaging; not a bug: electron-builder expects it in devDependencies)
`package.json` has `electron` under `devDependencies`, and no packager is
configured. A packaged build needs electron-builder or electron-forge, plus
the icon handed over (CONTEXT.md, "The app icon").

### 10.11 Git is unusable in this folder (environment, **fixed**, same as 8.3)
Same as 8.3. `safe.directory` is not set, so git and the remember plugin both
refuse. Fix before the next commit.

### 10.12 Things that are not bugs but will bite later
- `Efficiencies.md` was written before this pass and has no storage section
  until now. Read the Storage section before any packaging work.
- Schema is at version 7 (checked 2026-10-23). Any new on-disk field needs a migration step
  (CONTEXT.md invariant 9).
- The schedule and to-do plans are computed in main; any new plan rule goes in
  `store.js #rechain` and is tested in `scripts/check.js`, not in the renderer.

---

## 11. Found while building note links and the graph view (2026-10-21)

### 11.1 Notes pages could lose the last typing on window close — `notes.js` (data loss, **fixed**)
`notes.js` still saved on `beforeunload`, the same fire-and-forget pattern as
§1.3, and the close handshake only committed the journal editor. Reproduced:
text typed into a Notes page 50ms before closing was missing from disk (2 of 2
runs). Now the handshake commits both editors (`commitNotes`), and the same
check passes (2 of 2).

### 11.2 Link chips replayed their pop-in on every autosave — `notes.js` (cosmetic, **fixed**)
Every snapshot redraws the chips, including the autosave while typing, so they
pulsed as you wrote. Only a chip new to the open note animates now; a UI test
covers it.

### 11.3 "Fit to view" put notes under the floating panel — `graph.js` (cosmetic, **fixed**)
Fit used the whole canvas; it now fits into the space beside the panel (below
it on narrow windows).

### 11.4 Links are made only with the picker; no inline `[[wikilinks]]` (gap)
Obsidian links from inside the text. Ethos stores links by id (CONTEXT §13), so
typing `[[` could open the picker and add a link, but the text itself would not
be a live link until the editor renders rich text. Decide before building.

### 11.5 Journal notes are not in the graph (gap, decision)
The graph covers Notes pages and folders only. Journals are a separate model
(`n_` ids, no `links`). Including them needs a decision on whether journals can
link to pages and back.

### 11.6 Changing links bumps `updatedAt`, which reorders "Recent" (cosmetic)
Linking or unlinking updates the page's "Edited" time, and deleting a page bumps
every page that linked to it. Correct for sync, but "Recent" on the Notes home
reshuffles after a deletion the user did not make in those pages.

### 11.7 Graph layout is not kept between sessions (gap)
Positions are random on first open each launch; dragged nodes are not pinned.
Obsidian also re-lays out, but a "pin where I put it" would need positions in
localStorage or the vault.

### 11.8 Graph repulsion is O(n²) per tick (efficiency)
Fine for a few hundred notes (each tick is ~n²/2 pairs with a 600px cutoff).
Past roughly a thousand, use a Barnes–Hut quadtree.

### 11.9 Labels overlap in dense clusters (cosmetic)
No label collision. Zooming in separates them; hovering lights one cluster.

### 11.10 The keyboard path through the graph has no visible focus ring (a11y, cosmetic; fixed 2026-10-23: a dotted focus outline is global)
Tab moves through a visually hidden list; the focused note lights up and is
centred, but the button itself is invisible. Fine for screen readers; a sighted
keyboard user has only the highlight to go on.

### 11.11 `capturePage` can return a stale frame (environment trap)
A screenshot taken right after a DOM change showed the old state ("None yet")
although the next step clicked the new chip. Wait a frame or two (or poll)
before `capturePage` when the shot is evidence.

---

## What checked out clean

- No XSS sinks: `innerHTML` is only ever used to *clear* containers; all user
  text goes through `textContent`.
- No path traversal in the protocol handler (decode → resolve → containment is
  correct, including encoded `%2e%2e`).
- No id/path confusion: `vault.noteFile()` re-validates the id pattern before
  building a path.
- No unvalidated IPC arguments; every payload crosses `schema.js`.
- Every element id the JS queries exists in `index.html`.
- Clock running-total math, intro timeline, notification queue/pause logic,
  streak math, atomic-write path (temp → fsync → rename), and the migration
  runner all check out on inspection.

---

## 12. Found during the retro redesign (2026-10-23)

Logged while building the redesign (PLAN-retro-demo.md). The first three were
fixed in the same pass.

### 12.1 The status row ran under the theme toggle (cosmetic, fixed)
The fixed toggle at bottom left covered the last line of each view's status row. Fixed with bottom clearance on `.view-status`.

### 12.2 Title text was almost invisible in dark mode (cosmetic, fixed)
The title bar used `--accent-fg`, which is near-black in dark. It now uses `--title-fg`.

### 12.3 Stray `-webkit-` fragments from the shadow sweep (logic, fixed)
Removing `backdrop-filter` left a `-webkit-` with no value in `graph.css` and `notifications.css`. Both are fixed.

### 12.4 The clock still has the old look (gap, open)
PLAN 6.2 (round face, square hour marks, accent hands) is not done. `clock.js` draws the ticks.

### 12.5 Journal, notes and to-do pages are not yet in their final layout (gap, open)
Not done from PLAN phase 6: the journal menu bar (6.6), the notes folder grid (6.7), the two-window to-do page (6.4), the settings tabs (6.9), the schedule's mini-month and editor restyle (6.3, beyond the chrome). Each view is in the new look, but not the planned layout.

### 12.6 Journal name is not in the title bar (gap, open)
The journal's window title reads `JOURNAL.EXE` whatever the note is called (PLAN 5.1 asks for the note's name).

### 12.7 The sidebar highlight does not slide (gap, open)
PLAN 5.3 and 7.4: a single sliding highlight between rows. Rows jump.

### 12.8 A packaged run and a dev run share one vault (risk, open)
Both use `%APPDATA%\Ethos`. Testing the installer therefore touches the real vault. Consider a separate `app.setName` or a profile for packaged test runs before the demo goes out.

### 12.9 Installer size is above the estimate (docs, open)
Measured 114 MB installer and 337 MB unpacked, against the 80-95 MB estimate in Efficiencies.md. Most of it is the Electron runtime. The backgrounds (16 MB in asar) and WebP (Efficiencies Storage step 2) are the next step.

### 12.10 `npm audit` reports issues after the electron-builder install (security, open)
Not reviewed in this pass. Run `npm audit` and decide what to act on before the demo ships.
