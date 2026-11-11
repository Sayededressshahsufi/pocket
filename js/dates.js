/**
 * Date helpers. Dates are stored as local "YYYY-MM-DD" strings and months as
 * "YYYY-MM" so they sort lexically and never shift across time zones.
 */
const pad = (n) => String(n).padStart(2, "0");

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ymOf = (iso) => iso.slice(0, 7);
export const currentYM = (now = new Date()) => ymOf(toISO(now));

export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d || 1);
}

export function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toISO(parseISO(value)) === value; // rejects 2024-02-31 etc.
}

export function shiftYM(ym, months) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export const lastDayOf = (ym) => `${ym}-${pad(daysInMonth(ym))}`;

export function monthLabel(ym, style = "long") {
  const opts = style === "short" ? { month: "short" } : { month: "long", year: "numeric" };
  return parseISO(`${ym}-01`).toLocaleDateString(undefined, opts);
}

export function dayLabel(iso, now = new Date()) {
  if (iso === toISO(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (iso === toISO(y)) return "Yesterday";
  return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
