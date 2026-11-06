# Ethos

**Version 1.1**

Ethos is a Windows desktop productivity app built with Electron. It puts your
day in one place: what you have scheduled, what you need to do, the habits you
are building, and the things you want to write down. Everything is stored
locally on your machine, with a retro, pixel-styled interface in light and dark
mode.

## What it does

Ethos replaces a handful of separate apps (calendar, to-do list, habit tracker,
journal, notes, timer) with a single window and a homepage that shows the day
at a glance.

## Core features

- **Homepage** – today's to-dos, habits, mood log, goals and upcoming events on
  one screen.
- **Schedule** – week, day and month calendar views. Drag on the grid to create
  an event, drag to move it, stretch it to change its length. Events have
  colours, notes and reminders.
- **Reminders** – in-app toasts plus Windows notifications. Ethos stays in the
  tray while a reminder is pending.
- **To-dos** – quick capture, drag and drop to reorder, and a description for
  what each task is about.
- **Habit tracker** – daily habit grid with streaks.
- **Journals** – tagged entries, writing prompts and a streak tracker.
- **Notes** – a full-page block editor: headings, body and caption text,
  bold, italic, underline, strikethrough, code, colours and highlights, links,
  bullet, numbered and task lists, toggles, quotes, rules, footnotes, code
  blocks with highlighting, images and bookmarks, and Notion-style tables.
  Folders nest, take a colour and tags, and can be found by search. Pinned and
  temporary notes, links between notes with a graph view, a quick switcher
  (Ctrl+P), duplicate and drag-to-folder.
- **Day notes** – a calendar of notes per day with subject chips.
- **Goals** – one-week, one-month and one-year goals, shown on the homepage.
- **Timers** – custom timers with an alarm and a Windows notification.

## What's new in 1.1

- **Notes editor**: type fluidly on a borderless full page with Word and Google
  Docs shortcuts, a toolbar and a bubble over selected text. Right-click (or
  type "/") to insert a table, task list, toggle, bullets, rule, footnote,
  code, image or link. Press **Insert** for a block caret, like a terminal's.
  Find and replace (Ctrl+F / Ctrl+H), drag blocks by their handles, undo and redo.
- **Tables** gain status, multi-select and link columns, sorting, filtering,
  resizable columns, calculations, and undo for deleted rows and columns.
- **Folders** inside folders, with a colour and tags; the search finds folders
  by tag.
- **Search anywhere**: press **Tab** (when not typing) or use the magnifier.
  Tab inside it switches between notes, folders, schedule, to-dos and more.
- **Command bar**: press **/** and run `shut-down`, which plays the intro
  backwards and closes Ethos.
- **Currently doing**: beside Settings, a pixel coffee cup with the next timer
  and the task you are on.
- **Floating timers** you can drag, minimise and hide (Ctrl+Shift+T).
- **Background image opacity**, and a **description** on every to-do.

## Running it

```
npm install
npm start          # launch the app
npm run check      # model-layer checks (plain node)
npm run test:ui    # end-to-end UI checks in a real window
npm run test:editor  # the note editor alone, with real key events
npm run dist       # build the Windows installer into dist/
```

## Current limitations (v1.1)

- Windows only. No accounts, sync or mobile access yet.
- Data is stored as plain, unencrypted JSON on the local machine, with no
  built-in backup or export.
- The schedule has no recurring or multi-day events, and events cannot be
  tagged from the UI.
- No undo for deleted notes or journals; tags cannot be renamed or recoloured
  from the UI.
- Past days cannot be ticked from the habit page.
- Text cannot be selected across note blocks (select whole blocks with Esc or
  the block handle). The Insert block caret works in the note editor only.
- Images are local files only (no remote images or link previews), and there
  are no spelling suggestions in the right-click menu.
- The Blockers feature is a placeholder and does nothing yet.
- Windows notifications have only been tested on one machine.

## What's next

- **Accounts and sync** so reminders and data reach every device, including
  phones.
- **EthosBlock**, a Chrome extension that blocks or greyscales distracting
  websites during deep-work periods, driven by the schedule.
- **Schedule upgrades**: recurring and multi-day events, event tags, snooze,
  search, and dragging to-dos onto the calendar to time-block them.
- **"Liquid" interactions** across the whole app, matching the schedule's
  spring-driven drag feel.
- **Backup / export**, vault encryption, and a full debugging pass before beta.
