// Rings the Timer page's timers.
//
// The page draws the countdown, but the moment a timer runs out is kept here,
// for the same reason as reminders.js: a timer in the page would stop mattering
// exactly when the window is hidden. Holding the deadlines here also lets a
// running timer keep Ethos in the tray when the window is closed.
//
// The page arms a timer with the wall-clock time it ends, and disarms it on
// pause, reset or delete. Nothing is written to disk: the page keeps its own
// list (it is per-machine, like Settings) and arms again after a restart.
//
// Nothing here imports electron. `ring` is passed in, so the whole thing can be
// exercised in plain node.

const { ValidationError } = require('./schema');

const MAX_TIMERS = 50;
// 99:59:59 is the longest the page can set; the slack covers clock skew.
const MAX_AHEAD_MS = 100 * 60 * 60 * 1000;
const MAX_LABEL = 40;
// A deadline is checked at least this often, so a machine that slept, or a
// clock that moved, is caught within a minute rather than trusted to setTimeout.
const MAX_WAIT_MS = 60000;
const ID = /^[a-z0-9]{1,32}$/;

function fail(what) { throw new ValidationError(what); }

class Timers {
  // ring({ id, label, notify })  a timer ran out
  constructor({ ring, now = Date.now }) {
    this.ring = ring;
    this.now = now;
    this.armed = new Map();   // id -> { id, endsAt, label, notify }
    this.handle = null;
  }

  arm(id, input, now = this.now()) {
    if (typeof id !== 'string' || !ID.test(id)) fail('That timer id is not valid.');
    if (typeof input !== 'object' || input === null || Array.isArray(input)) fail('That timer is not valid.');
    const { endsAt, label, notify } = input;
    if (!Number.isFinite(endsAt) || endsAt > now + MAX_AHEAD_MS) fail('A timer can run for up to 99 hours.');
    if (typeof label !== 'string' || label.length > MAX_LABEL) fail('A timer name is up to ' + MAX_LABEL + ' characters.');
    if (typeof notify !== 'boolean') fail('That timer is not valid.');
    if (!this.armed.has(id) && this.armed.size >= MAX_TIMERS) fail('Too many timers are running.');
    this.armed.set(id, { id, endsAt, label, notify });
    this.schedule(now);
  }

  disarm(id) {
    if (typeof id !== 'string' || !ID.test(id)) fail('That timer id is not valid.');
    this.armed.delete(id);
    this.schedule();
  }

  hasArmed() { return this.armed.size > 0; }

  // Forgets every timer. Called when the page loads, which arms its running
  // timers again, so a timer the page no longer has cannot ring.
  clear() {
    this.armed.clear();
    this.schedule();
  }

  stop() {
    if (this.handle) { clearTimeout(this.handle); this.handle = null; }
  }

  // Rings every timer that is due, once. Returns them, which is what the tests
  // look at.
  tick(now = this.now()) {
    const due = [...this.armed.values()].filter(t => t.endsAt <= now);
    for (const t of due) {
      // Forgotten first: if ringing throws, it is not rung again every minute.
      this.armed.delete(t.id);
      try {
        this.ring({ id: t.id, label: t.label, notify: t.notify });
      } catch (err) {
        console.error('timer ring failed:', err.message);
      }
    }
    this.schedule(now);
    return due;
  }

  // One timeout, for the next deadline (or a minute, whichever is sooner).
  schedule(now = this.now()) {
    this.stop();
    if (!this.armed.size) return;
    let next = Infinity;
    for (const t of this.armed.values()) next = Math.min(next, t.endsAt);
    const wait = Math.max(0, Math.min(next - now, MAX_WAIT_MS));
    this.handle = setTimeout(() => this.tick(), wait);
  }
}

module.exports = { Timers, MAX_TIMERS };
