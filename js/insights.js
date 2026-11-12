/**
 * Deeper insights. Pure functions over the budget state (cents everywhere),
 * kept separate from budget.js so the core engine stays small.
 * Weeks run Sunday to Saturday (US convention).
 */
import {
  addDays, balanceEstimate, billAmount, dayDiff, fixedCosts, incomeFor, itemsInMonth, monthPhase, sum, summarize,
} from "./budget.js";
import { currentYM, daysInMonth, parseISO, shiftYM, toISO } from "./dates.js";

const pad2 = (n) => String(n).padStart(2, "0");
const inRange = (list, from, to) => list.filter((r) => r.date >= from && r.date <= to);
const AUTO_NOTE = /balance check/i; // adjustments created by bank reconciliation

function topBy(map) {
  let best = null;
  for (const [id, amount] of map) if (!best || amount > best.amount) best = { id, amount };
  return best;
}

function totalsByCategory(items) {
  const m = new Map();
  for (const i of items) m.set(i.category, (m.get(i.category) || 0) + i.amount);
  return m;
}

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------
export function weekStart(iso) {
  const d = parseISO(iso);
  d.setDate(d.getDate() - d.getDay());
  return toISO(d);
}

/** This week so far, compared like-for-like with the same days last week. */
export function weeklySummary(state, now = new Date()) {
  const today = toISO(now);
  const start = weekStart(today);
  const prevStart = addDays(start, -7);
  const elapsed = dayDiff(today, start) + 1;
  const items = inRange(state.items, start, today);
  const prevSameDays = sum(inRange(state.items, prevStart, addDays(prevStart, elapsed - 1)));
  const biggest = items.reduce((b, i) => (!b || i.amount > b.amount ? i : b), null);
  return {
    start,
    end: addDays(start, 6),
    elapsed,
    spent: sum(items),
    prevSameDays,
    prevWeek: sum(inRange(state.items, prevStart, addDays(start, -1))),
    change: sum(items) - prevSameDays,
    paidIn: sum(inRange(state.paychecks, start, today)),
    count: items.length,
    topCategory: topBy(totalsByCategory(items)),
    biggest,
    hadLastWeek: inRange(state.items, prevStart, addDays(start, -1)).length > 0,
  };
}

// ---------------------------------------------------------------------------
// Spending calendar
// ---------------------------------------------------------------------------
/** Per-day totals with a 0-4 heat level relative to an even daily budget. */
export function spendingCalendar(state, ym, now = new Date()) {
  const dim = daysInMonth(ym);
  const today = toISO(now);
  const totals = new Array(dim).fill(0);
  for (const i of itemsInMonth(state.items, ym)) totals[Number(i.date.slice(8, 10)) - 1] += i.amount;
  const { budget } = summarize(state, ym, now);
  const spentDays = totals.filter(Boolean);
  const ref = budget > 0 ? budget / dim : spentDays.length ? sum(spentDays, (v) => v) / spentDays.length : 1;
  const level = (v) => (!v ? 0 : v <= ref * 0.5 ? 1 : v <= ref ? 2 : v <= ref * 2 ? 3 : 4);
  const days = totals.map((amount, i) => {
    const date = `${ym}-${pad2(i + 1)}`;
    return { date, day: i + 1, amount, level: level(amount), future: date > today, today: date === today };
  });
  const lived = days.filter((d) => !d.future);
  const biggest = lived.reduce((b, d) => (!b || d.amount > b.amount ? d : b), null);
  return {
    days,
    leadingBlanks: parseISO(`${ym}-01`).getDay(),
    dailyTarget: Math.round(ref),
    noSpendDays: lived.filter((d) => !d.amount).length,
    overDays: lived.filter((d) => d.amount > ref).length,
    biggest: biggest?.amount ? biggest : null,
  };
}

// ---------------------------------------------------------------------------
// Year in review
// ---------------------------------------------------------------------------
/**
 * The month someone started tracking is usually partial (a few paychecks
 * logged, but every bill counted), which would make it look like a terrible
 * month. If tracking began after the 7th, that month is excluded from
 * savings totals, best/worst and averages.
 */
function partialStartMonth(state) {
  const first = [...state.items, ...state.paychecks].reduce((m, r) => (!m || r.date < m ? r.date : m), null);
  return first && Number(first.slice(8, 10)) > 7 ? first.slice(0, 7) : null;
}

export function yearView(state, year, now = new Date()) {
  const partialYM = partialStartMonth(state);
  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad2(i + 1)}`;
    const phase = monthPhase(ym, now);
    const spent = sum(itemsInMonth(state.items, ym));
    const hasData = spent > 0 || itemsInMonth(state.paychecks, ym).length > 0;
    if (phase === "future" || !hasData) return { ym, phase, hasData: false, spent: 0, saved: 0 };
    const income = incomeFor(state, ym, now);
    const fixed = fixedCosts(state, ym);
    const saved = phase === "current" ? summarize(state, ym, now).projectedSavings : income - fixed - spent;
    return { ym, phase, hasData: true, partial: ym === partialYM && phase === "past", spent, income, fixed, saved };
  });
  const closed = months.filter((m) => m.hasData && m.phase === "past" && !m.partial);
  const pick = (cmp) => closed.reduce((b, m) => (!b || cmp(m, b) ? m : b), null);
  return {
    year,
    months,
    totalSpent: sum(months, (m) => m.spent),
    totalSaved: sum(closed, (m) => m.saved),
    best: pick((m, b) => m.saved > b.saved),
    worst: pick((m, b) => m.saved < b.saved),
    tracked: months.filter((m) => m.hasData).length,
  };
}

// ---------------------------------------------------------------------------
// Can I afford this?
// ---------------------------------------------------------------------------
/** @returns verdict "yes" | "tight" | "no" | "unknown" with the numbers behind it */
export function canAfford(state, price, now = new Date()) {
  const s = summarize(state, currentYM(now), now);
  const bank = balanceEstimate(state, now);
  const afterToday = s.leftToday - price;
  const afterMonth = s.left - price;
  const days = s.dailyAllowance > 0 ? price / s.dailyAllowance : Infinity;
  const newDaily = s.daysLeft > 0 ? Math.max(0, Math.floor((s.left + s.spentToday - price) / s.daysLeft)) : 0;
  const bankAfter = bank ? bank.afterBills - price : null;
  const base = {
    price, afterToday, afterMonth, newDaily, bankAfter,
    leftToday: s.leftToday, leftMonth: s.left, daily: s.dailyAllowance,
    days: Number.isFinite(days) ? Math.round(days * 10) / 10 : null,
    savingsHit: Math.max(0, -afterMonth),
  };
  if (!s.income) return { ...base, verdict: "unknown", reason: "no-plan" };
  if (bankAfter != null && bankAfter < 0) return { ...base, verdict: "no", reason: "bank" };
  if (afterMonth < 0) return { ...base, verdict: "no", reason: "savings" };
  if (afterToday >= 0) return { ...base, verdict: "yes", reason: "today" };
  return { ...base, verdict: "tight", reason: "days" };
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------
/** Average spend per weekday over the last `days` days (or since you started). */
export function byWeekday(state, now = new Date(), days = 90) {
  const today = toISO(now);
  const first = state.items.reduce((m, i) => (i.date < m ? i.date : m), today);
  const from = [addDays(today, -(days - 1)), first].sort()[1];
  const items = inRange(state.items, from, today);
  const totals = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (let d = from; d <= today; d = addDays(d, 1)) counts[parseISO(d).getDay()]++;
  for (const i of items) totals[parseISO(i.date).getDay()] += i.amount;
  const avg = totals.map((t, i) => (counts[i] ? Math.round(t / counts[i]) : 0));
  const top = avg.indexOf(Math.max(...avg));
  return { avg, top, enough: items.length >= 5 && dayDiff(today, from) >= 13 };
}

export function topPlaces(state, ym, limit = 5) {
  const groups = new Map();
  for (const i of itemsInMonth(state.items, ym)) {
    const label = i.note.trim().replace(/\s+/g, " ");
    if (!label || AUTO_NOTE.test(label)) continue;
    const key = label.toLowerCase();
    const g = groups.get(key) ?? { name: label, count: 0, total: 0, category: i.category };
    g.count++;
    g.total += i.amount;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || b.count - a.count).slice(0, limit);
}

export function smallPurchases(state, ym, threshold = 1000) {
  const all = itemsInMonth(state.items, ym);
  const small = all.filter((i) => i.amount < threshold && !AUTO_NOTE.test(i.note));
  const total = sum(small);
  return { threshold, count: small.length, total, share: sum(all) ? total / sum(all) : 0, yearly: total * 12 };
}

// ---------------------------------------------------------------------------
// Savings forecast
// ---------------------------------------------------------------------------
export function savingsForecast(state, now = new Date()) {
  const year = now.getFullYear();
  const yv = yearView(state, year, now);
  const closed = yv.months.filter((m) => m.hasData && m.phase === "past" && !m.partial);
  const current = yv.months.find((m) => m.phase === "current");
  const thisMonth = current?.hasData ? current.saved : summarize(state, currentYM(now), now).projectedSavings;
  const avg = closed.length ? Math.round(sum(closed, (m) => m.saved) / closed.length) : thisMonth;
  const monthsAfterThis = 11 - now.getMonth();
  const { goal } = state.settings;
  return {
    year,
    basis: closed.length ? "history" : "this-month",
    months: closed.length,
    avgMonthly: avg,
    savedSoFar: yv.totalSaved,
    yearEnd: yv.totalSaved + thisMonth + avg * monthsAfterThis,
    next12: avg * 12,
    goal,
    vsGoal: goal ? avg - goal : null,
  };
}

// ---------------------------------------------------------------------------
// Bills vs last month
// ---------------------------------------------------------------------------
export function billComparisons(state, ym, now = new Date()) {
  const prev = shiftYM(ym, -1);
  const lastYear = shiftYM(ym, -12);
  const today = toISO(now);
  const rows = state.recurring.map((b) => {
    const current = billAmount(b, ym);
    const previous = billAmount(b, prev);
    const estimated = b.variable && !b.actuals?.[ym];
    const prevEstimated = b.variable && !b.actuals?.[prev];
    const due = `${ym}-${pad2(Math.min(b.day, daysInMonth(ym)))}`;
    return {
      id: b.id, name: b.name, category: b.category, day: b.day, variable: b.variable,
      due, upcoming: due > today,
      current, previous, delta: current - previous,
      pct: previous ? (current - previous) / previous : 0,
      estimated, prevEstimated,
      comparable: !estimated && !prevEstimated,
      lastYear: b.actuals?.[lastYear] ?? null,
    };
  }).sort((a, b) => b.current - a.current);
  const firm = rows.filter((r) => r.comparable);
  return {
    rows,
    total: sum(rows, (r) => r.current),
    previousTotal: sum(rows, (r) => r.previous),
    delta: sum(rows, (r) => r.delta),
    firmDelta: sum(firm, (r) => r.delta),
    pending: rows.filter((r) => r.estimated).length,
  };
}
