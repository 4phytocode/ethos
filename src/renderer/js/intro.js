// Launch intro.
//
// Timeline (ms): e fades in 0-400, ring draws 300-1200, ring fades 1500,
// e shrinks into the logo 1800-2600, logo takes over 2600, dot blinks 2600-3600.

export function playIntro() {
  const intro = document.getElementById('intro');
  const introE = document.getElementById('intro-e');
  const brand = document.getElementById('brand-home');
  const brandLogo = document.getElementById('brand-logo');

  function finish() {
    brand.classList.remove('intro-hidden');
    if (intro) intro.remove();
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();

  // Centre the e's visible ink (not its text box) on the ring's centre.
  // The intro svg draws the logo at 10x, so the glyph sits at x=130, baseline y=200.
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = 'bold 220px Helvetica, Arial, sans-serif';
  const m = ctx.measureText('e');
  const inkX = 130 + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const inkY = 200 + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
  introE.style.left = 'calc(50% - ' + inkX + 'px)';
  introE.style.top = 'calc(50% - ' + inkY + 'px)';

  setTimeout(() => intro.classList.add('rings-out'), 1500);

  setTimeout(() => {
    const from = introE.getBoundingClientRect();
    const to = brandLogo.getBoundingClientRect();
    const scale = to.width / from.width;
    introE.style.transition = 'transform 0.8s cubic-bezier(0.65, 0, 0.35, 1), opacity 0.3s ease';
    introE.style.transform =
      'translate(' + (to.left - from.left) + 'px, ' + (to.top - from.top) + 'px) scale(' + scale + ')';
    intro.classList.add('reveal');
  }, 1800);

  setTimeout(() => {
    brand.classList.remove('intro-hidden');
    introE.style.opacity = '0';
    brandLogo.classList.add('dot-blink');
    setTimeout(() => brandLogo.classList.remove('dot-blink'), 1000);
  }, 2600);

  setTimeout(finish, 2900);
}
