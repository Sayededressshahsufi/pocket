import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balanceEstimate, billHistory, billsDue, buildInsights, compareMonths, flexibleBudget, history, incomeFor,
  lifetimeStats, needsBalanceCheck, paydayPending, paydaysIn, reconcile, summarize,
} from "../js/budget.js";
import { createMoney } from "../js/money.js";
import { defaultState } from "../js/store.js";

const money = createMoney("USD", "en-US");
const NOW = new Date(2025, 2, 15, 12); // 15 March 2025

function makeState({ income = 400000, goal = 50000, bills = [150000], items = [], limits = {} } = {}) {
  const s = defaultState();
  s.settings.income = income;
  s.settings.goal = goal;
  s.recurring = bills.map((amount, i) => ({ id: `b${i}`, name: "Bill", amount, category: "housing", day: 1 }));
  s.limits = limits;
  s.items = items.map(([date, amount, category = "groceries"], i) => ({
    id: `i${i}`, date, amount, category, note: "", createdAt: i,
  }));
  return s;
}

describe("summarize", () => {
  it("derives the flexible budget from income, bills and goal", () => {
    const s = makeState();
    assert.equal(flexibleBudget(s), 200000);
    assert.equal(summarize(s, "2025-03", NOW).budget, 200000);
  });

  it("never reports a negative budget", () => {
    assert.equal(flexibleBudget(makeState({ income: 100000 })), 0);
  });

  it("computes spend, allowance and projection mid-month", () => {
    const s = summarize(makeState({ items: [["2025-03-01", 10000], ["2025-03-10", 5000], ["2025-02-28", 9999]] }), "2025-03", NOW);
    assert.equal(s.phase, "current");
    assert.equal(s.spent, 15000);
    assert.equal(s.left, 185000);
    assert.equal(s.elapsed, 15);
    assert.equal(s.daysLeft, 17);
    assert.equal(s.dailyAllowance, Math.floor(185000 / 17));
    assert.equal(s.projectedSpend, 31000);
    assert.equal(s.projectedSavings, 400000 - 150000 - 31000);
    assert.equal(s.daily.length, 15);
    assert.equal(s.daily[0], 10000);
    assert.equal(s.daily[14], 15000);
  });

  it("locks the daily allowance at the start of the day", () => {
    const s = summarize(makeState({ items: [["2025-03-15", 3400]] }), "2025-03", NOW);
    assert.equal(s.spentToday, 3400);
    assert.equal(s.dailyAllowance, Math.floor(200000 / 17));
    assert.equal(s.leftToday, Math.floor(200000 / 17) - 3400);
  });

  it("does not extrapolate during the first days of the month", () => {
    const early = new Date(2025, 2, 2);
    const s = summarize(makeState({ items: [["2025-03-01", 50000]] }), "2025-03", early);
    assert.equal(s.projectedSpend, 200000);
  });

  it("assumes the full budget is spent when nothing is logged yet", () => {
    const s = summarize(makeState(), "2025-03", NOW);
    assert.equal(s.projectedSpend, 200000);
    assert.equal(s.projectedSavings, 50000);
  });

  it("treats past months as closed", () => {
    const s = summarize(makeState({ items: [["2025-01-05", 120000]] }), "2025-01", NOW);
    assert.equal(s.phase, "past");
    assert.equal(s.daysLeft, 0);
    assert.equal(s.dailyAllowance, 0);
    assert.equal(s.projectedSpend, 120000);
  });

  it("assumes future months follow the plan", () => {
    const s = summarize(makeState(), "2025-05", NOW);
    assert.equal(s.phase, "future");
    assert.equal(s.projectedSavings, 50000);
    assert.equal(s.daily.length, 0);
  });

  it("includes categories that only have a limit", () => {
    const s = summarize(makeState({ limits: { dining: 20000 } }), "2025-03", NOW);
    assert.deepEqual(s.categories.map((c) => [c.id, c.amount, c.limit]), [["dining", 0, 20000]]);
  });
});

describe("variable bills", () => {
  const withUtility = (actuals = {}, day = 10) => {
    const s = makeState({ bills: [150000] });
    s.recurring.push({ id: "dom", name: "Dominion Energy", amount: 9000, category: "bills", day, variable: true, actuals });
    return s;
  };

  it("uses the estimate until an actual is entered, then the actual", () => {
    assert.equal(summarize(withUtility(), "2025-03", NOW).fixed, 159000);
    const s = summarize(withUtility({ "2025-03": 12345 }), "2025-03", NOW);
    assert.equal(s.fixed, 162345);
    assert.equal(s.budget, 400000 - 162345 - 50000);
  });

  it("applies each month's actual to that month only", () => {
    const h = history(withUtility({ "2025-01": 20000 }), "2025-03", 3);
    assert.deepEqual(h.map((m) => m.budget), [400000 - 170000 - 50000, 200000 - 9000, 200000 - 9000]);
  });

  it("asks for the amount once the due day arrives", () => {
    assert.deepEqual(billsDue(withUtility({}, 20), "2025-03", NOW), []);
    assert.deepEqual(billsDue(withUtility({}, 15), "2025-03", NOW).map((b) => b.id), ["dom"]);
    assert.deepEqual(billsDue(withUtility({ "2025-03": 5000 }, 1), "2025-03", NOW), []);
    assert.deepEqual(billsDue(withUtility({}, 31), "2025-02", NOW).map((b) => b.id), ["dom"]);
    assert.deepEqual(billsDue(withUtility({}, 1), "2025-04", NOW), []);
  });

  it("ignores fixed bills when asking for amounts", () => {
    assert.deepEqual(billsDue(makeState(), "2025-03", NOW), []);
  });

  it("summarizes a bill's history", () => {
    const bill = withUtility({ "2025-01": 14000, "2025-02": 10000, "2024-06": 6000 }).recurring[1];
    const h = billHistory(bill, "2025-03", 3);
    assert.deepEqual(h.months, [{ ym: "2025-01", amount: 14000 }, { ym: "2025-02", amount: 10000 }, { ym: "2025-03", amount: null }]);
    assert.equal(h.average, 10000);
    assert.equal(h.peak.ym, "2025-01");
  });
});

describe("weekly pay", () => {
  // March 2025 has five Fridays: 7, 14, 21, 28 ... and the 7th is the first.
  const weekly = (paychecks = [], amount = 100000) => {
    const s = makeState({ income: 0 });
    s.settings.pay = { frequency: "weekly", amount, weekday: 5, anchor: "" };
    s.paychecks = paychecks.map(([date, amt], i) => ({ id: `p${i}`, date, amount: amt, note: "", createdAt: i }));
    return s;
  };

  it("finds paydays in a month", () => {
    assert.deepEqual(paydaysIn({ frequency: "weekly", weekday: 5 }, "2025-03"), ["2025-03-07", "2025-03-14", "2025-03-21", "2025-03-28"]);
    assert.deepEqual(paydaysIn({ frequency: "biweekly", weekday: 5, anchor: "2025-02-28" }, "2025-03"), ["2025-03-14", "2025-03-28"]);
    assert.deepEqual(paydaysIn({ frequency: "monthly" }, "2025-03"), []);
  });

  it("adds logged paychecks to the paydays still expected", () => {
    const s = weekly([["2025-03-07", 98000], ["2025-03-14", 112000]]);
    assert.equal(incomeFor(s, "2025-03", NOW), 98000 + 112000 + 2 * 100000);
    assert.equal(summarize(s, "2025-03", NOW).income, 410000);
  });

  it("counts only logged paychecks in closed months", () => {
    const s = weekly([["2025-02-07", 90000]]);
    assert.equal(incomeFor(s, "2025-02", NOW), 90000);
    assert.equal(incomeFor(weekly(), "2025-02", NOW), 4 * 100000); // nothing logged: assume schedule
  });

  it("prompts on payday until the paycheck is logged", () => {
    assert.equal(paydayPending(weekly(), NOW), "2025-03-14"); // Fri before Sat 15th
    assert.equal(paydayPending(weekly([["2025-03-13", 100000]]), NOW), null); // arrived a day early
    assert.equal(paydayPending(weekly([], 0), NOW), null);
    assert.equal(paydayPending(makeState(), NOW), null);
  });
});

describe("bank balance", () => {
  const withBalance = (amount, date = "2025-03-10", extra = {}) => {
    const s = makeState({ bills: [] });
    s.recurring = [
      { id: "b1", name: "Phone", amount: 5000, category: "bills", day: 12, variable: false, actuals: {} },
      { id: "b2", name: "Gas", amount: 8000, category: "bills", day: 20, variable: true, actuals: { "2025-03": 9500 } },
    ];
    s.balances = [{ id: "x", amount, date, at: 100 }];
    s.items = (extra.items ?? []).map(([d, a, createdAt = 200]) => ({ id: d + a, date: d, amount: a, category: "other", note: "", createdAt }));
    s.paychecks = (extra.pay ?? []).map(([d, a]) => ({ id: d + a, date: d, amount: a, note: "", createdAt: 200 }));
    return s;
  };

  it("returns null until a balance is entered", () => {
    assert.equal(balanceEstimate(makeState(), NOW), null);
    assert.equal(needsBalanceCheck(makeState(), NOW), true);
  });

  it("rolls the last balance forward with paychecks, spending and bills due since", () => {
    const e = balanceEstimate(withBalance(150000, "2025-03-10", {
      items: [["2025-03-09", 9999], ["2025-03-10", 1000, 50], ["2025-03-10", 2000], ["2025-03-14", 3000], ["2025-03-30", 7777]],
      pay: [["2025-03-14", 85000]],
    }), NOW);
    assert.equal(e.spent, 5000); // same-day before the check and future items are excluded
    assert.equal(e.paidIn, 85000);
    assert.equal(e.bills, 5000); // phone on the 12th
    assert.equal(e.estimate, 150000 + 85000 - 5000 - 5000);
    assert.equal(e.upcoming, 9500); // gas on the 20th, using the entered actual
    assert.equal(e.afterBills, e.estimate - 9500);
    assert.equal(e.daysSince, 5);
  });

  it("asks again after a week", () => {
    assert.equal(needsBalanceCheck(withBalance(1, "2025-03-10"), NOW), false);
    assert.equal(needsBalanceCheck(withBalance(1, "2025-03-08"), NOW), true);
  });

  it("tolerates small gaps but flags real ones", () => {
    assert.deepEqual(reconcile(100000, 99500), { diff: -500, matches: true });
    assert.deepEqual(reconcile(100000, 95480), { diff: -4520, matches: false });
    assert.deepEqual(reconcile(500000, 503000), { diff: 3000, matches: true }); // within 1%
    assert.equal(reconcile(-2000, 3000).matches, false);
  });
});

describe("history & comparisons", () => {
  it("returns the requested window ending at the selected month", () => {
    const h = history(makeState({ items: [["2025-03-02", 250000]] }), "2025-03", 6);
    assert.deepEqual(h.map((m) => m.ym), ["2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03"]);
    assert.equal(h[5].over, true);
  });

  it("compares categories with the previous month", () => {
    const rows = compareMonths(makeState({
      items: [["2025-03-01", 3000, "dining"], ["2025-02-01", 1000, "dining"], ["2025-02-03", 500, "fun"]],
    }), "2025-03");
    assert.deepEqual(rows, [
      { id: "dining", current: 3000, previous: 1000 },
      { id: "fun", current: 0, previous: 500 },
    ]);
  });

  it("counts a goal streak of consecutive closed months", () => {
    const st = lifetimeStats(makeState({
      items: [["2024-12-03", 300000], ["2025-01-03", 100000], ["2025-02-03", 150000], ["2025-03-03", 999999]],
    }), NOW);
    assert.equal(st.streak, 2); // Jan + Feb hit the goal, Dec did not
    assert.equal(st.totalSaved, 0 + 150000 + 100000);
    assert.equal(st.avgSpend, Math.round((300000 + 100000 + 150000) / 3));
  });
});

describe("buildInsights", () => {
  it("asks for setup when no income is set", () => {
    const [first] = buildInsights(makeState({ income: 0 }), "2025-03", NOW, money);
    assert.equal(first.action, "plan");
  });

  it("puts limit and budget overruns first", () => {
    const list = buildInsights(makeState({
      items: [["2025-03-05", 210000, "dining"]], limits: { dining: 20000 },
    }), "2025-03", NOW, money);
    assert.equal(list[0].tone, "bad");
    assert.match(list[0].title, /Dining out/);
    assert.equal(list[1].title, "Over budget");
  });

  it("warns when the current pace overshoots the budget", () => {
    const list = buildInsights(makeState({ items: [["2025-03-10", 150000, "shopping"]] }), "2025-03", NOW, money);
    assert.ok(list.some((i) => i.title === "Spending is running hot"));
  });

  it("celebrates when everything is on track", () => {
    const list = buildInsights(makeState({ items: [["2025-03-10", 1000, "groceries"]] }), "2025-03", NOW, money);
    assert.equal(list.at(-1).tone, "good");
  });
});
