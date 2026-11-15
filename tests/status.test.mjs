import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balanceStatus, billStatus, budgetStatus, forecastStatus, limitStatus, paceStatus, savingsStatus, STATES, toneOf, weekStatus,
} from "../js/status.js";

describe("budget and limits", () => {
  it("is green with room, yellow near the edge, red when used up", () => {
    assert.equal(budgetStatus(0.4).state, STATES.good);
    assert.equal(budgetStatus(0.9).state, STATES.watch);
    assert.equal(budgetStatus(1.0).state, STATES.alert);
    assert.equal(budgetStatus(1.4).state, STATES.alert);
  });

  it("is grey when there is nothing to measure", () => {
    assert.equal(budgetStatus(null).state, STATES.none);
    assert.equal(limitStatus(5000, 0).state, STATES.none);
  });

  it("scores category limits by the share used", () => {
    assert.equal(limitStatus(9000, 10000).state, STATES.watch);
    assert.equal(limitStatus(12000, 10000).state, STATES.alert);
  });
});

describe("savings", () => {
  it("compares projected savings with the goal", () => {
    assert.equal(savingsStatus(40000, 40000).state, STATES.good);
    assert.equal(savingsStatus(30000, 40000).state, STATES.watch);
    assert.equal(savingsStatus(10000, 40000).state, STATES.alert);
    assert.equal(savingsStatus(-500, 40000).state, STATES.alert);
    assert.equal(savingsStatus(40000, 0).state, STATES.none);
  });

  it("forecast uses the same thresholds on the monthly average", () => {
    assert.equal(forecastStatus({ goal: 40000, avgMonthly: 84800 }).state, STATES.good);
    assert.equal(forecastStatus({ goal: 40000, avgMonthly: 26000 }).state, STATES.watch);
    assert.equal(forecastStatus({ goal: 40000, avgMonthly: -100 }).state, STATES.alert);
  });
});

describe("pace", () => {
  const base = { income: 340000, budget: 300000, left: 200000, phase: "current", projectedSpend: 250000, spent: 100000, idealSpend: 100000 };

  it("is red when over budget and green on pace", () => {
    assert.equal(paceStatus({ ...base, left: -5000 }).state, STATES.alert);
    assert.equal(paceStatus(base).state, STATES.good);
  });

  it("is yellow when projected to go over", () => {
    assert.equal(paceStatus({ ...base, projectedSpend: 330000 }).state, STATES.watch);
  });

  it("is grey without a plan or before the month starts", () => {
    assert.equal(paceStatus({ ...base, income: 0 }).state, STATES.none);
    assert.equal(paceStatus({ ...base, phase: "future" }).state, STATES.none);
  });
});

describe("bills", () => {
  it("is green when same or lower, yellow a little higher, red a lot higher", () => {
    assert.equal(billStatus({ comparable: true, estimated: false, delta: -500, pct: -0.1 }).state, STATES.good);
    assert.equal(billStatus({ comparable: true, estimated: false, delta: 800, pct: 0.1 }).state, STATES.watch);
    assert.equal(billStatus({ comparable: true, estimated: false, delta: 2250, pct: 0.26 }).state, STATES.alert);
  });

  it("stays grey while an amount is still pending", () => {
    assert.equal(billStatus({ estimated: true, comparable: false }).state, STATES.none);
  });
});

describe("balance and week", () => {
  it("balance turns red when upcoming bills exceed what's there", () => {
    assert.equal(balanceStatus({ afterBills: -100 }, false).state, STATES.alert);
    assert.equal(balanceStatus({ afterBills: 100 }, true).state, STATES.watch);
    assert.equal(balanceStatus({ afterBills: 100 }, false).state, STATES.good);
    assert.equal(balanceStatus(null, false).state, STATES.none);
  });

  it("week compares with last week", () => {
    assert.equal(weekStatus({ hadLastWeek: true, change: -500, prevSameDays: 4000, count: 3 }).state, STATES.good);
    assert.equal(weekStatus({ hadLastWeek: true, change: 1800, prevSameDays: 4000, count: 3 }).state, STATES.good); // noise
    assert.equal(weekStatus({ hadLastWeek: true, change: 8000, prevSameDays: 40000, count: 3 }).state, STATES.watch);
    assert.equal(weekStatus({ hadLastWeek: true, change: 12000, prevSameDays: 40000, count: 3 }).state, STATES.alert);
    assert.equal(weekStatus({ hadLastWeek: false, change: 0, prevSameDays: 0, count: 0 }).state, STATES.none);
  });

  it("maps each state to a color tone", () => {
    assert.equal(toneOf(budgetStatus(0.2)), "good");
    assert.equal(toneOf(budgetStatus(0.9)), "warn");
    assert.equal(toneOf(budgetStatus(1.2)), "bad");
    assert.equal(toneOf(budgetStatus(null)), "info");
  });
});
