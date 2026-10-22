// Launch intro: a short boot sequence on black, then the logo moves into the
// brand mark and the page takes over.
//
// Timeline (ms): boot lines 0-720, logo flickers in 1000-1240, logo moves into
// the brand mark 1700-2400, the page takes over at 2400. A key press or a click
// skips to the end. Reduced motion skips straight to the page.

const BOOT_LINES = [
  ['ETHOS BIOS  v0.1  (C) 2026', false],
  ['CHECKING VAULT ........................ ', 'OK'],
  ['LOADING JOURNAL ....................... ', 'OK'],
  ['LOADING SCHEDULE ...................... ', 'OK'],
];

export function playIntro() {
  const intro = document.getElementById('intro');
  const boot = document.getElementById('intro-boot');
  const logo = document.getElementById('intro-logo');
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
    later(i * 180, () => {
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

  later(1000, () => intro.classList.add('logo-in'));

  later(1700, () => {
    // Move the logo's centre onto the brand mark's centre, shrinking it to match.
    const from = logo.getBoundingClientRect();
    const to = brandLogo.getBoundingClientRect();
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    const scale = to.width / from.width;
    logo.style.transform =
      'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(' + scale + ')';
    intro.classList.add('reveal');
  });

  later(2400, finish);
}
