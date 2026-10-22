# Ethos — retro redesign and demo release: execution plan

> Executed on branch `retro-demo` through phase 10 on 2026-10-23. What was done, and what was
> left, is in section 6.

Written 2026-10-23 from `references/userref.md` (22/10/26), the ten images in
`references/ui design/`, `CONTEXT.md`, `bugs.md`, `Efficiencies.md`, `todo.md`
and a check of the code itself. **The executor is Claude Haiku 5.5.** Work the
phases in order. Each phase ends with a verification gate and a commit.

---

## 0a. Amendments from the user's answers (2026-10-23)

These override anything below that says otherwise.

- **Website palette.** The ethos website is in `H:\ethos web\` (`site/assets/ethos.css`).
  The dark theme uses **the website's tokens**, not the phosphor-green set:
  tube `#05070b`, phosphor `#d4e6ff`, panel `#0e1116`, raise `#161a21`,
  rule `#20262f`, dim `#8fa6c6`, faint `#56657b`, title bar gradient
  `#262d38 -> #0d1015`. The site's `.win`, `.win-title` and `.btn` are the model
  for windows and buttons in dark mode. The light theme stays "98" grey.
- **Pixel font.** One general-purpose pixel face that reads in upper and lower
  case: **Pixelify Sans**, for headings, labels, window titles and buttons, in
  both themes. **Drop Silkscreen** (it renders lower case as capitals) and
  **drop VT323**. Body text stays IBM Plex Mono. The website's `Unbounded` face
  is not used in the app, because the app brief asks for pixels.
- **Demo scope.** "What not to include" stays empty. All six demo systems are in,
  and the next session adds more. Only the Mood log and the Blockers placeholder
  are hidden, because neither is in the demo list.
- **Graph.** "Graphical notes" means the existing graph view. No hand-drawn notes.
- **Code signing.** Not needed now. The app runs under Electron and will get a
  proper executable later.
- **Website.** Out of scope. `H:\ethos web\` is a reference only; nothing there is edited.

## 0. Rules for the executor (read before touching anything)

1. **Read first, in this order:** this file; `CONTEXT.md` sections 1, 2, 6, 13
   and 3 ("Chrome that reveals on hover", "Logo, scrollbar", "Appearance and
   fonts", "The app icon"); `references/userref.md`. Open the reference images
   named in a task when you reach that task. You can view `.jpg` files with the
   Read tool.
2. **Test commands.** Run both before you start a phase and after you finish it:
   ```
   npm run check                                  # expect 84 passed, 0 failed
   env -u ELECTRON_RUN_AS_NODE npm run test:ui    # bash; expect 55 passed
   ```
   In PowerShell use `Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run test:ui`.
   VS Code terminals set `ELECTRON_RUN_AS_NODE=1`; without unsetting it Electron
   runs as plain node and crashes on `app.setPath`. `test:ui` prints a temp
   folder holding screenshots. **Open those screenshots and look at them** after
   every visual phase; compare them with the reference images named in the phase.
   `test:ui` failed once in four runs in the past (bugs.md 8.10). Re-run a single
   red check once before you believe it.
3. **Invariants you must not break** (`CONTEXT.md` §6). The ones this work is
   most likely to hit:
   - No inline `<script>` or `<style>`, and no `<style>` elements built at runtime.
     The CSP blocks them. Setting `el.style.foo` from JS is fine.
   - Never `innerHTML` anything that is not the empty string. Build elements and
     use `textContent`. To insert an SVG icon, use `createElementNS` or clone a
     `<template>`.
   - The CSP allows only local fonts, images and scripts (`src/main/protocol.js`).
     Do not load anything from the network at runtime. Download assets once
     during development and commit them.
   - **Do not add `::-webkit-scrollbar` rules.** They broke scrolling in this
     Electron build (`CONTEXT.md` "Logo, scrollbar"). Style scrollbars only with
     `scrollbar-color` and `scrollbar-width`.
   - Hover-reveal UI uses `:hover` and `:has(:focus-visible)`, never
     `:focus-within`. Hide with `opacity` and `pointer-events`, never
     `display:none`. Never animate `display`.
   - Every animation needs a `prefers-reduced-motion: reduce` escape.
   - `clock.js` keeps hand angles as a running total (`forward()`). Restyle the
     clock, but do not touch that maths.
   - The schedule and to-do logic live in `src/main` and are tested. This plan is
     almost all renderer work. If a step seems to need a change under `src/main`
     that this plan does not name, stop and ask.
4. **No Microsoft or Windows artwork, names or logos.** Ethos ships commercially.
   Use the *look* of Windows 98/XP (bevels, grey faces, navy title bars), never
   their icons, wallpapers (no "Bliss" photo, no Windows clouds), sounds, the
   word "Windows" or the Windows flag. All icons come from `pixelarticons`
   (MIT, task 2.4) or are drawn by us.
5. **One phase = one commit** on `main` (the user's repo works on `main`).
   Message format: `Retro: <phase name>`, a short body, then the line
   `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Do not push
   unless the user asks.
6. **Log as you go.** Add a dated entry to the top of `progress.md` after each
   phase. Write new bugs into `bugs.md` §12 (create it, "Found during the retro
   redesign (2026-10)"). Do not fix unrelated bugs inline unless they block you.
7. **Stop and ask the user** when: a test fails and you cannot see why after one
   honest attempt; a step needs a decision listed in §2 "Open questions"; or a
   step would delete user data or code that this plan does not name.

---

## 1. What the user asked for (userref.md, condensed)

| # | Request | Where it is handled |
|---|---|---|
| A | Use `imgs/new logo [1].png` as the logo for the whole software: app, executable, everything | Phase 2 |
| B | Change the look from modern minimalist to retro, vintage, boxy: Windows 98 / XP, early-2000s, Matrix, 90s; pixelated feel; IBM Plex and vintage fonts; retro icons and symbols | Phases 3-6 |
| C | Keep it modern and fast underneath | Every phase (no heavy effects, no blur, no new libraries at runtime) |
| D | Make it feel alive: fluid button mechanics, fluid typing | Phase 7 |
| E | Typing sounds in the journal and notes, with an on/off toggle | Phase 7 |
| F | Release the demo: Journal, To-do, Habit tracker, Graphical notes (the graph view), Notes and folders, Schedule | Phases 8-9 |

### What each reference image is for

| Image | Take from it |
|---|---|
| `[1].jpg` Start menu | The sidebar: icon + label rows, etched separators, navy highlight on hover |
| `[2].jpg` media player | Square bevelled icon buttons, sunken display area, a slider with a square thumb |
| `[3].jpg` Date/Time Properties | Group boxes with a label in the border, the mini calendar (navy selected day), the analog clock (dotted ticks, square hour marks), a time field with a spinner, OK/Cancel buttons |
| `[4].jpg` XP landing page | The XP side only: soft blue sky, a glossy green call-to-action, a large friendly heading. Use as the *mood* of the light theme's homepage, not as an asset |
| `[5]jpg.jpg` file explorer | The Notes folder view: a grid of folder icons with labels under them, a toolbar, an address bar, a status bar ("45 object(s)") |
| `[6].jpg` BIOS screen | The dark theme: black, phosphor green-teal text, thin boxed panels, all-caps nav, ASCII flavour |
| `[7].jpg` Retro-OS UI kit | **The design system.** Colour tokens, type scale, 1px borders, window header, buttons (normal/hover/disabled), progress bar, input, tabs, checkboxes, toast, modal. Its rules card: one accent colour, no heavy shadows, 1px borders |
| `[8].jpg` portfolio | A top strip with Start + tabs + date/time box; small windows with navy title bars overlapping a page; a big mixed pixel/serif heading |
| `[9].jpg` Notepad portfolio | The journal and notes editor: a window titled like `NOTEPAD.EXE-about_me.txt`, a menu bar (FILE OPTIONS WINDOW HELP), a status bar with a path, lots of white space, monospace body text |
| `[10].jpg` DVD logo | Scanline texture on a logo or heading. Use as a CSS effect in the dark theme only |

---

## 2. Decisions this plan has made, and questions for the user

### Defaults chosen here (the user may overrule any of them)

| Decision | Default in this plan | Why |
|---|---|---|
| Two themes | **Light = "98"** (grey faces, white fields, navy accent, bevels). **Dark = the ethos website** (tube black, phosphor blue-white; §0a) | Keeps the existing light/dark toggle and gives each mode a real identity |
| Fonts | Body stays **IBM Plex Mono**. Headings, labels, window titles and buttons: **Pixelify Sans** (OFL, upper and lower case), shipped in `src/renderer/fonts/` | The CSP allows only local fonts. One pixel face (§0a) |
| Corners | **0 radius everywhere**, except the round clock face | Image 7: boxy |
| Shadows | **No outer drop shadows, no backdrop blur.** Depth comes only from inset bevels | Image 7 rules card; also faster |
| Icons | **pixelarticons** (MIT), 24px grid, drawn at 24px or 48px only | Pixel-native, licence-safe, already `fill="currentColor"` |
| Window chrome | Every view becomes a "window": navy title bar with icon and name, a **[□] button that hides or shows the sidebar** (the existing Ctrl+\) and an **[×] button that goes Home**. No decorative buttons that do nothing | Fake buttons would lie. This also settles todo.md "per-view back arrows are redundant": the × replaces them |
| Backdrop | New CSS-only presets: **Teal desktop** (default), Dither, Grid, Scanlines. Existing photos and gradients stay selectable | The old default gradient clashes with the look; CSS patterns cost no bytes |
| Typing sounds | **Synthesised with the Web Audio API** (no audio files, no CSP change). **Off by default**; the first time an editor gets focus, a one-time toast offers "Turn on" | A sound out of nowhere in a work app is a bad surprise; the userref marks it "(?)" |
| Demo scope | Shown: Home, Schedule, To-do, Habits, Journal, Notes + folders, Graph, Settings. **Hidden in the demo: Mood log, the homepage mood card, the Blockers placeholder** | userref lists six systems. The "what not to include" section is empty, so only items outside the six are hidden, and nothing is deleted |
| Demo version | `0.1.0-demo`, product name `Ethos`, appId `com.ethos.app` (matches `setAppUserModelId` in `src/main/index.js`) | A demo needs a version, and NSIS needs semver |

### Open questions (ask the user; do not guess)

1. **"Just like the ethos website presents."** The website is not in the repo
   and has no URL in any doc. A URL or screenshot would let the palette match it.
   Until then the palette is image 7's. *Needed before Phase 3 is signed off,
   not before it starts.*
2. **The "What not to include" list in userref.md is empty.** This plan hides
   only Mood log and Blockers. Should quotes, the backdrop settings, or the
   journal prompts also wait for the full version?
3. **"Graphical notes system"** is read here as the existing graph view
   (`graph.js`). If it means hand-drawn or canvas notes, that is a new feature and
   not in this plan.
4. **A pixel font was built once and removed** (bugs.md §5: `build-pixel-font.js`
   and a pixel face were deleted, reason not recorded). This plan uses pixel faces
   only for headings and labels. Confirm that is acceptable.
5. **Code signing.** An unsigned installer shows a SmartScreen warning. Buy a
   certificate before the public demo, or ship unsigned with a note?
6. Still open from earlier docs: bugs.md 9.1 (pinned to-do in the past), 10.2
   (background image into the vault), Electron vs Tauri. Not needed for this plan.

---

## 3. Discrepancies found in the docs (verified against the code, 2026-10-23)

Phase 1 fixes every one marked **fix**. "Stale" means the doc describes a state
that no longer exists.

| # | Where | What the doc says | What is true | Action |
|---|---|---|---|---|
| D1 | CONTEXT §3 layout | "the 23 IPC handlers" | `ipc.js` registers **25** channels (§7 says 25 correctly) | fix |
| D2 | CONTEXT §3 layout | File list | Missing `js/quotes.js`, `js/todo-parse.js`, `styles/fonts.css`, `styles/quote.css`, `renderer/fonts/`, `renderer/backgrounds/` | fix |
| D3 | CONTEXT §3 "Chrome that belongs to only some views", "The sidebar" | Describe a live `.habit-bar` | The habit bar is gone from all code (grep finds nothing); "Homepage layout" says it was removed 2026-10-21 | fix: rewrite as a general rule, drop habit-bar specifics |
| D4 | CONTEXT §3 "Homepage layout" | To-do card "shows only the empty-state line... Real to-do items are not built yet" | §15: the card lists tasks and remember items | fix |
| D5 | CONTEXT §12 Known gaps | "A to-do's title cannot be edited in the UI"; "`test.txt` is an empty leftover"; "encryption... before the habit tracker" | Inline rename exists (§15); `test.txt` does not exist; the habit tracker exists | fix |
| D6 | CONTEXT §13 | Three rows dated **2025**-10-18/19 | Every other date is 2026 | fix the year |
| D7 | CONTEXT §13 | "Schedule UI removed, model kept" | Superseded by the "Schedule rebuilt" row | fix: mark superseded |
| D8 | CONTEXT section order | 14, 15, 17, 16 | | fix: renumber so 16 "Start here" is last, or move it |
| D9 | CONTEXT §14, progress.md | `NUDGE_MS` is "10s for testing; intended ~30s" | Still `10 * 1000` in `prompts.js` | fix: set 30s, check `ui-test.js` waits (it waits 11.5s for the nudge; it will need the test to shorten the timer, see task 1.3) |
| D10 | bugs.md §2.6, §2.8, §5 | Font registry is `system` only; `renderer/fonts/` deleted | `FONTS` = Plex Mono (default) + System UI; five Plex TTFs ship | fix: add a "superseded" note at the top of §5 and in §2.6 |
| D11 | bugs.md §3.2, §4, §6.7 | Events UI dormant; `schedule.js` does not exist; IPC count 7/10/17 | Schedule is built; `schedule.js` is 1097 lines; 25 channels | fix: mark these items **stale/resolved** |
| D12 | bugs.md §6.8 | OFL licence text missing from `renderer/fonts/` | Still missing. **Blocks packaging** | fix in task 1.4 |
| D13 | bugs.md §8.1, §10.5; `prompts-data.js` comment | `references/journalling.txt` is 0 bytes | It now holds **50 gratitude prompts** in five groups | fix in task 1.2 |
| D14 | bugs.md §10.12 | "Schema is at version 6" | `SCHEMA_VERSION` is 7 | fix |
| D15 | bugs.md §10.10 | Electron in `devDependencies` is a packaging problem | That is where electron-builder **requires** it. Not a bug | fix: mark not-a-bug |
| D16 | bugs.md §8 numbering | 8.10 appears before 8.9 | | fix order |
| D17 | Efficiencies item 8 vs Storage "not worth doing" | Item 8: subset fonts (medium). Storage: "shrinking the fonts: not worth it" | They contradict. With three more fonts arriving, woff2 conversion is worth doing at packaging time (task 9.2) | fix: one line in Storage pointing to task 9.2 |
| D18 | Efficiencies item 9 | "11 stylesheets", "app.js → 12 modules" | 18 stylesheets in `index.html` | fix the numbers |
| D19 | Efficiencies Storage table | `references/` = 1.4 MB | ~5 MB (`[4].png` alone is 4.4 MB). Still excluded from the build | fix |
| D20 | todo.md (last updated 2026-10-19) | "bottom habit bar is still a placeholder"; "Edit a to-do's title from the UI"; "drag to reorder instead of up/down buttons" | Habit bar removed; title edit exists; to-dos already drag and drop | fix: tick or remove; add a "Retro redesign and demo" section pointing here |
| D21 | CONTEXT §3 "The app icon", §13 row | The "e." logo is the app icon; tray and in-app marks left alone | userref: `new logo [1]` for **everything** | Phase 2 rewrites both |
| D22 | CONTEXT §13 | Plex Mono default because "calm and professional" | userref moves the feel to retro. Plex stays as body text; the reason changes | Phase 3 updates the row |
| D23 | CONTEXT §3 "Appearance and fonts" | "Do not pin a family anywhere" | Phase 3 adds display and label font roles | Phase 3 rewrites the rule: families are set only through `--font-*` tokens |
| D24 | CONTEXT §8 | Toasts are "translucent with a backdrop blur" | Will be opaque retro windows after Phase 6 | Phase 6 updates |

---

## 4. The phases

Order and why: Phase 1 is cheap clean-up so the docs stop lying to you.
Phase 2 is the user's first bullet and is isolated. **Phase 3 (tokens and
fonts) is the biggest win for the effort:** almost every colour, border and
font in the app already comes from six custom properties, so changing them
restyles the whole app at once. Phases 4-6 then build the components and go
segment by segment. Phase 7 adds the motion and sound. Phases 8-9 make the demo
and the installer. Phase 10 closes the docs.

---

### Phase 1 — Housekeeping and doc truth (small)

**1.1** Fix discrepancies D1-D11, D14-D20 in the docs exactly as the table says.
Keep each doc's voice: short sentences, no marketing words.

**1.2** Gratitude prompts (D13). Replace the `GRATITUDE` array in
`src/renderer/js/prompts-data.js` with the 50 prompts from
`references/journalling.txt`. Strip the numbers ("1. "), drop the five group
headings and blank lines, keep the wording exactly. Replace the comment that says
the file was empty. Leave `SURPRISE` alone.

**1.3** `NUDGE_MS` (D9). Set it to `30 * 1000` in `src/renderer/js/prompts.js`.
Make it overridable for tests without touching the product path: read
`localStorage.getItem('ethos.test.nudgeMs')` inside a `try/catch` and use it if
it is a positive integer. In `scripts/ui-test.js` set that key to `10000` before
the journal section. Run `test:ui`.

**1.4** Licences (D12). Download into `src/renderer/fonts/`:
- `https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt` → `LICENSE-IBMPlexMono.txt`

Update `fonts/README.md` to name the file. (The other font licences arrive in
task 3.2.)

**1.5** Delete `main.js.pre-restructure.bak` and
`notifications.js.pre-restructure.bak` from the project root. CONTEXT says they
are safe to delete now that git holds them (they are in commit `6336f28`).
Update CONTEXT §3 where it mentions them. Leave `backups/` alone.

**Gate:** `npm run check` 84/84, `test:ui` 55/55. Commit `Retro: housekeeping`.

---

### Phase 2 — The new logo everywhere (userref A)

Source: `imgs/new logo [1].png` (800x800 RGBA: a black disc, a white "e]" and
an orbit ring). The old source `imgs/logo(1).png` stays in `imgs/` as history.

**2.1** Write `scripts/build-icons.py` (Pillow 12.3 is installed). It must be
re-runnable and is the answer to CONTEXT's "there is no build script yet". It
writes:
- `assets/icon.ico` with sizes 16, 24, 32, 48, 64, 128, 256 (LANCZOS)
- `assets/icon.png` 512x512
- `assets/tray-16.png`, `assets/tray-32.png` (and `tray-16@2x.png` = the 32
  image, so Electron picks it on high-DPI)
- `src/renderer/img/logo-64.png`, `logo-128.png`, `logo-512.png` (for the
  page: brand, intro, About dialog; the page can only load files under
  `src/renderer`)

Run it with `python -I scripts/build-icons.py`. Look at the 16px and 32px output
with the Read tool. The orbit ring may vanish at 16px; that is acceptable, but
if the "e]" is mush, add a 16px-specific step: crop to the central 70% of the
disc before resizing for 16 and 24 only.

**2.2** Tray (`src/main/tray.js`). Replace the code-drawn PNG with
`nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray-16.png'))`.
Delete the now-unused zlib drawing code and rewrite the file's header comment
(it explains why the icon was drawn in code; that reason is gone). Keep the
menu and every exported function the same. If `tray.iconImage` is still exported
with no callers (Efficiencies 17), remove it.

**2.3** In-app brand (`#brand-logo` in `index.html`, styles in `base.css`).
Replace the inline SVG "e" with `<img id="brand-logo" src="img/logo-64.png"
width="32" height="32" alt="">`. Keep `.brand`'s halo filter (CONTEXT "Logo,
scrollbar"). Remove the CSS that targets `#brand-logo circle` / `text`, and the
`dot-blink` animation if it only applied to the old SVG.

**2.4** Intro (`intro.js`, `intro.css`, `#intro` in `index.html`). The old intro
measures a Helvetica "e" and draws a ring. Replace it with a short boot sequence
that suits the new look:
1. Black screen. Three to five lines of boot text type in, Plex Mono,
   phosphor green, e.g. `ETHOS BIOS v0.1  (C) 2026`, `CHECKING VAULT ........ OK`,
   `LOADING JOURNAL ...... OK`. Plain text, set with `textContent`, ~40ms per line.
2. The logo (`img/logo-512.png` at 160px) appears with a two-frame flicker.
3. The logo moves and shrinks into `#brand-logo`, exactly like the current
   `from`/`to` rect maths, which you should keep.
- Total ≤ 2.4s (the old one was 2.9s; Efficiencies 9 flags it as the biggest
  launch cost). Any click or key skips straight to `finish()`.
- Reduced motion: `finish()` at once, as now.
- Keep the white-on-black `#intro` backdrop in both themes (bugs.md §5 confirms
  that is intended).

**2.5** Docs: rewrite CONTEXT §3 "The app icon" (new source, the script, tray now
a file, brand and intro now the PNG) and replace the §13 row "The Ethos "e." logo
is the app icon" with the new decision, dated 2026-10-22, user's call.

**Gate:** both test suites pass (the intro must not delay `test:ui`'s first
checks; if a check fails on timing, raise its wait, do not lengthen the intro).
Run `npm start` (env var unset) and look at the window icon, taskbar icon, tray
icon, brand and intro. Commit `Retro: new logo everywhere`.

---

### Phase 3 — Design tokens and fonts (the foundation; biggest payoff)

All colours in the app already go through `--bg --fg --muted --line --card
--hover` in `base.css` (`:root` for light, `body.dark` for dark). Phase 3
redefines those and adds the rest. Do this phase in one sitting.

**3.1 Tokens.** Replace the two token blocks at the top of `base.css` with:

```css
/* Light: "98". Grey faces, white fields, one accent (navy). */
:root {
  --bg: #c0c0c0;        /* page and window face */
  --face: #c0c0c0;      /* buttons, bars, sidebar */
  --field: #ffffff;     /* inputs, editors, lists, cards */
  --fg: #000000;
  --muted: #404040;     /* AA on --face and --field */
  --line: #808080;      /* 1px borders */
  --card: #ffffff;
  --hover: #dcdcdc;
  --accent: #000080;    /* title bars, selection, the single accent */
  --accent-2: #1084d0;  /* far end of the title-bar gradient only */
  --accent-fg: #ffffff;
  --danger: #e81123;    /* destructive actions only */
  --ok: #008000;
  --desktop: #008080;   /* behind the windows */
  /* bevel colours */
  --hi: #ffffff; --hi-2: #dfdfdf; --lo: #808080; --lo-2: #000000;
  --bevel-out: inset -1px -1px var(--lo-2), inset 1px 1px var(--hi),
               inset -2px -2px var(--lo), inset 2px 2px var(--hi-2);
  --bevel-in:  inset -1px -1px var(--hi), inset 1px 1px var(--lo-2),
               inset -2px -2px var(--hi-2), inset 2px 2px var(--lo);
  --bevel-field: inset -1px -1px var(--hi), inset 1px 1px var(--lo),
                 inset -2px -2px var(--hi-2), inset 2px 2px var(--lo-2);
  --title-bg: linear-gradient(90deg, var(--accent), var(--accent-2));
  --radius: 0;
  --glow: none;
}
/* Dark: the ethos website's tokens (ethos web/site/assets/ethos.css). */
body.dark {
  --bg: #05070b; --face: #0e1116; --field: #05070b;
  --fg: #d4e6ff; --muted: #8fa6c6; --line: #20262f;
  --card: #0e1116; --hover: #161a21;
  --accent: #d4e6ff; --accent-2: #8fa6c6; --accent-fg: #05070b;
  --danger: #ff7a7a; --ok: #9fe0b8; --desktop: #05070b;
  --hi: rgba(212, 230, 255, .2); --hi-2: rgba(212, 230, 255, .06);
  --lo: #000000; --lo-2: #000000;
  --bevel-out: inset 1px 1px 0 var(--hi), inset -1px -1px 0 #000,
               inset 2px 2px 0 var(--hi-2), inset -2px -2px 0 rgba(0, 0, 0, .5);
  --bevel-in:  inset 1px 1px 0 #000, inset -1px -1px 0 var(--hi),
               inset 2px 2px 0 rgba(0, 0, 0, .5), inset -2px -2px 0 var(--hi-2);
  --bevel-field: inset 0 0 0 1px var(--line);
  --title-bg: linear-gradient(90deg, #262d38, #0d1015 85%);
  --glow: 0 0 6px rgba(212, 230, 255, .35);
}```

Then check contrast with a small throwaway node script in the scratchpad (not in
the repo): `--fg` and `--muted` against `--bg`, `--face` and `--field`, and
`--accent-fg` against `--accent`. Every pair must be ≥ 4.5:1. Adjust `--muted`
only if one fails, and note it in progress.md.

**3.2 Fonts.** Download into `src/renderer/fonts/` (all OFL 1.1):

| File | URL |
|---|---|
| `PixelifySans.ttf` | `https://raw.githubusercontent.com/google/fonts/main/ofl/pixelifysans/PixelifySans%5Bwght%5D.ttf` |
| `LICENSE-PixelifySans.txt` | `https://raw.githubusercontent.com/google/fonts/main/ofl/pixelifysans/OFL.txt` |

(Both URLs return 200 on 2026-10-23. Use `curl -L -o`.) Pixelify Sans is a
variable font, so declare `font-weight: 400 700`. Add it to `styles/fonts.css`,
and list it, with its licence, in `fonts/README.md`.

Add to `:root` in `base.css`:

```css
--font-display: 'Pixelify Sans', var(--font-ui);   /* headings, window titles, buttons */
```

The dark theme uses the same face. Do not add VT323 or Silkscreen (§0a).

Pixel fonts blur off their grid. Pixelify Sans is designed on a smooth grid, so
it reads well at 14px and up. Use sizes 14, 16, 18, 20, 24, 32, 40 and 48px. Do
not use fractional sizes below 16px for display text.

Body text (`--font-ui`, Plex Mono) is unchanged. In `settings.js` `FONTS`, add
`{ id: 'pixelify', label: 'Pixelify Sans', note: 'Pixel headings', stack:
"'Pixelify Sans', 'IBM Plex Mono', monospace", probe: null }` as a second choice
after Plex Mono. Plex Mono stays `DEFAULT_FONT`. This choice applies to body text
only, so the body setting still reads Plex by default.

**3.3 Global sweeps.** Do them file by file with Edit, not one blind sed, and
look at each hit:
- `border-radius`: every value becomes `var(--radius)` (which is 0), **except**
  the clock face in `clock.css`. Find them with
  `grep -n "border-radius" src/renderer/styles/*.css` (about 130 hits in 13 files).
  Things that were round pills or dots (tick boxes, habit dots, tag swatches,
  theme toggle) become squares.
- `box-shadow`: every outer shadow (one with a blur and no `inset`) becomes
  `none`, or `var(--bevel-out)` if the element is a raised surface (button, card,
  popover). About 50 hits.
- `backdrop-filter`: remove all three (`graph.css`, `notifications.css`,
  `schedule.css`) and make those surfaces opaque (`background: var(--face)`).
- Hard-coded hex colours outside the token blocks (about 66): replace with the
  nearest token. Leave colours that are data (the tag palette `TAG_COLORS`,
  backdrop palettes) alone.
- Focus: add to `base.css`
  `:focus-visible { outline: 1px dotted var(--fg); outline-offset: -4px; }` (the
  98 dotted focus rectangle). Remove other focus rings that fight it.
- Text selection: `::selection { background: var(--accent); color: var(--accent-fg); }`.
- Images and icons: `img, svg.px { image-rendering: pixelated; }` and
  `shape-rendering: crispEdges` on pixel icons (task 4.3).

**3.4 Headings.** Every view's `h1`/`h2` uses `font-family: var(--font-display)`;
section labels ("Tracker", "Links", "Linked from", settings section names) use
`var(--font-display)` at 16px. Do not write a family name anywhere else.

**3.5 Docs.** CONTEXT §3 "Appearance and fonts": the rule becomes "families are
set only through `--font-ui`, `--font-display`, `--font-display`; never write a
family name in a component rule". Update the §13 Plex row (D22) and add rows for
the two themes, 0 radius, no outer shadows, and the four fonts.

**Gate:** both suites pass. Screenshots, light and dark, of Home, Journal,
Schedule, Notes: they should already look grey/navy and black/green, boxy, with
pixel headings. Compare with image 7 (light) and image 6 (dark). Commit
`Retro: tokens, fonts, square corners`.

---

### Phase 4 — The component kit

Create `src/renderer/styles/retro.css` and link it in `index.html` **right after
`base.css`**. It holds the shared look; each component's own CSS file then
uses these classes or the same tokens. Build each from image 7 unless noted.

**4.1 Buttons** `.btn` (and apply the same rules to the existing button
classes rather than renaming them all):
`background: var(--face); box-shadow: var(--bevel-out); border: 0;
padding: 4px 12px; min-height: 24px;` `:active` and `[aria-pressed="true"]` →
`box-shadow: var(--bevel-in)` and the label moves `translate(1px, 1px)`.
Disabled → `color: var(--lo)` with `text-shadow: 1px 1px var(--hi)` (the 98
etched look). Primary variant `.btn-primary`: 1px `--fg` outline outside the
bevel (98 "default button"). Dark theme: `:hover` adds `text-shadow: var(--glow)`.

**4.2 Fields** (`input`, `textarea`, `select`, and the editors):
`background: var(--field); box-shadow: var(--bevel-field); border: 0;
border-radius: 0; padding: 4px 6px;` Spinner style for number/time fields from
image 3 (two small stacked bevel buttons) only where a stepper already exists.

**4.3 Icons.** Download only the pixelarticons the app uses from
`https://unpkg.com/pixelarticons@1.8.1/svg/<name>.svg` into
`src/renderer/icons/`, plus
`https://raw.githubusercontent.com/halfmage/pixelarticons/master/LICENSE` as
`icons/LICENSE.txt`. Names confirmed to exist: `home calendar calendar-month
checkbox checkbox-on check checklist notes note book book-open article
script-text folder folder-plus file file-plus chart chart-bar analytics
git-branch sliders close minus plus trash search edit link heart mood-happy
mood-sad mood-neutral clock volume volume-x volume-1 volume-2 volume-3 speaker
keyboard sun moon zap bookmark bulletlist list grid image power reload undo
redo arrow-left arrow-right chevron-left chevron-right chevron-down
drag-and-drop pin clipboard dashboard trophy flag`. (There is no `settings-cog`;
use `sliders` for Settings.)

Make `src/renderer/js/icons.js` exporting `icon(name, size = 24)` that returns a
new `<svg class="px" viewBox="0 0 24 24">` built with `createElementNS`, with
one `<path fill="currentColor">`. Copy each icon's `d` string from the downloaded
files into a `PATHS` object in that module, so nothing is fetched at runtime and
the icons take the text colour. Keep the downloaded `.svg` files in `icons/` as
the source. This also covers Efficiencies 15. Sizes: 24 or 48
only. Replace the sidebar's inline SVG icons and the helpers named in
Efficiencies 15 (`tickButton`, `iconButton`, the journal display icon, the
notification close icon) with `icon()`.

**4.4 Window** `.win`, `.win-title`, `.win-body`, `.win-status`:
- `.win`: `background: var(--face); box-shadow: var(--bevel-out); padding: 3px;`
- `.win-title`: `background: var(--title-bg); color: var(--accent-fg);
  font-family: var(--font-display); font-size: 16px; height: 24px; display: flex;
  align-items: center; gap: 6px; padding: 0 3px 0 6px;` with an icon at the
  left, the name, then right-aligned small square bevel buttons (16x14, the 98
  size). Their glyphs (□ and ×) are too small for the 24px icon grid, so draw
  them as text in Pixelify Sans 14px, not as scaled-down icons. Each button gets an
  `aria-label` ("Hide sidebar", "Close").
  Dark theme: title bar is `--face` with a 1px `--line` bottom border and the
  name in `--accent`, all caps, like image 6's top bar.
- `.win-status`: a row of sunken cells (`box-shadow: var(--bevel-field)`,
  `font-size: 12px`), like the bottom of images 5 and 9.

**4.5 Checkbox** `.check`: 16x16 square, `--field`, `--bevel-field`. When
checked it shows a 7x7 pixel tick, drawn as a small inline SVG on a 16 grid made
of `<rect>`s with `shape-rendering: crispEdges` (the 24px `check` icon does not
fit a 16px box). Replace the round tick buttons in `todo.js` and `habits.js`
with it. Keep their click targets at least 24px.

**4.6 Tabs** `.tabs` from image 3 and 7: the active tab is raised and joins the
panel below; inactive tabs sit 2px lower. Use for the journal tabs, schedule
D/W/M switch, settings sections.

**4.7 Group box** `.group` from image 3: a 2px etched border (`1px --lo` then
`1px --hi`) with the label sitting in the top border on the face colour. Use in
Settings and in the schedule's editor popover.

**4.8 Menu** `.menu` (for the sidebar and the editor menu bar, Phase 5): rows
of icon + label, 24px tall; hover = `--accent` fill and `--accent-fg` text;
separators are an etched 2px line. Image 1.

**4.9 Progress** `.progress`: sunken track, filled with **blocks**
(`repeating-linear-gradient(90deg, var(--accent) 0 8px, transparent 8px 10px)`),
like a 98 progress bar. Used by toasts (Phase 6) and the habit "today" meter.

**4.10 Dither** utility: `.dither` background
`repeating-conic-gradient(var(--accent) 0 25%, transparent 0 50%) 0 0 / 2px 2px`.
Used for "partly done" cells and disabled areas.

**4.11 Dialog** `js/dialog.js`: `confirmDialog({ title, message, okLabel,
danger })` → `Promise<boolean>`. A centred `.win` with OK/Cancel (image 3 and
7), focus trapped, Enter = OK, Esc = Cancel, built with `createElement` and
`textContent`. Use it for deleting a journal and a note (closes the "no
confirmation" gaps in CONTEXT §12, bugs.md 7.9 and todo.md). Add a `test:ui`
check that Cancel keeps the note and OK deletes it.

**Gate:** both suites pass, plus the new dialog check. Commit `Retro: component kit`.

---

### Phase 5 — The shell: desktop, windows, Start-menu sidebar

**5.1 Views become windows.** Every `section.view` in `index.html` gets a title
bar as its first child: `<header class="win-title">` with the view's icon and
name, then the [□] and [×] buttons (§2, "Window chrome"). The [□] button calls
the same function as Ctrl+\ in `sidebar.js` (export it if needed). The [×] button
navigates to `home`; on `home` itself there is no [×]. Remove the per-view back
arrows these replace (search `index.html` and the view modules for them). Give
each `.view` a 10px inset from the window edges so the desktop shows around it
(update `.view`'s `top/bottom/left/right` in `base.css`, keep `right` reading
`--sb-w`). The brand logo is fixed top left; make sure no title bar sits under
it (give the home window's title bar left padding, or move the brand into the
home title bar).

Window titles, in the spirit of image 9: `HOME`, `SCHEDULE.EXE`, `TODO.EXE`,
`HABITS.EXE`, `JOURNAL.EXE - <title>.txt` (updated when a journal opens),
`NOTES.EXE - <folder>\<title>.txt`, `GRAPH.EXE`, `SETTINGS`. Set the dynamic
parts with `textContent`.

**5.2 Status bars.** Add a `.win-status` row at the bottom of Schedule, To-do,
Habits, Journal list, Notes and Graph. Content, all derived from `state.js`
data the view already has: Schedule `N events this week`; To-do `N tasks · plan
ends 5:40 PM`; Habits `N of M done today`; Journal `N journals · streak N days`;
Notes `N notes, N folders` (or the open note's path); Graph `N nodes, N links`.
Update them inside each view's existing render function; do not add a new
subscriber.

**5.3 Sidebar as a Start menu** (image 1). In `sidebar.css`: `--face`
background, `--bevel-out`, 24px icon + label rows using `.menu`, etched
separators between the nav group, the Notes tree and Settings. Add a vertical
banner strip on its outer edge, 22px wide, `--title-bg` (rotated gradient),
with "ethos" written bottom to top in `--font-display` (pure CSS
`writing-mode: vertical-rl; transform: rotate(180deg)`). Active item: sunken
(`--bevel-in`). Keep `--sb-w` as the single width source (CONTEXT "The sidebar");
the banner is inside that width.

Optional, if time allows: the todo.md item "a single sliding highlight between
items" using the shared `Spring` (Phase 7.1).

**5.4 Theme toggle** (`#toggle`, bottom left): a square bevel button with
`sun`/`moon` icons. Keep the hover-reveal rules exactly (CONTEXT §3).

**5.5 Backdrop** (`backdrop.js`, `backdrop.css`, Settings > Background). Add a
mode `pattern` with presets: `teal` (solid `--desktop`), `dither` (the 4.10
pattern in `--desktop` and a darker teal), `grid` (1px lines every 16px),
`scanlines` (`repeating-linear-gradient(0deg, rgba(0,0,0,.25) 0 1px,
transparent 1px 3px)` over `--desktop`). All CSS, no files. Make
`pattern`/`teal` the default for new installs only (an existing
`localStorage` choice wins). Keep the readability veil rule for `image` mode
(CONTEXT §14: "do not weaken it"). Update the `test:ui` check that asserts the
default is `gradient` (line ~56) to expect `pattern`.

**5.6 Scanline overlay (dark only).** A fixed, `pointer-events: none` layer over
the whole app with a faint `repeating-linear-gradient` (alpha ≤ 0.06) and a
Settings toggle "CRT lines" (default on in dark). Off under reduced motion is not
needed (it does not move) but must be off when the toggle is off. Image 10 is the
reference for the texture.

**Gate:** both suites pass. Screenshots of every view in both themes. Compare
Home and Journal with images 8 and 9. Commit `Retro: desktop, windows, Start menu`.

---

### Phase 6 — Segment by segment (demo scope, in demo order)

For each segment: restyle with the Phase 4 kit and tokens only, run `test:ui`,
look at the screenshot, fix, move on. Do not change behaviour except where a
step says so. Commit after each segment (`Retro: <segment>`).

**6.1 Home.** Heading in `--font-display` at 48px (image 8's "about me!" scale).
Quote card and to-do card become `.win` panels with small title bars (`QUOTE`,
`TODAY`). Habits row: `.check` boxes. Keep the two-column grid and its
alignment test (CONTEXT §14).

**6.2 Clock** (image 3). In `clock.css` and the SVG attributes in `clock.js`
only: a round face (the one radius exception) on `--field` with a
`--bevel-field` ring; 60 small dot ticks in `--line`, 12 **square** hour marks in
`--accent`; hands drawn as solid `--accent` shapes (in dark, phosphor with
`--glow`). Readout under or above the face in a sunken `.field` box with the
weekday, Pixelify Sans. **Do not touch `forward()` or the tick timing.**

**6.3 Schedule** (`schedule.css`). Grid lines 1px `--line`; events are flat
boxes, 1px border in their colour, title bar strip in the event colour, no
radius, no shadow. The mini month copies image 3: navy header row of weekday
letters, selected day navy with white text, today with a dotted outline. D/W/M
switch uses `.tabs`. The editor popover becomes a `.win` with `.group` boxes.
The ink (`.sc-ink`) keeps its spring and lean; give it a 1px dashed border in
`--accent` and a `.dither` fill so it reads as a pixel selection rectangle.
To-do blocks (`.sc-todo`) keep their dashed look.

**6.4 To-do** (`todo.css`). Two lists side by side as two `.win` panels,
`TO DO` and `TO REMEMBER`. Rows: `.check`, title, time in `--muted`. Drag drop
line becomes a 2px `--accent` line with square ends. The input row: a `.field`
plus a `.btn`. The live preview line in a sunken `.win-status`-style cell.
**Demo:** hide `.td-blockers` (Phase 8 does this through the edition flag; do
not delete it).

**6.5 Habits** (`habits.css`, and the streak grid in `journals.css`). Grid
cells are 12x12 squares with a 2px gap: empty = `--field` with `--bevel-field`,
some = `.dither`, all = solid `--accent`. Today's list uses `.check`. Add a
`.progress` bar "N of M today". Efficiencies 14 suggests one shared
`drawGrid()` for the habit and streak grids; do it now if the two grids need the
same new markup anyway.

**6.6 Journal** (image 9 is the model).
- List: cards become small `.win` panels with the journal's title in the title
  bar, or (better, image 5) a grid of `file` icons with the title under each, with
  the existing display-mode switch choosing between them.
- Editor (`#journal-page`): a `.win` titled `JOURNAL.EXE - <title>.txt` with a
  **menu bar** under the title (`FILE  EDIT  VIEW  HELP`, `--font-display` 16px).
  Each menu is a `.menu` dropdown that **only regroups controls that already
  exist** (todo.md: "Rework the journal page header as one block"):
  FILE: New journal, Delete (uses `confirmDialog`); EDIT: Tags…; VIEW: Paper ▸
  Plain / Lines / Grid, Prompts; HELP: Show prompts, Keyboard shortcuts.
  Typing sounds go in VIEW once Phase 7 exists. Menus open on click, close on
  Esc / outside click, arrow keys move, Enter selects.
- Writing surface: `--field`, Plex Mono, generous padding, `caret-color:
  var(--accent)`. Try `caret-shape: block;` and keep it only if Chromium in
  Electron 44 supports it (check with `CSS.supports('caret-shape', 'block')` in the
  harness). The paper modes keep `1lh` rules.
- Status bar: path `C:\ETHOS\JOURNAL\<title>.txt` (a fun nod to image 9;
  `textContent`), word count, saved/saving state.

**6.7 Notes and folders** (image 5). Notes home: a toolbar (`New note`,
`New folder`, `Graph view` as icon `.btn`s), an address bar showing
`ethos:\notes\<folder>`, then a grid of `folder` and `file` icons (48px) with
labels under them; double-click opens, single click selects (navy label
background, like image 5). The open note uses the same Notepad window as the
journal (share the CSS). Links and "Linked from" chips become small raised
`.btn`s with a `link` icon.

**6.8 Graph** (`graph.js`, `graph.css`). Read `--accent`, `--fg`, `--muted`,
`--bg` on theme change as now. Draw pages as **squares** snapped to whole pixels
(`Math.round`), folders as hollow squares, lines 1px; set
`ctx.imageSmoothingEnabled = false`. Light: navy nodes on `--field`. Dark:
phosphor nodes with a faint glow (`shadowBlur` 6, only for lit nodes, so the
frame cost stays low). Labels in Plex Mono 12px. The floating panel becomes a
`.win` titled `GRAPH`. Keep every input behaviour and the hidden keyboard list
(`#gr-list`); add a visible dotted focus outline to the lit node so bugs.md
11.10 is closed.

**6.9 Settings** (image 3). Sections become `.tabs` (`Appearance`, `Background`,
`Sound` (Phase 7), `About`). Controls inside `.group` boxes. Font cards become a
list of radio rows. About tab: `img/logo-128.png`, "Ethos", the version
(`package.json` version, passed in on `state:load`, see 8.2) and "Demo edition".

**6.10 Notifications** (`notifications.css`). Each toast is a small `.win`: a
title bar with a type icon (`check`, `zap`, `flag`, `close`) and the title, the
message in the body, and the countdown as a `.progress` bar instead of the
current line (it still reads `--notif-duration`). Keep the enter spring and the
faster exit, the stack, the 4 limit and hover-pause (CONTEXT §8). Opaque, no
blur. Update CONTEXT §8 (D24).

**6.11 Context menu** (`views.js` `showCtx`). Restyle with `.menu`, and fix
bugs.md 2.4 while there: clamp the menu inside the viewport.

**Gate per segment:** `test:ui` passes; screenshots in both themes look like
their reference image. Any test that asserted the old look (a translucent toast,
a gradient, a radius) is updated to the new look, never deleted.

---

### Phase 7 — Alive: motion, mechanics, typing sounds (userref D, E)

**7.1 Shared spring.** Move `class Spring` out of `schedule.js` (it starts near
line 78) into `src/renderer/js/spring.js`, export it, import it in
`schedule.js`. No behaviour change; the schedule tests must still pass. This
closes todo.md "Factor Spring out of schedule.js".

**7.2 Button mechanics.** In `retro.css`: press = bevel flips to `--bevel-in`
and the label drops 1px, in 60ms; release springs back with the app's easing
`cubic-bezier(0.34, 1.4, 0.64, 1)` over 160ms. Hover: light theme lifts the face
to `--hi-2`; dark theme adds `--glow` to the text. Checkbox tick draws in
`steps(3)` (a pixel-by-pixel reveal) over 90ms.

**7.3 Windows open.** When a view becomes active (`views.js`), its `.win`
plays a short open: `transform: scale(.96)` to `1` in `steps(4)` over 120ms
(the 98 "zoom" feel) then a 1px settle on the spring. Leaving a view is
instant. Reduced motion: none of it.

**7.4 Alive details.** Keep each one cheap (transform/opacity only):
- Title bar of the focused window is `--title-bg`; other windows on screen
  (popovers, dialogs) get a grey title (`--lo`), like 98 inactive windows.
- The brand logo's orbit: a 6s slow `rotate` on a separate ring layer is **not**
  possible with a flat PNG; skip it unless the user later supplies a layered logo.
- Status bar "saving…" shows a three-dot blinking cursor `▌` while a save is
  pending.
- Hover on list rows and icons: the row highlight follows the pointer with the
  shared Spring (the sidebar first; todo.md "sliding highlight").

**7.5 Typing sounds.** New module `src/renderer/js/sound.js`:

```js
// Typing sounds, synthesised with the Web Audio API so no audio files ship
// and the CSP needs no media-src. Off by default.
export function initSound() {}               // reads prefs, wires listeners
export function setTypingSound(on) {}        // saves prefs, notifies listeners
export function typingSoundOn() {}
export function setVolume(v) {}              // 0..1
export function onSoundChange(fn) {}         // returns unsubscribe
```

Behaviour:
- Prefs in `localStorage` key `ethos.sound` = `{ typing: false, volume: 0.5,
  offered: false }`, every read and write in `try/catch`.
- Create the `AudioContext` lazily on the first keydown after the user turned
  sounds on (a keydown is a user gesture, so `resume()` works).
- Build one 40ms white-noise `AudioBuffer` once. For each key: a
  `BufferSource` → `BiquadFilter` (bandpass, frequency random 1800-2600 Hz,
  Q 1.5) → `Gain` (attack 1ms, exponential decay to 0.001 over 35ms) → master
  gain (`volume * 0.25`). Space and Enter: also a 160 Hz sine at 0.3 for 30ms
  (the "thock"). Backspace: bandpass 3200 Hz, 20ms. Randomise playback rate
  0.9-1.1 so it never sounds like a loop.
- Listen with one delegated `keydown` on `document`, only when the target has
  `data-typing-sound` (add it to `#jp-textarea` and `#nt-body`). Ignore
  `e.isComposing`, modifier-only keys, and key repeats closer than 50ms. At most
  one sound per 20ms. Silent while `document.hidden`.
- Discovery: the first time a `data-typing-sound` field is focused and `offered`
  is false, show `notify.info('Typing sounds', 'Want a keyboard click as you
  write?')` with action `Turn on`, then set `offered: true`.
- Controls: Settings > Sound tab (`.group` "Typing": an on/off `.check`, a volume
  slider styled like image 2's slider: sunken track, square raised thumb), and in
  the editor's VIEW menu a "Typing sounds" item with a tick. Both read and write
  through `sound.js`.
- `test:ui`: add checks that the toggle persists across a reload and that
  `data-typing-sound` is on both editors. Do not try to assert audio output.

**7.6 Fluid typing.** In the editors: a 2px `--accent` block-ish caret (7.5's
caret-shape check); in dark, text has a very faint phosphor `text-shadow`
(`0 0 2px` at 40% accent). No per-character animation: it costs layout on long
documents.

**Gate:** both suites pass, new checks included. Turn sounds on in the running
app and type in a journal: no lag at fast typing, no sound in other inputs.
Commit `Retro: motion and typing sounds`.

---

### Phase 8 — The demo edition (userref F)

**8.1 Edition flag in main.** New `src/main/edition.js`:
`module.exports = { EDITION: 'demo' };` In `ipc.js` the `state:load` handler
returns `{ ...store.snapshot(), tagColors, minutesInDay }`. Add three fields to
that reply: `edition` (from `edition.js`), `version` (`app.getVersion()`) and
`packaged` (`app.isPackaged`). `ipc.js` already requires `electron`, so import
`app` there. No new IPC channel. Add a `check.js` case only if the `state:load`
shape is tested there.

**8.2 Edition in the page.** In `app.js`, after `state.load()`, set
`document.body.dataset.edition`. In `base.css`:
`body[data-edition="demo"] [data-full-only] { display: none !important; }`.
Mark with `data-full-only`: the Mood log sidebar button, `#mood-page`, the
homepage mood card, `.td-blockers`. In `views.js`, refuse to navigate to a view
marked `data-full-only` in the demo (go to `home` instead), so a
`data-view-link` or a keyboard path cannot reach it. Keep `mood.js` running
(hidden), so data from a full build is untouched. Note in CONTEXT §1 that this
is display gating only; real entitlement checks will live in main (the renderer
is untrusted).

**8.3 Window title** `Ethos — Demo` (`index.html` `<title>` and/or
`BrowserWindow` `title`).

**8.4** Update `test:ui`: the Mood log tests should run with the edition forced
to `full` (add a test-only override the same way as task 1.3:
`localStorage['ethos.test.edition']`, honoured **only** when the main process says
it is not packaged, using the `packaged` field from 8.1). Add checks that in `demo` the mood button and blockers are hidden and
that navigating to `mood-page` lands on `home`.

**Gate:** both suites pass. Commit `Retro: demo edition`.

---

### Phase 9 — Package the demo

**9.1 electron-builder.** `npm i -D electron-builder@26.15.3` (exact version;
current on 2026-10-23). Electron stays in `devDependencies`; that is where
electron-builder wants it (D15). In `package.json`: `"version": "0.1.0-demo"`,
`"productName": "Ethos"`, a script `"dist": "electron-builder --win"`, and:

```json
"build": {
  "appId": "com.ethos.app",
  "productName": "Ethos",
  "directories": { "output": "dist" },
  "files": ["src/**/*", "assets/**/*", "package.json"],
  "asar": true,
  "compression": "maximum",
  "electronLanguages": ["en-GB", "en-US"],
  "win": { "target": ["nsis"], "icon": "assets/icon.ico" },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "installerIcon": "assets/icon.ico",
    "uninstallerIcon": "assets/icon.ico",
    "shortcutName": "Ethos"
  }
}
```

The `files` list leaves out `references/`, `backups/`, `imgs/`, `scripts/` and the
docs (Efficiencies Storage step 3). `dist/` is already in `.gitignore`.
`appId` matches `setAppUserModelId('com.ethos.app')`, which Windows toasts need.

**9.2 Font weight (optional, do it if 9.4 shows the installer over 100 MB).**
Convert the TTFs to WOFF2 with `pip install fonttools brotli` and
`pyftsubset <font> --flavor=woff2 --unicodes="U+0000-00FF,U+2010-205E,U+20AC,U+2122,U+2190-21FF,U+2500-259F" --output-file=<name>.woff2`.
The OFL reserves "IBM Plex" for unmodified fonts: **a subset is a modified font**,
so either keep Plex as TTF and subset only the Google OFL fonts (check each
`OFL.txt` for a Reserved Font Name line first), or rename the subset family.
Update `fonts.css`. Fix D17 in Efficiencies.

**9.3 Paths when packaged.** Inside asar, `__dirname` paths still work for
`BrowserWindow` `icon`, `nativeImage.createFromPath` and the `app://` handler.
Verify each one in the packaged app, not by reading.

**9.4 Build and smoke test.** `npm run dist`. Then run
`dist/win-unpacked/Ethos.exe` and check by eye: window and taskbar icon are the
new logo; tray icon is the new logo; the intro plays; every demo view opens;
Mood and Blockers are hidden; a journal survives a restart; a schedule event
reminder raises a Windows banner (bugs.md 7.11, which also closes todo.md
"Verify the Windows banner by eye... in a packaged build"); the title says
Demo; devtools do not open. Then run the NSIS installer from `dist/`, install,
launch from the Start menu shortcut, uninstall. Record the installer size and
the unpacked size in Efficiencies Storage (replacing the estimates).

Note: the packaged app's data folder is `%APPDATA%\Ethos`, the same folder the
dev build uses (Windows paths ignore case). Testing the packaged build therefore
uses the real vault. That is safe (same schema) but tell the user.

**9.5** If the build is unsigned, the installer shows a SmartScreen warning.
Do not try to work around it; it is open question 5.

**Gate:** `npm run check`, `test:ui`, and the 9.4 list all pass. Commit
`Retro: demo installer`. Do not upload or publish the installer anywhere.

---

### Phase 10 — Close out the docs

- CONTEXT.md: new section "18. Retro redesign and demo (2026-10)" covering the
  tokens, fonts, component kit (`retro.css`, `icons.js`, `dialog.js`,
  `sound.js`, `spring.js`), window chrome, edition flag, packaging. Add the new
  files to §3's layout. Add every decision from this plan's §2 table to §13,
  marked "user may revisit" where they were defaults. Update §2's test counts.
  Update "Start here" (§16) to mention this file.
- todo.md: tick what was done here; move the open questions from this plan's
  §2 into it.
- bugs.md: mark closed what this plan closed (2.4, 6.8, 7.9 confirmation part,
  7.11, 8.1, 10.5, 11.10); add §12 with anything new.
- Efficiencies.md: the measured build sizes; items 8, 15 and 17 updated.
- progress.md: one entry summarising the redesign.
- Leave this plan file in place, with a line at the top: "Executed through
  Phase N on <date>".

Commit `Retro: docs`.

---

## 5. If time runs short

Do the phases in order and stop at a phase boundary. The minimum that delivers
the userref is Phases 1-3, 5, 6 (Home, Journal, Notes), 7.5 (typing sounds),
8 and 9. Everything else is polish.

---

## 6. Execution record (2026-10-23)

Executed by Claude Haiku 5.5 on branch `retro-demo`, one commit per phase. Done in
full unless marked.

| Phase | Result |
|---|---|
| 1 Housekeeping | Done. Docs corrected, prompts loaded (50), nudge 30s with a test override, Plex licence, .bak files removed. |
| 2 Logo | Done. Every size from `scripts/build-icons.py`; tray is a file; intro is a boot sequence. |
| 3 Tokens and fonts | Done. Website palette in dark; Pixelify Sans (Silkscreen and VT323 dropped); radii 0; blurred shadows removed. |
| 4 Kit | Done: retro.css, icons.js (54), dialog.js. Tabs and progress classes exist but are not used yet. The round tick boxes are square now; the 16px check drawn as a pixel tick was not built. |
| 5 Shell | Mostly. Title bars and status rows, Start-menu sidebar, pattern backdrop, scanlines (with a toggle). Not done: the journal name in the title bar (5.1), the vertical banner (5.3), and the sliding highlight (5.3). |
| 6 Segments | Partly: toasts, the context menu (fixes bugs 2.4), graph squares, and a shared chrome for every view. Not done: 6.2 clock, 6.3 schedule restyle, 6.4 to-do two windows, 6.5 habit squares and progress, 6.6 journal menu bar, 6.7 notes folder grid, 6.9 settings tabs. |
| 7 Motion and sounds | Mostly. Spring moved, buttons press, window open, caret, typing sounds with Settings. Not done: 7.4 "alive" details (apart from the shared spring). |
| 8 Demo edition | Done. Edition flag, full-only gating, navigation refused in the demo. |
| 9 Installer | Built and smoke-tested: the packaged app runs and shows the demo. Not done: 9.2 font subsetting (not needed at this size). Not seen by eye: the intro, the tray icon, the Windows banner. |
| 10 Docs | Done here (CONTEXT section 17, bugs 12, Efficiencies, todo, progress). |

Decisions made where the plan left room (all can be reversed):
- Dark theme is the website's palette, per the user's answer about ethos web.
- Pattern is the default backdrop on every view; photos and gradients are still there.
- Scanlines are a toggle in Settings > Background, not always on.
- The sound is off by default, with a one-time toast offer.
- The code-signing step was skipped, as the user asked.

Left for the user: the Windows banner, the intro and tray on a real desktop, the
packaged vault question (bugs 12.8), `npm audit` (bugs 12.10), and the two deleted
reference images in `references/` (they show as deleted in git; not restored).
