// A shared, under-damped spring (PLAN-retro-demo.md, 7.1). Moved here from
// schedule.js so every surface that should move the same way can use it.
//
// It trails its target, overshoots a little and settles. The default paint is
// the schedule's ink: a skew from velocity, a thinning, and a box. A surface
// that wants another look passes its own paint function as the second argument.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Spring {
  constructor(node, paint = inkPaint) {
    this.node = node;
    this.customPaint = paint;
    this.cur = null;
    this.tgt = null;
    this.vel = { x: 0, y: 0, w: 0, h: 0 };
    this.raf = 0;
  }

  to(t) {
    this.tgt = t;
    if (!this.cur || reducedMotion.matches) this.cur = { ...t };
    if (!this.raf) this.raf = requestAnimationFrame(() => this.step());
  }

  step() {
    this.raf = 0;
    let moving = false;
    for (const k of Object.keys(this.tgt)) {
      const v = this.vel[k] * 0.62 + (this.tgt[k] - this.cur[k]) * 0.22;
      this.vel[k] = v;
      this.cur[k] += v;
      if (Math.abs(v) < 0.05 && Math.abs(this.tgt[k] - this.cur[k]) < 0.05) {
        this.cur[k] = this.tgt[k];
        this.vel[k] = 0;
      } else {
        moving = true;
      }
    }
    this.paint();
    if (moving) this.raf = requestAnimationFrame(() => this.step());
  }

  paint() { this.customPaint(this); }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
}

// The ink: leans with its speed and thins when it moves vertically.
function inkPaint(spring) {
  const { x, y, w, h } = spring.cur;
  const lean = clamp(spring.vel.x * 0.35, -9, 9);
  const thin = clamp(Math.abs(spring.vel.y) * 0.004, 0, 0.06);
  const s = spring.node.style;
  s.transform = 'translate(' + x + 'px, ' + y + 'px) skewX(' + (-lean) + 'deg) scaleX(' + (1 - thin) + ')';
  if (w !== undefined) s.width = w + 'px';
  if (h !== undefined) s.height = h + 'px';
}
