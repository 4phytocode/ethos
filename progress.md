# Progress

Short log, newest first. Details live in CONTEXT.md (what and why) and bugs.md
(what is broken). Read those two before opening source files.

## 2026-10-23: housekeeping (retro plan, phase 1)
Branch `retro-demo`. The redesign and demo plan is in PLAN-retro-demo.md, with
the user's answers in its section 0a. Prompts: the 50 gratitude prompts from
references/journalling.txt are in. The journal nudge is 30s; the UI test
shortens it through `ethos.test.nudgeMs`. The Plex licence is in
fonts/. The two `.pre-restructure.bak` files are deleted. The docs were
corrected against the code (bugs.md top note and §§3.2, 4, 6.7, 6.8, 8.1,
8.9/8.10 order, 10.5, 10.10, 10.12). `npm run check` 84/84, `npm run test:ui` 55/55.

Logo (phase 2): the new logo is the mark everywhere. `scripts/build-icons.py`
builds the .ico, the 512 PNG, the tray PNGs (with @2x) and the page copies in
src/renderer/img. The tray loads a file now (the drawn icon is gone). The intro
is a boot sequence, then the logo moves into the brand mark (2.4s, skippable).
Checks 84/84, UI 55/55.

## 2026-10-21 (late night): note links and the graph view
Notes pages link to each other (`page.links`, schema v7, by id; backlinks
derived). In the note: Links chips, "+ Link note" picker, "Linked from". Graph
view (`graph.js`), Obsidian-style: its own view, toggled with the sidebar icon,
Notes home button or Ctrl+G; dots, folder rings, link and folder lines, spring
layout, drag / pan / zoom / hover / find / filters, keyboard list.
Also fixed: Notes pages losing typing on close (bugs.md 11.1).
`npm run check` 84/84, `npm run test:ui` 55/55. Open: bugs.md 11.4-11.10.

## 2026-10-21 (night): bug pass (bugs.md 1, 2.2, 2.8, 6.1-6.4, 6.2, 1.3)
Data loss first. `store.flush()` now queues a pass behind the one in flight
(edits made mid-write are no longer dropped, and quit waits for the whole queue).
Closing the window asks the page to save and waits for its answer (1.5s grace)
instead of a fire-and-forget save on beforeunload. A write still failing at quit
asks the user before anything is discarded. A vault that will not open shows an
error and stops. The single-instance lock is taken before startup. Habits stop
at the 4000-day cap instead of being dropped on restart. The app redraws at
midnight. Font toast only when the font changed.
`npm run check` 78/78, `npm run test:ui` 39/39, close-path check passes.
Open: bugs.md 2.1, 2.5, 2.6, 6.6, 7.x, 9.1 (needs a decision).

## 2026-10-21 (evening): to-do revamp, the day plan
Typed times ("45m at 2pm"), live finish preview, To do / To remember lists with
drag and drop, inline rename and time edit, pinned tasks the plan flows around,
to-dos drawn on the schedule, "Show schedule" toast. Schema v6.
`npm run check` 75/75, `npm run test:ui` 39/39. Open items: bugs.md section 9.

## 2026-10-21 (later): patches
Unsplash preset backgrounds (bundled, 8), customisable gradient (palettes,
custom colours, speed), Mood log icon is now a book, homepage on a two-column
grid so segments align, new `npm run test:ui` (24/24, nudge included).

## 2026-10-21: homepage and journal pass
Done: moving gradient / image backdrop + Settings > Background; mood check-in
card + Mood log view (schema v5, moods.json); habits segment on the homepage
(fixed habit bar removed); "+ New Journal" moved above the list; journal prompts
(Gratitude / Surprise me), empty-page nudge, plain/lines/grid paper.
Checks: `npm run check` 71/71. Not yet opened in the running app (bugs.md 8.7).
Next: check by eye, raise NUDGE_MS to 30s, fill references/journalling.txt,
fix git ownership (bugs.md 8.3).
