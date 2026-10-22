// Renderer entry point: load state from the main process, then wire the views.

import * as state from './state.js';
import { initViews } from './views.js';
import { initTheme } from './theme.js';
import { initTags } from './tags.js';
import { initJournals, commitPending } from './journals.js';
import { todayISO } from './journal-streak.js';
import { initClock } from './clock.js';
import { initQuote } from './quotes.js';
import { initTodo, initReminders } from './todo.js';
import { initHabits } from './habits.js';
import { initSchedule } from './schedule.js';
import { initNotes, commitNotes } from './notes.js';
import { initGraph } from './graph.js';
import { initSidebar } from './sidebar.js';
import { playIntro } from './intro.js';
import { initAppearance, initSettings } from './settings.js';
import { notify } from './notifications.js';
import { initBackdrop, initBackdropSettings } from './backdrop.js';
import { initMood } from './mood.js';
import { hydrateIcons } from './icons.js';
import { initChrome } from './chrome.js';
import { initSound, initSoundSettings } from './sound.js';

// The app can stay open across midnight. Habits, the journal calendar and the
// homepage read "today" when they draw, so a redraw at the new day is all it
// takes to roll them over. Checked every 30s, which is well inside a minute.
function rollOverAtMidnight() {
  let day = todayISO();
  setInterval(() => {
    const now = todayISO();
    if (now === day) return;
    day = now;
    state.refresh();
  }, 30000);
}

async function main() {
  // Appearance first: it sets the font before anything is measured or drawn.
  initAppearance();
  initBackdrop();
  initTheme();
  initSidebar();
  initViews();

  // State first: the tag panel builds its swatches from the palette the main
  // process reports, and the journals list draws from the loaded notes.
  try {
    await state.load();
  } catch (err) {
    notify.show({
      title: 'Could not open your vault',
      message: err.message + ' Nothing you write now will be saved.',
      type: 'error',
      duration: 0,
    });
  }

  initTags();
  initJournals();
  initSettings();
  initSound(notify);
  initSoundSettings();
  initBackdropSettings();
  initClock();
  initQuote();
  initTodo();
  initHabits();
  initMood();
  initSchedule();
  initNotes();
  initGraph();
  initReminders();
  rollOverAtMidnight();
  hydrateIcons();
  initChrome();
  playIntro();

  // Main asks before the window closes and waits for this answer, so text still
  // inside the typing debounce is saved first. A fire-and-forget save on
  // beforeunload could be cut off by the teardown.
  // Both editors hold unsaved typing: journals and Notes pages.
  window.ethos.onCommitRequest(() => {
    Promise.allSettled([commitPending(), commitNotes()])
      .then(() => state.flush())
      .catch(err => console.error('commit before close failed:', err.message))
      .finally(() => window.ethos.closeReady());
  });
}

main();
