// Delivers to-do reminders.
//
// This runs in the main process on purpose. The plan lives in the store, the
// store lives here, and the renderer can be closed or hidden — a timer in the
// page would stop mattering exactly when it is needed.
//
// Delivery order is the point of the design: the in-app toast always goes
// first, because that is the product's own voice. An operating-system
// notification is added only when the window is not in front of the user, since
// a banner on top of the window they are already looking at is just noise.
//
// Nothing here imports electron. The three things that touch the outside world
// are passed in, so the whole schedule can be exercised in plain node.

const TICK_MS = 15000;

class Reminders {
  // send(todo)      deliver the in-app toast to the renderer
  // isInFront()     is the window visible and focused right now
  // osNotify(todo)  raise a system notification
  // onIdle()        called when nothing is left to remind about
  constructor({ store, send, isInFront, osNotify, onIdle }) {
    this.store = store;
    this.send = send;
    this.isInFront = isInFront;
    this.osNotify = osNotify;
    this.onIdle = onIdle || (() => {});
    this.timer = null;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // Returns the todos it delivered, which is what the tests look at.
  tick(now = Date.now()) {
    this.store.ensurePlan(now);

    const delivered = [];
    for (const todo of this.store.dueReminders(now)) {
      // Marked first. If delivery throws, the reminder is lost rather than
      // repeated every 15 seconds for the rest of the session.
      this.store.markNotified(todo.id);
      try {
        this.send(todo);
        if (!this.isInFront()) this.osNotify(todo);
      } catch (err) {
        console.error('reminder delivery failed:', err.message);
      }
      delivered.push(todo);
    }

    if (!this.store.hasUpcomingReminders(now)) this.onIdle();
    return delivered;
  }
}

module.exports = { Reminders, TICK_MS };
