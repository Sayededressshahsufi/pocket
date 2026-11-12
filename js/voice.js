/**
 * Pocket's voice: warm, a little witty, never preachy.
 *
 * Every line is picked deterministically from a seed (usually today's date plus
 * a topic), so wording varies day to day but never flickers while you use the
 * app. Keep lines short, specific, and about the person's money, not about us.
 */
import { getCategory } from "./categories.js";
import { monthLabel, ordinal, parseISO, shiftYM } from "./dates.js";

/** Small stable hash -> index. */
function pick(seed, options) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return options[Math.abs(h) % options.length];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const catName = (id) => getCategory(id).name.toLowerCase();

export function greeting(hour, name = "") {
  const part = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

// ---------------------------------------------------------------- weekly
export function weeklyHeadline(w, money, seed) {
  const amt = money.short(Math.abs(w.change));
  if (!w.count) {
    return w.elapsed <= 1
      ? pick(seed, ["Fresh week, clean slate.", "New week. Let's make it a good one.", "Week one-day-in. So far, so frugal."])
      : pick(seed, ["Nothing spent this week. Impressive restraint.", "A no-spend week so far. Your savings approve.", "Zero spent this week. Who even are you?"]);
  }
  if (!w.hadLastWeek) return pick(seed, [`${money.short(w.spent)} so far this week.`, `You're at ${money.short(w.spent)} this week.`]);
  if (Math.abs(w.change) < 500) {
    return pick(seed, ["Right in line with last week. Consistent.", "Same pace as last week. Steady wins.", "Matching last week almost to the dollar."]);
  }
  if (w.change < 0) {
    return pick(seed, [
      `${amt} less than this point last week. Nice.`,
      `Down ${amt} from last week. Your wallet says thanks.`,
      `${amt} under last week's pace. Keep that energy.`,
    ]);
  }
  return pick(seed, [
    `${amt} more than this point last week.`,
    `Running ${amt} ahead of last week. Worth a look.`,
    `Up ${amt} on last week. Let's ease off a little.`,
  ]);
}

export function weeklyDetail(w, money) {
  if (!w.count) return w.paidIn ? `Paid in ${money.short(w.paidIn)} this week. All of it's still yours.` : "";
  const parts = [];
  if (w.topCategory) parts.push(`Most went to ${catName(w.topCategory.id)} (${money.short(w.topCategory.amount)})`);
  if (w.biggest && w.count > 1) parts.push(`biggest buy: ${w.biggest.note || getCategory(w.biggest.category).name} at ${money.short(w.biggest.amount)}`);
  return parts.length ? `${parts.join(", ")}.` : "";
}

// ---------------------------------------------------------------- bills
const WINTER = [11, 12, 1, 2, 3];
const SUMMER = [6, 7, 8, 9];

function seasonNote(row, ym, up) {
  const month = Number(ym.slice(5, 7));
  const name = row.name.toLowerCase();
  const isGas = /gas|heat|propane|oil/.test(name);
  const isPower = /electric|energy|power|dominion|pepco|duke|edison/.test(name);
  if (up && WINTER.includes(month) && (isGas || isPower)) return "Cold weather usually does that.";
  if (up && SUMMER.includes(month) && isPower) return "AC season will do that.";
  if (!up && (isGas || isPower) && [4, 5, 10].includes(month)) return "Mild weather pays off.";
  return "";
}

/** One-line verdict for a bill vs last month. */
export function billLine(row, ym, money) {
  const prevName = monthLabel(shiftYM(ym, -1), "short");
  if (row.estimated && row.upcoming) {
    const due = parseISO(row.due).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Due ${due}. Usually around ${money.short(row.current)}.`;
  }
  if (row.estimated) return `Waiting on this month's bill. Usually around ${money.short(row.current)}.`;
  if (row.prevEstimated) return `No ${prevName} amount to compare with yet.`;
  if (!row.variable) return row.delta ? `${row.delta > 0 ? "Up" : "Down"} ${money.short(Math.abs(row.delta))} from ${prevName}.` : "Same as always. Predictable.";
  if (Math.abs(row.delta) < 100) return `Basically the same as ${prevName}.`;
  const up = row.delta > 0;
  const amt = money.format(Math.abs(row.delta));
  const pct = Math.round(Math.abs(row.pct) * 100);
  const base = up ? `${amt} higher than ${prevName} (+${pct}%).` : `${amt} lower than ${prevName} (\u2212${pct}%).`;
  const note = seasonNote(row, ym, up);
  return note ? `${base} ${note}` : base;
}

export function billsSummary(cmp, ym, money, seed) {
  const prevName = monthLabel(shiftYM(ym, -1), "short");
  if (!cmp.rows.length) return "";
  if (cmp.pending && cmp.pending === cmp.rows.filter((r) => r.variable).length) {
    return `${cmp.pending === 1 ? "One bill is" : `${cmp.pending} bills are`} still waiting for this month's amount.`;
  }
  if (Math.abs(cmp.firmDelta) < 100) return pick(seed, [`Bills are holding steady vs ${prevName}.`, `No surprises: bills match ${prevName}.`]);
  return cmp.firmDelta > 0
    ? pick(seed, [`Bills are ${money.short(cmp.firmDelta)} higher than ${prevName}.`, `Bills crept up ${money.short(cmp.firmDelta)} from ${prevName}.`])
    : pick(seed, [`Bills are ${money.short(-cmp.firmDelta)} lower than ${prevName}. Nice break.`, `${money.short(-cmp.firmDelta)} less on bills than ${prevName}.`]);
}

/** Toast after typing in a bill's amount. */
export function billEntered(bill, amount, previous, average, money, ym) {
  const prevName = monthLabel(shiftYM(ym, -1), "name");
  const head = `${bill.name}: ${money.format(amount)}.`;
  if (previous) {
    const d = amount - previous;
    if (Math.abs(d) < 100) return `${head} Same as ${prevName}.`;
    return d > 0 ? `${head} That's ${money.format(d)} more than ${prevName}.` : `${head} ${money.format(-d)} less than ${prevName}. Nice.`;
  }
  if (average) {
    const pct = Math.round(((amount - average) / average) * 100);
    if (pct >= 20) return `${head} ${pct}% above your average.`;
    if (pct <= -20) return `${head} ${-pct}% below your average. Nice.`;
  }
  return `${head} Saved.`;
}

// ---------------------------------------------------------------- afford
export function affordVerdict(r, money) {
  const p = money.short(r.price);
  switch (r.verdict) {
    case "unknown":
      return { title: "Set up your plan first", text: "Add your pay in Plan and I can answer this properly." };
    case "yes":
      return {
        title: "Go for it",
        text: `You'll still have ${money.short(r.afterToday)} left for today, and your month stays on track.`,
      };
    case "tight":
      return {
        title: "You can, but it's tight",
        text: `${p} is about ${r.days} ${r.days === 1 ? "day" : "days"} of spending money. Your daily allowance would drop from ${money.short(r.daily)} to ${money.short(r.newDaily)} for the rest of the month.`,
      };
    case "no":
      return r.reason === "bank"
        ? { title: "I'd hold off", text: `Your bank would be ${money.short(-r.bankAfter)} short once this month's bills come out.` }
        : { title: "I'd hold off", text: `That's ${money.short(r.savingsHit)} more than you have left this month, so it would come out of your savings goal.` };
    default:
      return { title: "", text: "" };
  }
}

// ---------------------------------------------------------------- habits & forecast
export function weekdayLine(wd, money) {
  if (!wd.enough) return "Log a couple of weeks and I'll spot your patterns.";
  const day = WEEKDAYS[wd.top];
  return `${day}s are your big spending day, about ${money.short(wd.avg[wd.top])} on average.`;
}

export function smallLine(sp, money) {
  if (sp.count < 3) return "";
  return `${sp.count} purchases under ${money.short(sp.threshold)} added up to ${money.short(sp.total)} this month. At this rate that's ${money.short(sp.yearly)} a year.`;
}

export function forecastLine(f, money) {
  if (f.avgMonthly <= 0) return "Right now you're spending about what you earn. Small cuts add up fast.";
  const base = f.basis === "history"
    ? `You've been saving about ${money.short(f.avgMonthly)} a month.`
    : `If this month is typical, you'll save about ${money.short(f.avgMonthly)} a month.`;
  if (f.vsGoal == null) return base;
  if (f.vsGoal >= 0) return `${base} That beats your goal. Excellent.`;
  return `${base} That's ${money.short(-f.vsGoal)} short of your goal each month.`;
}

export function calendarLine(cal, money) {
  if (cal.biggest && cal.noSpendDays >= 3) return `${cal.noSpendDays} no-spend days so far. Biggest day: the ${ordinal(cal.biggest.day)} at ${money.short(cal.biggest.amount)}.`;
  if (cal.biggest) return `Biggest day so far: ${money.short(cal.biggest.amount)}.`;
  return "Nothing logged yet this month.";
}

export function yearLine(yv, money, monthName) {
  if (!yv.tracked) return "Not much to look back on yet. Check back next month.";
  if (yv.best && yv.best !== yv.worst) return `Best month: ${monthName(yv.best.ym)} with ${money.short(yv.best.saved)} saved.`;
  return `${money.short(yv.totalSpent)} spent so far this year.`;
}
