/**
 * Budget engine. Pure functions only: no DOM, no storage. All amounts in cents.
 *
 * Model:
 *   flexible budget = income - fixed bills - savings goal
 *   left to spend   = flexible budget - logged spending this month
 */
import { getCategory } from "./categories.js";
import { currentYM, daysInMonth, parseISO, shiftYM, toISO, ymOf } from "./dates.js";

export const sum = (list, pick = (x) => x.amount) => list.reduce((t, x) => t + pick(x), 0);
export const itemsInMonth = (items, ym) => items.filter((i) => i.date.startsWith(`${ym}-`));
/** A bill's cost in a given month: the entered actual if any, else its usual/estimated amount. */
export const billAmount = (bill, ym) => (ym && bill.actuals?.[ym]) || bill.amount;
export const fixedCosts = (state, ym) => sum(state.recurring, (b) => billAmount(b, ym));
export const flexibleBudget = (state, ym, now = new Date()) =>
  Math.max(0, incomeFor(state, ym, now) - fixedCosts(state, ym) - state.settings.goal);

// ---------------------------------------------------------------------------
// Pay schedule & income
// ---------------------------------------------------------------------------
const DAY_MS = 864e5;
const pad2 = (n) => String(n).padStart(2, "0");
export const dayDiff = (aISO, bISO) => Math.round((parseISO(aISO) - parseISO(bISO)) / DAY_MS);
export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
const billDueISO = (bill, ym) => `${ym}-${pad2(Math.min(bill.day, daysInMonth(ym)))}`;

/** Most recent date (on or before `now`) that falls on `weekday` (0 = Sunday). */
export function lastWeekday(weekday, now = new Date()) {
  const d = new Date(now);
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return toISO(d);
}

export function isPayday(pay, iso) {
  if (pay.frequency === "monthly") return false;
  if (pay.frequency === "biweekly" && pay.anchor) return ((dayDiff(iso, pay.anchor) % 14) + 14) % 14 === 0;
  return parseISO(iso).getDay() === pay.weekday;
}

export function paydaysIn(pay, ym) {
  const out = [];
  for (let d = 1; d <= daysInMonth(ym); d++) {
    const iso = `${ym}-${pad2(d)}`;
    if (isPayday(pay, iso)) out.push(iso);
  }
  return out;
}

export function hasIncomePlan(state) {
  const { pay, income } = state.settings;
  return pay.frequency === "monthly" ? income > 0 : pay.amount > 0;
}

/**
 * Income for a month. Monthly earners use their fixed income. Weekly and
 * biweekly earners get: paychecks logged so far + a typical paycheck for each
 * payday still to come. Closed months count only what was actually logged.
 */
export function incomeFor(state, ym, now = new Date()) {
  const { pay, income } = state.settings;
  if (pay.frequency === "monthly") return income;
  const logged = itemsInMonth(state.paychecks, ym);
  const expected = paydaysIn(pay, ym).length;
  if (monthPhase(ym, now) === "past") return logged.length ? sum(logged) : pay.amount * expected;
  return sum(logged) + pay.amount * Math.max(0, expected - logged.length);
}

/** A recent payday (last 6 days) with no paycheck logged around it, or null. */
export function paydayPending(state, now = new Date()) {
  const { pay } = state.settings;
  if (pay.frequency === "monthly" || !pay.amount) return null;
  const today = toISO(now);
  for (let back = 0; back < 6; back++) {
    const iso = addDays(today, -back);
    if (!isPayday(pay, iso)) continue;
    const from = addDays(iso, -3);
    return state.paychecks.some((p) => p.date >= from && p.date <= today) ? null : iso;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bank balance tracking
// ---------------------------------------------------------------------------
export function latestBalance(state) {
  return [...state.balances].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at).at(-1) ?? null;
}

/**
 * Running balance: last confirmed balance + paychecks - spending - bills that
 * came due since then. Same-day records count only if logged after the check.
 */
export function balanceEstimate(state, now = new Date()) {
  const last = latestBalance(state);
  if (!last) return null;
  const today = toISO(now);
  const since = (r) => r.date <= today && (r.date > last.date || (r.date === last.date && r.createdAt > last.at));
  const paidIn = sum(state.paychecks.filter(since));
  const spent = sum(state.items.filter(since));
  let bills = 0;
  let upcoming = 0;
  for (let ym = ymOf(last.date); ym <= ymOf(today); ym = shiftYM(ym, 1)) {
    for (const b of state.recurring) {
      const due = billDueISO(b, ym);
      if (due > last.date && due <= today) bills += billAmount(b, ym);
      else if (ym === ymOf(today) && due > today) upcoming += billAmount(b, ym);
    }
  }
  const estimate = last.amount + paidIn - spent - bills;
  return { last, estimate, paidIn, spent, bills, upcoming, afterBills: estimate - upcoming, daysSince: dayDiff(today, last.date) };
}

/** Does the bank's number agree with ours? Small gaps (pending charges, rounding) are tolerated. */
export function reconcile(expected, actual) {
  const diff = actual - expected;
  const tolerance = Math.max(1000, Math.round(Math.abs(expected) * 0.01));
  return { diff, matches: Math.abs(diff) <= tolerance };
}

export function needsBalanceCheck(state, now = new Date(), everyDays = 7) {
  const last = latestBalance(state);
  return !last || dayDiff(toISO(now), last.date) >= everyDays;
}

/** Variable bills that have come due in `ym` but have no amount entered yet. */
export function billsDue(state, ym, now = new Date()) {
  const phase = monthPhase(ym, now);
  if (phase === "future") return [];
  const dim = daysInMonth(ym);
  return state.recurring
    .filter((b) => b.variable && !b.actuals?.[ym])
    .filter((b) => phase === "past" || now.getDate() >= Math.min(b.day, dim))
    .sort((a, b) => a.day - b.day);
}

/** Last `count` months of a bill ending at `ym`, plus stats over entered months. */
export function billHistory(bill, ym, count = 6) {
  const months = Array.from({ length: count }, (_, k) => {
    const m = shiftYM(ym, k - count + 1);
    return { ym: m, amount: bill.actuals?.[m] ?? null };
  });
  const entered = Object.values(bill.actuals ?? {});
  const known = months.filter((m) => m.amount != null);
  const peak = known.reduce((best, m) => (!best || m.amount > best.amount ? m : best), null);
  return {
    months,
    average: entered.length ? Math.round(sum(entered, (v) => v) / entered.length) : null,
    peak,
  };
}

export function monthPhase(ym, now = new Date()) {
  const cur = currentYM(now);
  return ym === cur ? "current" : ym < cur ? "past" : "future";
}

function byCategory(items, limits, total) {
  const totals = new Map();
  for (const i of items) totals.set(i.category, (totals.get(i.category) || 0) + i.amount);
  for (const id of Object.keys(limits)) if (!totals.has(id)) totals.set(id, 0);
  return [...totals]
    .map(([id, amount]) => ({ id, amount, share: total ? amount / total : 0, limit: limits[id] || 0 }))
    .sort((a, b) => b.amount - a.amount || (b.limit - a.limit));
}

function cumulativeByDay(items, dim, upto) {
  const perDay = new Array(dim).fill(0);
  for (const i of items) {
    const d = Number(i.date.slice(8, 10));
    if (d >= 1 && d <= dim) perDay[d - 1] += i.amount;
  }
  const out = [];
  let running = 0;
  for (let d = 0; d < upto; d++) out.push((running += perDay[d]));
  return out;
}

export function summarize(state, ym, now = new Date()) {
  const { goal } = state.settings;
  const income = incomeFor(state, ym, now);
  const items = itemsInMonth(state.items, ym);
  const spent = sum(items);
  const fixed = fixedCosts(state, ym);
  const budget = flexibleBudget(state, ym, now);
  const left = budget - spent;
  const dim = daysInMonth(ym);
  const phase = monthPhase(ym, now);

  const elapsed = phase === "current" ? now.getDate() : phase === "past" ? dim : 0;
  const daysLeft = phase === "current" ? dim - now.getDate() + 1 : phase === "future" ? dim : 0;
  const today = toISO(now);
  const spentToday = phase === "current" ? sum(items.filter((i) => i.date === today)) : 0;

  // Allowance is fixed at the start of the day so spending today doesn't
  // silently shrink tomorrow's number until tomorrow.
  const dailyAllowance = daysLeft > 0 ? Math.max(0, Math.floor((left + spentToday) / daysLeft)) : 0;
  const idealSpend = Math.round((budget * elapsed) / dim);

  let projectedSpend;
  if (phase === "past") projectedSpend = spent;
  else if (phase === "future") projectedSpend = budget;
  else if (elapsed >= 5 && items.length) projectedSpend = Math.max(spent, Math.round((spent / elapsed) * dim));
  else projectedSpend = Math.max(spent, budget); // too early to extrapolate

  return {
    ym, phase, income, goal, fixed, budget, spent, left, dim, elapsed, daysLeft,
    spentToday,
    dailyAllowance,
    leftToday: dailyAllowance - spentToday,
    idealSpend,
    projectedSpend,
    projectedSavings: income - fixed - projectedSpend,
    count: items.length,
    categories: byCategory(items, state.limits, spent),
    daily: cumulativeByDay(items, dim, elapsed),
  };
}

export function history(state, ym, count = 6, now = new Date()) {
  return Array.from({ length: count }, (_, k) => {
    const m = shiftYM(ym, k - count + 1);
    const budget = flexibleBudget(state, m, now);
    const spent = sum(itemsInMonth(state.items, m));
    return { ym: m, spent, budget, over: budget > 0 && spent > budget };
  });
}

export function compareMonths(state, ym) {
  const cur = new Map();
  const prev = new Map();
  const prevYM = shiftYM(ym, -1);
  for (const i of state.items) {
    const m = ymOf(i.date);
    const target = m === ym ? cur : m === prevYM ? prev : null;
    if (target) target.set(i.category, (target.get(i.category) || 0) + i.amount);
  }
  const ids = new Set([...cur.keys(), ...prev.keys()]);
  return [...ids]
    .map((id) => ({ id, current: cur.get(id) || 0, previous: prev.get(id) || 0 }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous);
}

export function lifetimeStats(state, now = new Date()) {
  const cur = currentYM(now);
  const { goal } = state.settings;
  const income = hasIncomePlan(state);
  const saved = (m, spent) => incomeFor(state, m, now) - fixedCosts(state, m) - spent;
  const totals = new Map();
  for (const i of state.items) {
    const m = ymOf(i.date);
    if (m <= cur) totals.set(m, (totals.get(m) || 0) + i.amount);
  }
  const closed = [...totals].filter(([m]) => m < cur);
  const basis = closed.length ? closed : [...totals];
  const avgSpend = basis.length ? Math.round(sum(basis, ([, v]) => v) / basis.length) : 0;
  const totalSaved = income ? sum(closed, ([m, v]) => Math.max(0, saved(m, v))) : 0;

  let streak = 0;
  if (income && goal > 0) {
    for (let m = shiftYM(cur, -1); totals.has(m) && saved(m, totals.get(m)) >= goal; m = shiftYM(m, -1)) {
      streak++;
    }
  }

  const byCat = new Map();
  for (const i of state.items) byCat.set(i.category, (byCat.get(i.category) || 0) + i.amount);
  const top = [...byCat].sort((a, b) => b[1] - a[1])[0];

  return { avgSpend, totalSaved, streak, topCategory: top ? top[0] : null, months: totals.size };
}

/**
 * Ranked, human-readable coaching. Most urgent first.
 * @returns {{tone: "good"|"warn"|"bad"|"info", title: string, text: string, action?: string}[]}
 */
export function buildInsights(state, ym, now, money) {
  const s = summarize(state, ym, now);
  const name = (id) => getCategory(id).name;
  const out = [];

  if (!s.income) {
    return [{
      tone: "info", action: "plan", title: "Set up your plan",
      text: "Add your pay and a savings goal to unlock your daily allowance.",
    }];
  }

  if (s.budget === 0) {
    out.push({
      tone: "bad", action: "plan", title: "No room to spend",
      text: `Your bills and savings goal use all of your ${money.short(s.income)} income. Lower the goal or trim a bill.`,
    });
  }

  const over = s.categories.find((c) => c.limit && c.amount > c.limit);
  if (over) {
    out.push({
      tone: "bad", title: `${name(over.id)} is over its limit`,
      text: `${money.short(over.amount)} spent of ${money.short(over.limit)}. That's ${money.short(over.amount - over.limit)} over.`,
    });
  }

  if (s.budget > 0 && s.left < 0) {
    out.push({
      tone: "bad", title: "Over budget",
      text: `You're ${money.short(-s.left)} past your flexible budget, so extra spending now comes out of savings.`,
    });
  } else if (s.phase === "current" && s.elapsed >= 5 && s.budget > 0 && s.projectedSpend > s.budget) {
    out.push({
      tone: "warn", title: "Spending is running hot",
      text: `At this pace you'll spend ${money.short(s.projectedSpend)}, ${money.short(s.projectedSpend - s.budget)} over plan. Keep to ${money.short(s.dailyAllowance)} a day to recover.`,
    });
  }

  if (s.phase !== "future") {
    const jump = compareMonths(state, ym)
      .filter((c) => c.previous > 0 && c.current - c.previous >= 2000)
      .sort((a, b) => b.current - b.previous - (a.current - a.previous))[0];
    if (jump) {
      out.push({
        tone: "warn", title: `${name(jump.id)} is up`,
        text: s.phase === "current"
          ? `${money.short(jump.current)} so far, already more than all of last month (${money.short(jump.previous)}).`
          : `${money.short(jump.current)} vs ${money.short(jump.previous)} the month before.`,
      });
    }
  }

  const top = s.categories[0];
  if (top && top.share >= 0.35 && s.spent >= 5000) {
    const monthly = s.phase === "current" && s.elapsed ? (top.amount / s.elapsed) * s.dim : top.amount;
    out.push({
      tone: "info", title: `${name(top.id)} leads your spending`,
      text: `It's ${Math.round(top.share * 100)}% of this month. Trimming it by 15% would free up about ${money.short(monthly * 0.15 * 12)} a year.`,
    });
  }

  if (!out.length) {
    if (!s.count && s.phase !== "past") {
      out.push({
        tone: "info", title: "Log as you go",
        text: "Add purchases right after you make them. It takes a few seconds, and small buys add up fast.",
      });
    } else {
      const extra = s.projectedSavings - s.goal;
      out.push({
        tone: "good", title: s.phase === "past" ? "Month closed under budget" : "You're on track",
        text: s.phase === "past"
          ? `You saved ${money.short(s.income - s.fixed - s.spent)} with ${money.short(s.left)} of budget to spare.`
          : `You're on pace to save ${money.short(s.projectedSavings)}${extra > 0 ? `, ${money.short(extra)} more than your goal` : ""}.`,
      });
    }
  }
  return out;
}
