// Renderer entry point: load state from the main process, then wire the views.

import * as state from './state.js';
import { initViews } from './views.js';
import { initTheme } from './theme.js';
import { initTags } from './tags.js';
import { initJournals, commitPending } from './journals.js';
import { initClock } from './clock.js';
import { initQuote } from './quotes.js';
import { initTodo, initReminders } from './todo.js';
import { initHabits } from './habits.js';
import { playIntro } from './intro.js';
import { initAppearance, initSettings } from './settings.js';
import { notify } from './notifications.js';

async function main() {
  // Appearance first: it sets the font before anything is measured or drawn.
  initAppearance();
  initTheme();
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
  initClock();
  initQuote();
  initTodo();
  initHabits();
  initReminders();
  playIntro();

  // The window can close faster than the typing debounce, so commit on the way out.
  window.addEventListener('beforeunload', () => { commitPending(); });
}

main();
