/**
 * Confetti on a full-screen canvas. No dependencies. Skips itself when the
 * device asks for reduced motion, and cleans up after ~2.6 seconds.
 * Returns true if a burst was started.
 */
const COLORS = ["#34d399", "#a3e635", "#fbbf24", "#ffffff", "#60a5fa", "#f472b6"];
let active = null;

export function confetti({ count = 150, duration = 2600 } = {}) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  active?.stop();

  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  document.body.append(canvas);

  const pieces = Array.from({ length: count }, () => ({
    x: w * (0.1 + Math.random() * 0.8),
    y: -20 - Math.random() * h * 0.35,
    vx: (Math.random() - 0.5) * 3.2,
    vy: 2 + Math.random() * 4,
    size: 6 + Math.random() * 6,
    spin: Math.random() * Math.PI * 2,
    spinSpeed: (Math.random() - 0.5) * 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() < 0.3,
  }));

  const start = performance.now();
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    canvas.remove();
    if (active?.stop === stop) active = null;
  };
  active = { stop };

  const frame = (now) => {
    const t = now - start;
    if (t > duration) return stop();
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = t > duration * 0.75 ? Math.max(0, 1 - (t - duration * 0.75) / (duration * 0.25)) : 1;
    for (const p of pieces) {
      p.vy += 0.09;
      p.vx *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      p.spin += p.spinSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return true;
}
