// Reads a time out of a to-do as it is typed, so one line is enough:
//
//   "Draft history essay intro 45m"            45 minutes, follows the plan
//   "Problem set 3 for 1h30 at 2pm"            90 minutes, starts at 14:00
//   "Seminar 10:30-11:15"                      pinned, 45 minutes
//   "Revise chapter 4 1.5 hours @ 16:00"       90 minutes, starts at 16:00
//
// Returns { title, minutes, startMinute } with the time words removed from the
// title. Anything not understood stays in the title. Pure, no DOM: the model
// checks import it under plain node.
//
// A bare hour with no am/pm ("at 3") is read as the afternoon when it is 1-7,
// since a to-do for 3am is far less likely than one for 3pm.

const MAX_MINUTES = 24 * 60;
const B = '(?<![\\w:.])';           // left word boundary that also refuses "12:" and "1."
const E = '(?![\\w:])';             // right boundary

function toMinute(h, m, ampm, guessPm) {
  h = Number(h); m = m ? Number(m) : 0;
  if (m > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    const pm = ampm.toLowerCase() === 'pm';
    h = (h % 12) + (pm ? 12 : 0);
  } else {
    if (h > 23) return null;
    if (guessPm && h >= 1 && h <= 7) h += 12;
  }
  return h * 60 + m;
}

export function parseEntry(text) {
  let rest = ' ' + String(text || '') + ' ';
  let minutes = null;
  let startMinute = null;
  const cut = (m) => { rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length); };

  // A range pins the start and gives the length: "2-3pm", "10:30-11:15", "2pm to 3:30pm".
  let m = new RegExp(B + '(?:from\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*(?:-|–|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?' + E, 'i').exec(rest);
  if (m && (m[2] || m[3] || m[5] || m[6])) {
    const endAmpm = m[6] || null;
    const s = toMinute(m[1], m[2], m[3] || endAmpm, !m[3] && !endAmpm);
    const e = toMinute(m[4], m[5], endAmpm, !endAmpm);
    if (s !== null && e !== null && e > s) { startMinute = s; minutes = e - s; cut(m); }
  }

  if (minutes === null) {
    // "1h30", "1 h 30 min", "1.5 hours", "2hrs"
    m = new RegExp(B + '(?:for\\s+)?~?(\\d+(?:\\.\\d+)?)\\s*(?:h|hr|hrs|hour|hours)(?:\\s*(\\d{1,2})\\s*(?:m|min|mins|minute|minutes)?)?' + E, 'i').exec(rest);
    if (m) {
      const total = Math.round(Number(m[1]) * 60) + (m[2] ? Number(m[2]) : 0);
      if (total >= 1 && total <= MAX_MINUTES) { minutes = total; cut(m); }
    }
  }
  if (minutes === null) {
    // "45m", "45 min", "for 20 minutes", "~30m"
    m = new RegExp(B + '(?:for\\s+)?~?(\\d+)\\s*(?:m|min|mins|minute|minutes)' + E, 'i').exec(rest);
    if (m) {
      const total = Number(m[1]);
      if (total >= 1 && total <= MAX_MINUTES) { minutes = total; cut(m); }
    }
  }

  if (startMinute === null) {
    // "at 2pm", "@ 14:30", "at 9"
    m = new RegExp(B + '(?:at|@)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?' + E, 'i').exec(rest);
    if (!m) m = new RegExp(B + '()(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)' + E, 'i').exec(rest);   // "3pm", "3:30pm"
    if (!m) m = new RegExp(B + '()(\\d{1,2}):(\\d{2})()' + E).exec(rest);                       // "14:30"
    if (m) {
      const [h, mm, ap] = m.length === 4 ? [m[1], m[2], m[3]] : [m[2], m[3], m[4]];
      const s = toMinute(h, mm, ap || null, m[0].trim().match(/^(at|@)/i) && !ap);
      if (s !== null) { startMinute = s; cut(m); }
    }
  }

  const title = rest.replace(/\s+/g, ' ').trim().replace(/\s+(for|at|@|from)$/i, '').trim();
  return { title, minutes, startMinute };
}

// The other way round, for the inline time editor: { minutes, startMinute } as
// text the parser will read back to the same values.
export function formatEntry(minutes, startMinute) {
  const parts = [];
  if (minutes !== null && minutes !== undefined) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    parts.push(h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm');
  }
  if (startMinute !== null && startMinute !== undefined) {
    const h = Math.floor(startMinute / 60), m = startMinute % 60;
    parts.push('at ' + h + ':' + String(m).padStart(2, '0'));
  }
  return parts.join(' ');
}
