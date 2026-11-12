import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billComparisons, byWeekday, canAfford, savingsForecast, smallPurchases, spendingCalendar, topPlaces, weekStart,
  weeklySummary, yearView,
} from "../js/insights.js";
import { createMoney } from "../js/money.js";
import { defaultState } from "../js/store.js";
import * as voice from "../js/voice.js";

const money = createMoney("USD", "en-US");
const NOW = new Date(2025, 2, 13, 12); // Thu 13 March 2025

function makeState({ items = [], paychecks = [], bills = [], income = 400000, goal = 50000 } = {}) {
  const s = defaultState();
  s.settings.income = income;
  s.settings.goal = goal;
  s.items = items.map(([date, amount, category = "groceries", note = ""], i) => ({ id: `i${i}`, date, amount, category, note, createdAt: i, updatedAt: i }));
  s.paychecks = paychecks.map(([date, amount], i) => ({ id: `p${i}`, date, amount, note: "", createdAt: i, updatedAt: i }));
  s.recurring = bills;
  return s;
}

describe("weekly summary", () => {
  it("starts weeks on Sunday", () => {
    assert.equal(weekStart("2025-03-13"), "2025-03-09");
    assert.equal(weekStart("2025-03-09"), "2025-03-09");
  });

  it("compares like-for-like with the same days last week", () => {
    const w = weeklySummary(makeState({
      items: [["2025-03-10", 3000, "dining", "Tacos"], ["2025-03-12", 5000], ["2025-03-03", 2000], ["2025-03-07", 9000]],
      paychecks: [["2025-03-07", 85000], ["2025-03-13", 85000]],
    }), NOW);
    assert.equal(w.elapsed, 5);
    assert.equal(w.spent, 8000);
    assert.equal(w.prevSameDays, 2000); // Sun 2 - Thu 6 March
    assert.equal(w.prevWeek, 11000);
    assert.equal(w.change, 6000);
    assert.equal(w.paidIn, 85000);
    assert.deepEqual(w.topCategory, { id: "groceries", amount: 5000 });
    assert.equal(w.biggest.amount, 5000);
  });

  it("writes a headline in the right direction", () => {
    const up = weeklySummary(makeState({ items: [["2025-03-10", 9000], ["2025-03-03", 1000]] }), NOW);
    assert.match(voice.weeklyHeadline(up, money, "s"), /\$80/);
    const down = weeklySummary(makeState({ items: [["2025-03-10", 1000], ["2025-03-03", 9000]] }), NOW);
    assert.match(voice.weeklyHeadline(down, money, "s"), /\$80/);
    assert.notEqual(voice.weeklyHeadline(up, money, "s"), voice.weeklyHeadline(down, money, "s"));
  });
});

describe("spending calendar", () => {
  it("buckets days against the even daily budget", () => {
    const cal = spendingCalendar(makeState({ items: [["2025-03-01", 1000], ["2025-03-02", 30000], ["2025-03-05", 6000]] }), "2025-03", NOW);
    // budget 350,000 / 31 days = ~11,290 a day
    assert.equal(cal.days.length, 31);
    assert.equal(cal.leadingBlanks, 6); // 1 March 2025 is a Saturday
    assert.deepEqual([cal.days[0].level, cal.days[1].level, cal.days[4].level, cal.days[2].level], [1, 4, 2, 0]);
    assert.equal(cal.days[12].today, true);
    assert.equal(cal.days[13].future, true);
    assert.equal(cal.noSpendDays, 10);
    assert.equal(cal.biggest.day, 2);
  });
});

describe("year view & forecast", () => {
  const s = makeState({ items: [["2025-01-05", 300000], ["2025-02-05", 250000], ["2025-03-05", 10000]], goal: 50000 });

  it("summarizes tracked months only", () => {
    const yv = yearView(s, 2025, NOW);
    assert.equal(yv.tracked, 3);
    assert.equal(yv.totalSaved, 100000 + 150000);
    assert.equal(yv.best.ym, "2025-02");
    assert.equal(yv.worst.ym, "2025-01");
    assert.equal(yv.months[5].hasData, false);
  });

  it("leaves a partial first month out of savings totals", () => {
    const started = makeState({ items: [["2025-01-20", 20000], ["2025-02-05", 250000]] });
    const yv = yearView(started, 2025, NOW);
    assert.equal(yv.months[0].partial, true);
    assert.equal(yv.totalSaved, 150000); // February only
    assert.equal(yv.worst.ym, "2025-02");
  });

  it("projects savings from closed months", () => {
    const f = savingsForecast(s, NOW);
    assert.equal(f.basis, "history");
    assert.equal(f.avgMonthly, 125000);
    assert.equal(f.yearEnd, 250000 + yearView(s, 2025, NOW).months[2].saved + 125000 * 9);
    assert.equal(f.vsGoal, 75000);
  });
});

describe("can I afford this?", () => {
  it("says yes when today's allowance covers it", () => {
    const r = canAfford(makeState(), 2000, NOW);
    assert.equal(r.verdict, "yes");
    assert.equal(voice.affordVerdict(r, money).title, "Go for it");
  });

  it("says tight when it costs days of allowance", () => {
    const r = canAfford(makeState(), 30000, NOW);
    assert.equal(r.verdict, "tight");
    assert.ok(r.newDaily < r.daily);
    assert.ok(r.days > 1);
  });

  it("says no when it would eat into savings", () => {
    const r = canAfford(makeState({ items: [["2025-03-02", 340000]] }), 20000, NOW);
    assert.equal(r.verdict, "no");
    assert.equal(r.reason, "savings");
    assert.equal(r.savingsHit, 10000);
  });

  it("says no when the bank can't cover upcoming bills", () => {
    const s = makeState({ bills: [{ id: "r", name: "Rent", amount: 150000, category: "housing", day: 28, variable: false, actuals: {}, updatedAt: 0 }] });
    s.balances = [{ id: "b", amount: 160000, date: "2025-03-13", at: 1, updatedAt: 1 }];
    const r = canAfford(s, 20000, NOW);
    assert.equal(r.verdict, "no");
    assert.equal(r.reason, "bank");
  });

  it("asks for a plan first", () => {
    assert.equal(canAfford(makeState({ income: 0 }), 100, NOW).verdict, "unknown");
  });
});

describe("habits", () => {
  it("finds the big spending weekday", () => {
    const items = [];
    for (let d = 1; d <= 13; d++) items.push([`2025-03-${String(d).padStart(2, "0")}`, d === 8 ? 20000 : 500]);
    items.push(["2025-02-22", 18000]); // also a Saturday
    const wd = byWeekday(makeState({ items }), NOW);
    assert.equal(wd.top, 6);
    assert.equal(wd.enough, true);
    assert.match(voice.weekdayLine(wd, money), /^Saturdays/);
  });

  it("groups places by note, ignoring case and auto-adjustments", () => {
    const places = topPlaces(makeState({ items: [
      ["2025-03-01", 5000, "groceries", "Trader Joe's"], ["2025-03-04", 3000, "groceries", "trader joe's"],
      ["2025-03-05", 9000, "other", "Unlogged spending (balance check)"], ["2025-03-06", 100, "dining", ""],
    ] }), "2025-03");
    assert.deepEqual(places, [{ name: "Trader Joe's", count: 2, total: 8000, category: "groceries" }]);
  });

  it("adds up small purchases", () => {
    const sp = smallPurchases(makeState({ items: [["2025-03-01", 450], ["2025-03-02", 899], ["2025-03-03", 650], ["2025-03-04", 5000]] }), "2025-03");
    assert.deepEqual([sp.count, sp.total, sp.yearly], [3, 1999, 23988]);
    assert.match(voice.smallLine(sp, money), /3 purchases under \$10/);
  });
});

describe("bills vs last month", () => {
  const bill = (id, name, amount, actuals, variable = true) => ({ id, name, amount, category: "bills", day: 10, variable, actuals, updatedAt: 0 });

  it("compares actuals and flags estimates", () => {
    const cmp = billComparisons(makeState({ bills: [
      bill("d", "Dominion Energy", 9500, { "2025-02": 11000, "2025-03": 13250, "2024-03": 12000 }),
      bill("g", "Columbia Gas", 8000, { "2025-02": 9000 }),
      bill("r", "Rent", 165000, {}, false),
    ] }), "2025-03", NOW);
    const [rent, dom, gas] = cmp.rows;
    assert.equal(rent.name, "Rent");
    assert.equal(rent.delta, 0);
    assert.deepEqual([dom.delta, dom.comparable, dom.lastYear], [2250, true, 12000]);
    assert.deepEqual([gas.estimated, gas.comparable], [true, false]);
    assert.equal(cmp.firmDelta, 2250);
    assert.equal(cmp.pending, 1);
    // Due on the 10th, already past on the 13th: still waiting on the amount.
    assert.match(voice.billLine(gas, "2025-03", money), /^Waiting on this month's bill/);
    const later = billComparisons(makeState({ bills: [{ ...bill("g", "Columbia Gas", 8000, {}), day: 20 }] }), "2025-03", NOW);
    assert.match(voice.billLine(later.rows[0], "2025-03", money), /^Due Mar 20\. Usually around \$80\./);
  });

  it("explains changes in plain words, with a seasonal nudge", () => {
    const cmp = billComparisons(makeState({ bills: [bill("d", "Dominion Energy", 9500, { "2025-01": 11000, "2025-02": 13250 })] }), "2025-02");
    assert.equal(voice.billLine(cmp.rows[0], "2025-02", money), "$22.50 higher than Jan (+20%). Cold weather usually does that.");
    const lower = billComparisons(makeState({ bills: [bill("g", "Columbia Gas", 9000, { "2025-03": 9000, "2025-04": 6000 })] }), "2025-04");
    assert.match(voice.billLine(lower.rows[0], "2025-04", money), /\$30\.00 lower than Mar \(\u221233%\)\. Mild weather pays off\./);
  });

  it("compares a newly entered amount with last month", () => {
    const b = { name: "Columbia Gas" };
    assert.equal(voice.billEntered(b, 9800, 8000, null, money, "2025-03"), "Columbia Gas: $98.00. That's $18.00 more than February.");
    assert.equal(voice.billEntered(b, 7000, 8000, null, money, "2025-03"), "Columbia Gas: $70.00. $10.00 less than February. Nice.");
  });
});
