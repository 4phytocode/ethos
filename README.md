# Ethos

**Version 1.0**

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
- **To-dos** – quick capture, drag and drop to reorder.
- **Habit tracker** – daily habit grid with streaks.
- **Journals** – tagged entries, writing prompts and a streak tracker.
- **Notes** – folders, pinned and temporary notes, Notion-style blocks and
  tables, links between notes with a graph view, a quick switcher (Ctrl+P),
  duplicate, drag-to-folder and search.
- **Day notes** – a calendar of notes per day with subject chips.
- **Goals** – one-week, one-month and one-year goals, shown on the homepage.
- **Timers** – custom timers with an alarm and a Windows notification.

## Running it

```
npm install
npm start          # launch the app
npm run check      # model-layer checks (plain node)
npm run test:ui    # end-to-end UI checks in a real window
npm run dist       # build the Windows installer into dist/
```

## Current limitations (v1.0)

- Windows only. No accounts, sync or mobile access yet.
- Data is stored as plain, unencrypted JSON on the local machine, with no
  built-in backup or export.
- The schedule has no recurring or multi-day events, and events cannot be
  tagged from the UI.
- No undo for deleted notes or journals; tags cannot be renamed or recoloured
  from the UI.
- Past days cannot be ticked from the habit page.
- Notes have no rich text formatting or nesting.
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
