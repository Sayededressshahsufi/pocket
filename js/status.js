/**
 * Traffic-light status for each part of the app. Pure functions: they turn
 * real numbers into one of three states, plus a short plain-English reason.
 *
 *   good  -> green  (you're on track)
 *   watch -> yellow (worth a look soon)
 *   alert -> red    (act now)
 *   none  -> grey   (not enough information yet)
 */
export const STATES = Object.freeze({ good: "good", watch: "watch", alert: "alert", none: "none" });

/** Spending against a budget or limit. `used` is a 0..n ratio of the budget. */
export function budgetStatus(used) {
  if (used == null || !Number.isFinite(used)) return { state: STATES.none, reason: "Set a plan to see this." };
  if (used >= 1) return { state: STATES.alert, reason: "You've used up this budget." };
  if (used >= 0.85) return { state: STATES.watch, reason: "Almost used up. Slow down." };
  return { state: STATES.good, reason: "Plenty left." };
}

/** Savings progress toward the goal, using projected savings vs goal. */
export function savingsStatus(saved, goal) {
  if (!goal) return { state: STATES.none, reason: "Set a savings goal to see this." };
  if (saved < 0) return { state: STATES.alert, reason: "You're spending more than you earn this month." };
  if (saved >= goal) return { state: STATES.good, reason: "On track to hit your goal." };
  if (saved >= goal * 0.6) return { state: STATES.watch, reason: "Close, but a little short of your goal." };
  return { state: STATES.alert, reason: "Well short of your goal." };
}

/** Days of allowance left vs days left in the month, from the daily-pace numbers. */
export function paceStatus(s) {
  if (!s.income) return { state: STATES.none, reason: "Set your pay to see your pace." };
  if (s.budget > 0 && s.left < 0) return { state: STATES.alert, reason: "Over budget. Spending now comes out of savings." };
  if (s.phase === "past") return s.left >= 0
    ? { state: STATES.good, reason: "You finished the month under budget." }
    : { state: STATES.alert, reason: "The month finished over budget." };
  if (s.phase === "future") return { state: STATES.none, reason: "This month hasn't started." };
  if (s.projectedSpend > s.budget * 1.05) return { state: STATES.watch, reason: "At this pace you'll go over." };
  if (s.spent - s.idealSpend > s.budget * 0.05) return { state: STATES.watch, reason: "A bit ahead of where you should be." };
  return { state: STATES.good, reason: "Right on pace." };
}

/** A bill vs last month. Only real changes count; estimates say "waiting". */
export function billStatus(row) {
  if (row.estimated) return { state: STATES.none, reason: "Waiting for this month's bill." };
  if (!row.comparable) return { state: STATES.none, reason: "Nothing to compare yet." };
  if (row.delta <= 0) return { state: STATES.good, reason: "Same or lower than last month." };
  if (row.pct >= 0.15) return { state: STATES.alert, reason: "Noticeably higher than last month." };
  return { state: STATES.watch, reason: "A little higher than last month." };
}

/** Bank balance check-in: red if the estimate is well off, yellow if overdue. */
export function balanceStatus(est, needsCheck) {
  if (!est) return { state: STATES.none, reason: "Add your balance to start tracking." };
  if (est.afterBills < 0) return { state: STATES.alert, reason: "Upcoming bills are more than your balance." };
  if (needsCheck) return { state: STATES.watch, reason: "It's been a week. Time to check in." };
  return { state: STATES.good, reason: "Your balance is up to date." };
}

/** Weekly spending vs the same days last week. */
export function weekStatus(w) {
  if (!w.hadLastWeek && !w.count) return { state: STATES.none, reason: "Nothing to compare yet." };
  if (!w.hadLastWeek) return { state: STATES.good, reason: "Your first week of comparisons." };
  const pct = w.prevSameDays ? w.change / w.prevSameDays : 0;
  if (w.change <= 0) return { state: STATES.good, reason: "Spending less than last week." };
  if (pct >= 0.25) return { state: STATES.alert, reason: "Well ahead of last week's pace." };
  return { state: STATES.watch, reason: "Slightly ahead of last week." };
}

/** Savings forecast: good if you beat the goal, red if spending exceeds income. */
export function forecastStatus(f) {
  if (!f.goal) return { state: STATES.none, reason: "Set a goal to see how you compare." };
  if (f.avgMonthly < 0) return { state: STATES.alert, reason: "You're spending more than you earn." };
  if (f.avgMonthly >= f.goal) return { state: STATES.good, reason: "Beating your savings goal." };
  if (f.avgMonthly >= f.goal * 0.6) return { state: STATES.watch, reason: "A little short of your goal." };
  return { state: STATES.alert, reason: "Well short of your goal." };
}

/** Category limit: red over, yellow near, green comfortable. */
export function limitStatus(amount, limit) {
  if (!limit) return { state: STATES.none, reason: "No limit set." };
  return budgetStatus(amount / limit);
}

/** Small glue: pick the right CSS data attribute value. */
export const toneOf = (status) => ({ good: "good", watch: "warn", alert: "bad", none: "info" })[status.state];
