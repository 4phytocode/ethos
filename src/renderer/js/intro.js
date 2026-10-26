// Launch intro: a short boot sequence on black, then the big e with a ring drawn
// round it, and the e shrinks into the brand mark as the page takes over.
//
// Timeline (ms): boot lines 0-450, the boot text goes and the e fades in at 750,
// ring draws 1050-1950, ring fades 2250, e shrinks into the brand mark 2550-3350,
// the mark takes over and its dot blinks from 3350, intro removed at 3650. A key
// press or a click skips to the end. Reduced motion skips straight to the page.

const BOOT_LINES = [
  ['ETHOS BIOS  v0.1  (C) 2026', false],
  ['CHECKING VAULT ........................ ', 'OK'],
  ['LOADING JOURNAL ....................... ', 'OK'],
  ['LOADING SCHEDULE ...................... ', 'OK'],
];

const E_IN = 750;

export function playIntro() {
  const intro = document.getElementById('intro');
  const boot = document.getElementById('intro-boot');
  const introE = document.getElementById('intro-e');
  const brand = document.getElementById('brand-home');
  const brandLogo = document.getElementById('brand-logo');
  if (!intro) return;

  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  let done = false;

  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', finish);
    intro.removeEventListener('pointerdown', finish);
    brand.classList.remove('intro-hidden');
    intro.remove();
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();

  document.addEventListener('keydown', finish);
  intro.addEventListener('pointerdown', finish);

  // The boot text is written with textContent, never as markup.
  BOOT_LINES.forEach(([text, status], i) => {
    later(i * 150, () => {
      const line = document.createElement('p');
      line.textContent = text;
      if (status) {
        const ok = document.createElement('span');
        ok.className = 'ok';
        ok.textContent = status;
        line.appendChild(ok);
      }
      boot.appendChild(line);
    });
  });

  // Centre the e's visible ink (not its text box) on the ring's centre.
  // The intro svg draws the mark at 10x, so the glyph sits at x=130, baseline y=200.
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = 'bold 220px Helvetica, Arial, sans-serif';
  const m = ctx.measureText('e');
  const inkX = 130 + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const inkY = 200 + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
  introE.style.left = 'calc(50% - ' + inkX + 'px)';
  introE.style.top = 'calc(50% - ' + inkY + 'px)';

  // One class swaps the boot text for the e in the same frame, and starts the ring.
  later(E_IN, () => intro.classList.add('e-in'));

  later(E_IN + 1500, () => intro.classList.add('rings-out'));

  later(E_IN + 1800, () => {
    const from = introE.getBoundingClientRect();
    const to = brandLogo.getBoundingClientRect();
    const scale = to.width / from.width;
    introE.style.transition = 'transform 0.8s cubic-bezier(0.65, 0, 0.35, 1), opacity 0.3s ease';
    introE.style.transform =
      'translate(' + (to.left - from.left) + 'px, ' + (to.top - from.top) + 'px) scale(' + scale + ')';
    intro.classList.add('reveal');
  });

  later(E_IN + 2600, () => {
    brand.classList.remove('intro-hidden');
    introE.style.opacity = '0';
    brandLogo.classList.add('dot-blink');
    setTimeout(() => brandLogo.classList.remove('dot-blink'), 1000);
  });

  later(E_IN + 2900, finish);
}
