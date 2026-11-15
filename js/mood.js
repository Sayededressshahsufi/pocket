/**
 * "How am I doing?" Pure logic that turns the current month into one mood
 * (good / watch / alert / none) plus the specific wins and problems behind it.
 * Nothing here touches the DOM, so every rule is unit-tested.
 *
 * What moves the mood:
 *   red    -> a core problem (over budget, plan with no room, savings far short,
 *             bank short for upcoming bills) or two or more alerts
 *   yellow -> pace running hot, a category near/over its limit, bills creeping up
 *   green  -> none of the above
 * A stale bank-balance check shows as a to-do but never changes the color.
 */
import { balanceEstimate, hasIncomePlan, lifetimeStats, needsBalanceCheck, summarize, sum } from "./budget.js";
import { getCategory } from "./categories.js";
import { currentYM, toISO } from "./dates.js";
import { billComparisons, spendingCalendar, weeklySummary } from "./insights.js";
import { paceStatus, savingsStatus, STATES } from "./status.js";
import { pick } from "./voice.js";

const plural = (n, one, many) => (n === 1 ? one : many);

const HEADLINES = {
  good: ["You're crushing it.", "Look at you go.", "Right on track. Keep it up.", "Money moves: on point.", "This is what a good month looks like."],
  watch: ["Almost there. A few things to watch.", "Heads up: small tweaks keep you on track.", "Doing okay, with a few things to watch."],
  alert: ["Let's fix this together.", "This month needs attention.", "Off track, but it's fixable."],
};

export function computeMood(state, now = new Date(), money, { name = "" } = {}) {
  const ym = currentYM(now);
  const s = summarize(state, ym, now);
  const none = (reason) => ({ state: STATES.none, celebrate: false, headline: "", subline: reason, reason, wins: [], problems: [] });

  if (!hasIncomePlan(state) || !s.income) return none("Set up your plan to see how you're doing.");
  const est = balanceEstimate(state, now);
  if (!s.count && !est) return none("Log your first expense to see how you're doing.");

  const m = money.short;
  const catName = (id) => getCategory(id).name;
  const daysLeft = s.daysLeft;
  const perDay = (cents) => (daysLeft > 0 ? Math.ceil(cents / daysLeft) : cents);
  const problems = [];
  const add = (p) => problems.push({ affects: true, core: false, ...p });

  // --- Problems ------------------------------------------------------------
  if (s.budget === 0) {
    add({
      key: "plan", state: STATES.alert, core: true,
      title: "Your plan has no room to spend",
      text: `Bills and your savings goal use all of your ${m(s.income)} income this month.`,
      fix: "Lower your savings goal or trim a bill.",
      action: { label: "Open Plan", href: "#plan" },
    });
  }

  const pace = paceStatus(s);
  if (s.budget > 0 && pace.state === STATES.alert) {
    const top = s.categories.find((c) => c.amount > 0);
    add({
      key: "over", state: STATES.alert, core: true,
      title: `You're ${m(-s.left)} over budget`,
      text: s.goal ? `That extra comes out of your ${m(s.goal)} savings goal.` : "That extra comes out of your savings.",
      fix: top
        ? `${catName(top.id)} is your biggest spend (${m(top.amount)}). Pause it for the rest of the month.`
        : "Pause extras for the rest of the month.",
    });
  } else if (s.budget > 0 && s.phase === "current" && pace.state === STATES.watch) {
    const over = s.projectedSpend - s.budget;
    add(over > 0
      ? {
        key: "pace", state: STATES.watch,
        title: "You're spending faster than planned",
        text: `At this pace you'll spend ${m(s.projectedSpend)}, which is ${m(over)} over your budget.`,
        fix: `Keep to ${m(s.dailyAllowance)} a day for the rest of the month.`,
      }
      : {
        key: "pace", state: STATES.watch,
        title: "You're a bit ahead of an even pace",
        text: `You've spent ${m(s.spent - s.idealSpend)} more than an even pace would be by today.`,
        fix: `Keep to ${m(s.dailyAllowance)} a day to stay on track.`,
      });
  }

  // Savings shortfall mirrors pace problems, so only add it when pace didn't already explain it.
  const savings = savingsStatus(s.projectedSavings, s.goal);
  if (!problems.some((p) => p.key === "over" || p.key === "pace") && savings.state !== STATES.good && savings.state !== STATES.none && s.projectedSavings < s.goal * 0.9) {
    const short = Math.max(0, s.goal - s.projectedSavings);
    add(s.projectedSavings < 0
      ? {
        key: "savings", state: STATES.alert, core: true,
        title: "You're spending more than you earn this month",
        text: `You're on pace to finish ${m(-s.projectedSavings)} in the red.`,
        fix: `Cut about ${m(perDay(-s.projectedSavings))} a day to get back to even.`,
      }
      : {
        key: "savings", state: savings.state, core: savings.state === STATES.alert,
        title: "You're behind on your savings goal",
        text: `On pace to save ${m(s.projectedSavings)} of your ${m(s.goal)} goal.`,
        fix: `Spend about ${m(perDay(short))} less per day to still hit it.`,
      });
  }

  if (s.phase === "current") {
    for (const c of s.categories) {
      if (!c.limit) continue;
      const name = catName(c.id);
      if (c.amount > c.limit) {
        add({
          key: `limit:${c.id}`, state: STATES.alert,
          title: `${name} is over its limit`,
          text: `${m(c.amount)} spent of ${m(c.limit)}, which is ${m(c.amount - c.limit)} over.`,
          fix: `Skip ${name.toLowerCase()} for the rest of the month, or raise the limit if it was unrealistic.`,
          action: { label: "Open Plan", href: "#plan" },
        });
      } else if (c.amount / c.limit >= 0.85) {
        const left = c.limit - c.amount;
        add({
          key: `limit:${c.id}`, state: STATES.watch,
          title: `${name} is almost at its limit`,
          text: `${m(c.amount)} of ${m(c.limit)} used, with ${daysLeft} ${plural(daysLeft, "day", "days")} left.`,
          fix: daysLeft > 0 ? `${m(left)} is left, about ${m(Math.floor(left / daysLeft))} a day.` : `${m(left)} is left.`,
        });
      }
    }
  }

  if (est && est.afterBills < 0) {
    add({
      key: "bank", state: STATES.alert, core: true,
      title: "Your bank may fall short",
      text: `After the bills still due this month, you'd be ${m(-est.afterBills)} short${est.daysSince > 0 ? ` (based on your balance ${est.daysSince} ${plural(est.daysSince, "day", "days")} ago)` : ""}.`,
      fix: "Move money in, or hold off on extra spending until your next paycheck.",
      action: { label: "Update balance", kind: "balance" },
    });
  }

  const cmp = billComparisons(state, ym, now);
  const firm = cmp.rows.filter((r) => r.comparable);
  const prevFirm = sum(firm, (r) => r.previous);
  const worst = firm.reduce((b, r) => (!b || r.delta > b.delta ? r : b), null);
  // A fixed bill like rent shouldn't hide a big jump in a utility, so one bill up 15%+ counts too.
  const overall = prevFirm ? cmp.firmDelta / prevFirm : 0;
  if (worst && cmp.firmDelta >= 1000 && (overall >= 0.03 || worst.pct >= 0.15)) {
    add({
      key: "bills", state: STATES.watch,
      title: "Bills are higher than last month",
      text: `Up ${m(cmp.firmDelta)} overall. Biggest jump: ${worst.name} (+${m(worst.delta)}).`,
      fix: `Check ${worst.name} for errors or unusual use.`,
      action: { label: "See bills", href: "#insights" },
    });
  }

  if (est && needsBalanceCheck(state, now)) {
    add({
      key: "check", state: STATES.watch, affects: false,
      title: "Time to check your balance",
      text: `It's been ${est.daysSince} days since you last updated it.`,
      fix: "Open your banking app and update it so these numbers stay accurate.",
      action: { label: "Update balance", kind: "balance" },
    });
  }

  const rank = (p) => (p.state === STATES.alert ? 0 : 1) * 2 + (p.core ? 0 : 1);
  problems.sort((a, b) => rank(a) - rank(b));

  // --- Mood ----------------------------------------------------------------
  const affecting = problems.filter((p) => p.affects);
  const alerts = affecting.filter((p) => p.state === STATES.alert);
  const mood = alerts.some((p) => p.core) || alerts.length >= 2 ? STATES.alert
    : affecting.length ? STATES.watch
      : STATES.good;

  // --- Wins (only things that are true) -------------------------------------
  const wins = [];
  if (s.goal > 0 && s.count > 0 && s.projectedSavings >= s.goal) {
    const extra = s.projectedSavings - s.goal;
    wins.push({
      key: "savings",
      title: extra > 0 ? `On pace to save ${m(s.projectedSavings)}` : "On pace to hit your savings goal",
      text: extra > 0 ? `That's ${m(extra)} more than your ${m(s.goal)} goal.` : `Right on your ${m(s.goal)} goal.`,
    });
  }
  if (s.phase === "current" && s.budget > 0 && s.idealSpend - s.spent >= 1000) {
    wins.push({
      key: "pace", title: `${m(s.idealSpend - s.spent)} under pace`,
      text: `You've spent ${m(s.spent)} so far. An even pace would be ${m(s.idealSpend)} by today.`,
    });
  }
  const streak = lifetimeStats(state, now).streak;
  if (streak >= 1) {
    wins.push({ key: "streak", title: `${streak}-month goal streak`, text: `You've hit your savings goal ${streak} ${plural(streak, "month", "months")} in a row.` });
  }
  const cal = spendingCalendar(state, ym, now);
  if (cal.noSpendDays >= 2) {
    wins.push({ key: "nospend", title: `${cal.noSpendDays} no-spend days`, text: "The days you spent nothing are the quiet wins." });
  }
  const week = weeklySummary(state, now);
  if (week.hadLastWeek && week.change < -week.noise) {
    wins.push({ key: "week", title: `${m(-week.change)} less than last week`, text: "Compared with the same days last week." });
  }
  if (firm.length && cmp.firmDelta <= -1000) {
    wins.push({ key: "bills", title: `Bills are ${m(-cmp.firmDelta)} lower`, text: "Less than last month." });
  }
  const limited = s.categories.filter((c) => c.limit);
  if (s.phase === "current" && limited.length && limited.every((c) => c.amount / c.limit < 0.85)) {
    wins.push({ key: "limits", title: "Every category limit is in the green", text: "Plenty of room left in each one." });
  }
  if (s.phase === "current" && s.dailyAllowance > 0 && s.left > 0) {
    wins.push({ key: "allowance", title: `${m(s.dailyAllowance)} a day to spend`, text: "Stay under that and you'll still hit your savings goal." });
  }
  if (est && !needsBalanceCheck(state, now)) {
    wins.push({ key: "balance", title: "Your bank balance is up to date", text: "Estimates stay accurate when you check in weekly." });
  }

  // --- Words -----------------------------------------------------------------
  const seed = `${toISO(now)}:${mood}`;
  const options = mood === STATES.good && name ? [`Nice work, ${name}.`, ...HEADLINES.good] : HEADLINES[mood];
  const count = affecting.length;
  const subline = mood === STATES.good
    ? "Your pace, savings goal, bills and bank balance all look healthy."
    : mood === STATES.watch
      ? `${count} ${plural(count, "thing", "things")} to keep an eye on. Small tweaks now keep your month on track.`
      : `${Math.max(1, alerts.length)} ${plural(Math.max(1, alerts.length), "thing is", "things are")} hurting your month. Start with the first one below. Small changes now make a big difference.`;
  const reason = mood === STATES.good
    ? "Your pace, savings goal, bills and bank balance all look healthy."
    : `${count} ${plural(count, "thing needs", "things need")} attention: ${affecting[0].title.toLowerCase()}.`;

  return {
    state: mood,
    celebrate: mood === STATES.good && s.count >= 3 && wins.length > 0,
    headline: pick(seed, options),
    subline,
    reason,
    wins,
    problems,
  };
}
