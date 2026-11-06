// The shut-down outro: the launch intro (js/intro.js) played backwards.
//
//   0-300      black fades in over the page, with the e sitting where the brand mark is
//   300-1100   the e grows out of the brand mark to the centre
//   1100-1400  the ring fades in, fully drawn
//   1400-2300  the ring un-draws
//   2300       in one frame the e and ring go and the boot lines appear
//   2300-       the lines are taken away from the bottom up; the vault line shows OK
//              only once the data is safely written
//   then       black, the dot blinks twice
//
// playOutro(flushed) takes the promise of the final write. It resolves
// { ok: true } when the show is over and the write succeeded, and { ok: false }
// when the write failed: the caller must then NOT quit. A key press or a click
// skips the show but never the wait for the write. Reduced motion has no show.

import { placeE } from './intro.js';

const LINES = [
  ['ETHOS BIOS  v0.1  (C) 2026', false],
  ['SAVING VAULT .......................... ', 'wait'],
  ['CLOSING JOURNAL ....................... ', 'OK'],
  ['CLOSING SCHEDULE ...................... ', 'OK'],
];

export function playOutro(flushed) {
  const tpl = document.getElementById('outro-tpl');
  if (!tpl) return flushed.then(() => ({ ok: true }), () => ({ ok: false }));
  const outro = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(outro);
  const boot = outro.querySelector('#outro-boot');
  const e = outro.querySelector('#outro-e');
  const dot = outro.querySelector('#outro-dot');
  const brandLogo = document.getElementById('brand-logo');

  let skipped = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const skip = () => { skipped = true; wake(); };
  let wake = () => {};
  document.addEventListener('keydown', skip, true);
  outro.addEventListener('pointerdown', skip);
  // A step that ends early when skipped.
  const sleep = (ms) => new Promise((resolve) => {
    if (skipped) return resolve();
    const t = setTimeout(resolve, ms);
    wake = () => { clearTimeout(t); resolve(); };
  });

  let result = null;
  const settled = flushed.then(() => { result = { ok: true }; }, () => { result = { ok: false }; });

  async function show() {
    if (skipped) return;
    placeE(e);
    // The e starts exactly over the brand mark, so the page seems to turn into it.
    e.style.transition = 'none';
    const from = e.getBoundingClientRect();
    const to = brandLogo.getBoundingClientRect();
    const scale = to.width / from.width;
    e.style.transform = 'translate(' + (to.left - from.left) + 'px, ' + (to.top - from.top) + 'px) scale(' + scale + ')';
    void outro.offsetWidth;
    outro.classList.add('show');
    await sleep(300);
    if (skipped) return;
    e.style.transition = 'transform 0.8s cubic-bezier(0.65, 0, 0.35, 1)';
    e.style.transform = 'translate(0px, 0px) scale(1)';
    await sleep(800);
    if (skipped) return;
    outro.classList.add('ring-in');
    await sleep(300);
    if (skipped) return;
    outro.classList.add('ring-undraw');
    await sleep(900);
    if (skipped) return;

    // The e and ring go and the boot text comes, in one frame.
    outro.classList.add('boot');
    const rows = LINES.map(([text, status]) => {
      const p = document.createElement('p');
      p.textContent = text;
      let span = null;
      if (status) {
        span = document.createElement('span');
        span.className = status === 'OK' ? 'ok' : '';
        span.textContent = status === 'wait' ? '...' : status;
        p.appendChild(span);
      }
      boot.appendChild(p);
      return { p, span, status };
    });
    await sleep(500);
    // Bottom up: the two that are already done go first.
    for (const i of [3, 2]) { rows[i].p.remove(); await sleep(170); }
    // The vault line waits for the write.
    await settled;
    const vault = rows[1];
    vault.span.className = result.ok ? 'ok' : 'fail';
    vault.span.textContent = result.ok ? 'OK' : 'FAIL';
    if (!result.ok) return;
    await sleep(400);
    vault.p.remove();
    await sleep(170);
    rows[0].p.remove();
    await sleep(250);
    dot.classList.add('blink');
    await sleep(950);
  }

  return show().then(() => settled).then(() => {
    document.removeEventListener('keydown', skip, true);
    if (!result.ok) {
      // Nothing was lost yet: put the app back and let the caller ask what to do.
      outro.remove();
    }
    return result;
  });
}

// Removes the outro (after a failed write, or in the tests).
export function clearOutro() {
  const o = document.getElementById('outro');
  if (o) o.remove();
}
