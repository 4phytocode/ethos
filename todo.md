# Ethos TODO

See CONTEXT.md for how the software is built and maintained: layers,
invariants, the IPC surface, environment traps, and decisions already made.
This file is the roadmap only. Bugs live in bugs.md.

Last updated 2026-10-23 (the retro redesign and demo is planned in PLAN-retro-demo.md).

## Retro redesign and demo (2026-10-23)

See PLAN-retro-demo.md. The answers to its open questions are recorded in its section 0a.

## Order of work (user's call, 2026-10-19)

1. [x] Schedule system, first pass (Google Calendar-like, minimalist, "liquid" drawing)
2. [x] Journals made more minimal ("Tracker" label, pen clipart removed)
3. [x] Notion-style sidebar on the right with full names, hide / show
4. [x] Notes section in the sidebar (folders, notes, temporary notes), first pass
5. [ ] **Debugging and fixing pass** over the habit tracker, journals and
       everything else. Saved for later, ahead of beta. Start from bugs.md and
       the "Debugging pass" list below.

## Schedule

Built 2026-10-19 on the event model that was kept dormant. Week, day and month
views; draw / move / stretch events with a spring-driven "ink" preview; an
editor popover that saves as you type; mini month; "Up next"; keyboard
shortcuts; reminders that reach the Windows notification centre.

- [x] Week, day and month views, with sliding transitions between ranges
- [x] Draw an event by dragging on the grid; click for a one-hour event
- [x] Drag to move (across days), drag the lower edge to stretch, snapped to 15 min
- [x] All-day events (all-day row in week/day, any cell in month); drag chips between days
- [x] Editor: title, date, all-day, start/end, colour, reminder, notes, done, delete (with Undo)
- [x] Event colour (palette only) and reminder minutes: schema v4 with migration
- [x] Reminders: in-app toast + Windows notification, even with the window in front
- [x] Closing the window keeps Ethos in the tray while an event reminder is pending today
- [x] Mini month, "Up next" list, now line, overlapping events side by side
- [ ] Recurring events (daily / weekdays / weekly / monthly)
- [ ] Multi-day events (the model is one calendar day per event)
- [ ] Drag a timed event into the all-day row and back
- [ ] Set tags on an event (model supports tagIds; no UI)
- [ ] Undo for move and stretch, not just delete
- [ ] Snooze on a reminder ("in 5 min")
- [ ] Search events
- [ ] Settings: week starts on, 12h / 24h clock, default reminder, default length
- [ ] Link to-dos and the schedule (drag a to-do onto the grid to time-block it)
- [ ] Pen and touch input checked on a real device
- [ ] Verify the Windows banner by eye on a real desktop, and in a packaged build
      (the AppUserModelId must match the installer's)

## "Liquid" interaction across the app

The schedule's ink (spring follow, lean and squash from velocity, bloom on
creation, settle on drop) is the model. Bring it to every segment once the
debugging pass is done.

- [ ] Factor `Spring` out of `schedule.js` into a shared module
- [ ] To-dos: drag to reorder with the ink (drag and drop already exists, CONTEXT §15)
- [ ] Habit tracker: drag across the grid to fill days
- [ ] Journals: cards that settle when reordered or filtered
- [ ] Notes: drag notes into folders, drag folders to reorder
- [ ] Sidebar: a single sliding highlight between items, like the schedule's segment control

## Sidebar

- [x] Notion-style: full names, icons, active item, on the right
- [x] Hide / show (button, and Ctrl+\), remembered per machine
- [x] Views, toasts and the habit bar follow its width
- [ ] Resizable width
- [ ] The per-view back arrows are now redundant with the sidebar: decide to keep or drop
- [ ] Favourites / pinned notes at the top

## Notes (first pass, to be revamped)

- [x] Folders (create, rename by double-click or menu, delete keeps the notes)
- [x] Notes inside folders, loose notes, temporary notes
- [x] Notes view: overview of recent notes, or one open note with folder picker
- [x] Own model, files (`pages/`, `folders.json`), validated IPC and checks
- [ ] Decide what "temporary" means: auto-expire after N days, or just a scratch tag.
      Nothing expires today.
- [ ] Nested folders
- [ ] Rich text / Markdown (must be sanitised before render: XSS in Electron is close to RCE)
- [ ] Delete confirmation or undo for notes
- [ ] Search across notes
- [ ] Decide whether journals and notes should merge into one document system

## Journals

- [x] "Days journalled" label renamed to "Tracker"
- [x] Pen clipart removed; header is a plain "Journal" title
- [ ] Decide where tags live: inline on the page vs. a dedicated tag bar or sidebar
- [ ] Rework the journal page header (title, tag row, actions) as one block
- [ ] Decide whether the two tag panels stay inline or become one popover
- [ ] Cards have no notebook/section line; decide whether to add notebooks or drop the idea
- [ ] Backdating: a journal counts for the day it was created, with no way to say
      "this entry is for yesterday"

## Integrations (later; keep in mind now)

- [ ] **Cross-device notifications.** Reminders should reach the user's iPhone and
      other devices, not just Windows. Needs accounts + sync, then push (APNs / FCM)
      through a companion app, or a cheaper first step: publish the schedule as a
      calendar feed (ICS / CalDAV / Google Calendar) so the phone's own calendar alerts.
- [ ] **EthosBlock, the browser extension (Chrome first).** Blocks large parts of
      websites during deep-work periods, and greyscales sites the user still has to
      use. Desktop app tells it what and when through native messaging or a local
      port. Greyscaling other *desktop apps* needs an OS-level approach (Windows
      Magnification API colour effects); research before promising it.
- [ ] Calendar import / export (ICS, Google Calendar)

## Debugging pass (saved for later, before beta)

Everything in bugs.md, plus these known gaps:

- [ ] Habit tracker: tick or untick past days from the UI
- [ ] Habit tracker: edit / rename habits, optional description and colour
- [ ] Habit tracker: streaks, per-habit history view, missed days
- [x] The bottom habit bar: removed 2026-10-21 (habits are on the homepage)
- [ ] Share one grid-drawing function between the journal streak and the habit grid
- [x] Edit a to-do's title from the UI (inline rename, CONTEXT §15)
- [ ] Verify the homepage to-do card shows real items end to end
- [ ] Verify the quote feature in the app run (hover reveal, no clipped attribution)
- [ ] Decide if quotes should ever come from a live source (BrainyQuote blocks it; ZenQuotes is not topic-filtered)
- [ ] Settings: text size; vault location, export and backup; account section once logins exist
- [ ] Nothing is encrypted at rest; the vault is plain JSON under userData
- [ ] No vault backup or export yet (Markdown export is a pure function over the model)
- [ ] Tag rename and recolour work in the model but have no UI
- [ ] Deleting a journal has no undo and no confirmation
- [ ] To-do reminders still only raise a Windows banner when the window is not in front

## Tooling (phase 4)

- [ ] TypeScript across main, preload and renderer
- [ ] ESLint with the Electron and security rules
- [ ] Promote scripts/check.js to a real test runner (Vitest) as it grows
- [ ] Playwright smoke tests (app boots, a note survives restart, draw an event).
      A throwaway harness that drives the app with `sendInputEvent` and screenshots
      was used for the schedule; see CONTEXT.md §9.

## Done earlier (history)

Architecture phases 1-2 (process split, app:// origin, CSP, validated IPC, vault
with atomic writes and migrations, quarantine, debounced saves, checks), the
homepage (clock, quote, to-do card, theme dial), to-dos with planned finish
times and reminders, the habit tracker basics, the journals reorganisation
(streak strip, tabs, display modes, search, sort, filter), Settings > Appearance
with IBM Plex Mono, and the Ethos app icon.
