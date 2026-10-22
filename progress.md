# Progress

Short log, newest first. Details live in CONTEXT.md (what and why) and bugs.md
(what is broken). Read those two before opening source files.

## 2026-10-23 (later): light mode readability, pixel MS Sans Serif headings
User feedback before launch. Light mode: secondary text is black (was #404040),
the accent is a deep teal and the title bars a pale green with black text (the
navy clashed with the teal desktop), and every view is an opaque grey window on
the desktop, so no text sits on the teal. Headings use Ethos Pixel Sans, a pixel
recreation of MS Sans Serif (FontStruct, by lou, CC BY-SA 3.0, via 98.css), at
33 / 22 / 11px. Dark mode keeps its colours and takes the new heading face.
Checks 84/84, UI 68/68.

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

Tokens and fonts (phase 3): light is 98 grey, dark is the ethos website palette.
Radii are 0 (except the clock), blurred shadows and backdrop blur are gone, and
status colours are tokens. Pixelify Sans is the headings face (Silkscreen and
VT323 dropped). Screenshots of every view in both themes checked by eye.

Component kit (phase 4) and window chrome, toasts, menus, motion and typing
sounds (phases 5-7). chrome.js gives each view a title bar and a status row;
the sidebar is a Start menu; the backdrop has pattern presets and optional
scanlines in dark. Toasts are small windows. The right-click menu is a menu and
stays on screen (bugs 2.4 fixed). Graph pages are squares. Spring moved to
js/spring.js. js/sound.js: typing clicks (Web Audio, off by default, a one-time
offer), with a Settings section. Checks 84/84, UI 62/62.
Not done in this pass (plan items left open): journal menu bar (6.6), notes
folder grid (6.7), clock restyle (6.2), two-window to-do page (6.4), settings
tabs (6.9), vertical banner and sliding highlight (5.3, 7.4), the window-title
journal name (5.1).

Demo edition (phase 8): src/main/edition.js (default demo; ETHOS_EDITION
overrides in an unpackaged run only). state:load carries edition, version and
packaged. Full-only systems (Mood log, its card, Blockers) carry data-full-only:
hidden in the demo and refused by views.show(). The window title is Ethos (demo).
UI 68/68 (the test runs as full and checks the demo gate on the page).

Installer (phase 9): `npm run dist` builds the NSIS installer (114 MB; 337 MB
unpacked, measured). The packaged app runs and shows the demo. Docs (phase 10):
CONTEXT section 17 (the retro redesign and the demo), bugs section 12 (what was
found, what is open), Efficiencies measured, todo, and PLAN-retro-demo section 6
(execution record). Open: the Windows banner, the intro and tray on a desktop,
the packaged vault (bugs 12.8), npm audit (bugs 12.10).

Component kit (phase 4): styles/retro.css (buttons and fields default to bevels;
window, menu, group, tabs, progress, dither, dialog), js/icons.js (54 pixel
icons, copied into the module from icons/*.svg, MIT), js/dialog.js
(confirmDialog). Note and journal deletes now ask first (Cancel keeps the
note). Sidebar icons are pixel icons. UI 57/57 (two new checks), checks 84/84.

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
