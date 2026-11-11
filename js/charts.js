/**
 * Dependency-free SVG charts. Colors come from CSS classes so charts follow
 * the active theme automatically.
 */
const NS = "http://www.w3.org/2000/svg";

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const RING_C = 2 * Math.PI * 42;
export function setRing(circle, ratio) {
  circle.setAttribute("stroke-dasharray", RING_C.toFixed(2));
  circle.setAttribute("stroke-dashoffset", (RING_C * (1 - Math.min(1, Math.max(0, ratio)))).toFixed(2));
}

export function renderDonut(el, segments, { label, value }) {
  const cx = 60, cy = 60, r = 48, c = 2 * Math.PI * r;
  const total = segments.reduce((t, s) => t + s.value, 0);
  const gap = segments.length > 1 ? 2.5 : 0;
  const nodes = [svg("circle", { class: "donut__track", cx, cy, r })];
  let offset = 0;
  for (const seg of segments) {
    const len = total ? (seg.value / total) * c : 0;
    const dash = Math.max(0.01, len - gap);
    nodes.push(
      svg("circle", {
        class: "donut__seg", cx, cy, r, stroke: seg.color,
        "stroke-dasharray": `${dash} ${c - dash}`,
        "stroke-dashoffset": -offset,
        transform: `rotate(-90 ${cx} ${cy})`,
      }, svg("title", {}, seg.label)),
    );
    offset += len;
  }
  nodes.push(
    svg("text", { class: "donut__label", x: cx, y: cy - 7 }, label),
    svg("text", { class: "donut__value", x: cx, y: cy + 13 }, value),
  );
  el.replaceChildren(...nodes);
}

export function renderBars(el, bars, { budget, format }) {
  const W = 320, H = 180, top = 24, bottom = 24;
  const chartH = H - top - bottom;
  const max = Math.max(budget, ...bars.map((b) => b.value), 1) * 1.1;
  const step = W / bars.length;
  const bw = Math.min(30, step * 0.52);
  const y = (v) => top + chartH - (v / max) * chartH;
  const nodes = [];

  if (budget > 0) {
    const by = y(budget);
    nodes.push(
      svg("line", { class: "chart__ref", x1: 0, x2: W, y1: by, y2: by }),
      svg("text", { class: "chart__ref-label", x: W - 2, y: by - 5, "text-anchor": "end" }, "Budget"),
    );
  }

  bars.forEach((b, i) => {
    const bh = Math.max(3, (b.value / max) * chartH);
    const x = i * step + (step - bw) / 2;
    const cls = ["bar", b.current && "is-current", b.over && "is-over", !b.value && "is-empty"].filter(Boolean).join(" ");
    nodes.push(svg("rect", { class: cls, x, y: top + chartH - bh, width: bw, height: bh, rx: 7 }, svg("title", {}, b.title)));
    nodes.push(svg("text", { class: `chart__x${b.current ? " is-current" : ""}`, x: x + bw / 2, y: H - 6, "text-anchor": "middle" }, b.label));
    if (b.current && b.value) {
      nodes.push(svg("text", { class: "chart__value", x: x + bw / 2, y: top + chartH - bh - 7, "text-anchor": "middle" }, format(b.value)));
    }
  });
  el.replaceChildren(...nodes);
}

/** Cumulative spend vs an even-pace plan line across the month. */
export function renderBurn(el, { series, budget, dim, emptyText }) {
  const W = 320, H = 140, pl = 2, pr = 2, pt = 14, pb = 20;
  const last = series.length ? series[series.length - 1] : 0;
  const max = Math.max(budget, last, 1) * 1.12;
  const x = (d) => pl + (d / dim) * (W - pl - pr);
  const y = (v) => pt + (1 - v / max) * (H - pt - pb);
  const base = y(0);

  const nodes = [
    svg("defs", {},
      svg("linearGradient", { id: "burnFill", x1: 0, y1: 0, x2: 0, y2: 1 },
        svg("stop", { offset: 0, style: "stop-color:var(--accent);stop-opacity:.35" }),
        svg("stop", { offset: 1, style: "stop-color:var(--accent);stop-opacity:0" }),
      ),
    ),
    svg("line", { class: "chart__axis", x1: pl, x2: W - pr, y1: base, y2: base }),
  ];

  if (budget > 0) {
    nodes.push(
      svg("line", { class: "chart__ref", x1: pl, x2: W - pr, y1: y(budget), y2: y(budget) }),
      svg("line", { class: "chart__plan", x1: x(0), y1: base, x2: x(dim), y2: y(budget) }),
    );
  }

  if (series.length) {
    const pts = [[x(0), base], ...series.map((v, i) => [x(i + 1), y(v)])];
    const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
    const [ex, ey] = pts[pts.length - 1];
    const overPlan = budget > 0 && last > (budget * series.length) / dim;
    nodes.push(
      svg("path", { class: "burn__area", d: `${line}L${ex.toFixed(1)} ${base}Z` }),
      svg("path", { class: `burn__line${overPlan ? " is-over" : ""}`, d: line }),
      svg("circle", { class: `burn__dot${overPlan ? " is-over" : ""}`, cx: ex, cy: ey, r: 4.5 }),
    );
  } else if (emptyText) {
    nodes.push(svg("text", { class: "chart__empty", x: W / 2, y: H / 2, "text-anchor": "middle" }, emptyText));
  }

  const ticks = [1, Math.ceil(dim / 2), dim];
  ticks.forEach((d, i) => {
    const anchor = i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle";
    nodes.push(svg("text", { class: "chart__x", x: x(d - (i === 0 ? 1 : 0)), y: H - 4, "text-anchor": anchor }, String(d)));
  });
  el.replaceChildren(...nodes);
}
