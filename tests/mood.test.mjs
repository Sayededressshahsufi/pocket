import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMoney } from "../js/money.js";
import { computeMood } from "../js/mood.js";
import { createPrefs } from "../js/prefs.js";
import { defaultState } from "../js/store.js";

const money = createMoney("USD", "en-US");
const NOW = new Date(2025, 2, 13, 12); // Thu 13 March: day 13 of 31, 19 days left

const rent = (day = 1) => ({ id: "rent", name: "Rent", amount: 150000, category: "housing", day, variable: false, actuals: {}, updatedAt: 0 });

/** Monthly income $4,000, goal $500, rent $1,500 => flexible budget $2,000. */
function makeState({ items = [], bills = [rent()], limits = {}, balance = null, income = 400000, goal = 50000 } = {}) {
  const s = defaultState();
  s.settings.income = income;
  s.settings.goal = goal;
  s.recurring = bills;
  s.limits = limits;
  s.items = items.map(([date, amount, category = "groceries"], i) => ({
    id: `i${i}`, date, amount, category, note: "", createdAt: i + 1, updatedAt: i + 1,
  }));
  if (balance) s.balances = [{ id: "b", amount: balance[0], date: balance[1], at: 1, updatedAt: 1 }];
  return s;
}

const THREE_SMALL = [["2025-03-02", 15000], ["2025-03-05", 15000], ["2025-03-09", 10000]]; // $400 so far

describe("green: doing well", () => {
  const mood = computeMood(makeState({ items: THREE_SMALL }), NOW, money);

  it("is good with no problems and real wins", () => {
    assert.equal(mood.state, "good");
    assert.equal(mood.problems.length, 0);
    assert.ok(mood.wins.some((w) => w.key === "pace"));
    assert.match(mood.wins.find((w) => w.key === "pace").title, /\$\d+ under pace/);
  });

  it("celebrates once there's some activity", () => {
    assert.equal(mood.celebrate, true);
    const oneItem = computeMood(makeState({ items: [["2025-03-02", 1000]] }), NOW, money);
    assert.equal(oneItem.state, "good");
    assert.equal(oneItem.celebrate, false);
  });

  it("uses a stable headline for the same day, and the user's name when known", () => {
    assert.equal(mood.headline, computeMood(makeState({ items: THREE_SMALL }), NOW, money).headline);
    const named = new Set(Array.from({ length: 12 }, (_, d) =>
      computeMood(makeState({ items: THREE_SMALL }), new Date(2025, 2, d + 1, 12), money, { name: "Sam" }).headline));
    assert.ok([...named].some((h) => h.includes("Sam")));
  });
});

describe("yellow: keep an eye on it", () => {
  it("a category near its limit turns the month yellow", () => {
    const mood = computeMood(makeState({
      items: [["2025-03-02", 20000], ["2025-03-05", 10000], ["2025-03-09", 6000]],
      limits: { groceries: 40000 }, // $360 of $400 = 90%
    }), NOW, money);
    assert.equal(mood.state, "watch");
    assert.equal(mood.problems[0].key, "limit:groceries");
    assert.match(mood.problems[0].title, /almost at its limit/);
    assert.match(mood.problems[0].fix, /\$40 is left, about \$2 a day/);
  });

  it("a single category over its limit is yellow, not red", () => {
    const mood = computeMood(makeState({ items: THREE_SMALL, limits: { groceries: 30000 } }), NOW, money);
    assert.equal(mood.state, "watch");
    assert.match(mood.problems[0].title, /Groceries is over its limit/);
    assert.match(mood.problems[0].text, /\$100 over/);
  });

  it("spending faster than an even pace is yellow, with a daily target", () => {
    const mood = computeMood(makeState({ items: [["2025-03-02", 60000], ["2025-03-05", 50000], ["2025-03-09", 40000]] }), NOW, money);
    assert.equal(mood.state, "watch"); // $1,500 spent vs $839 even pace, projected over budget
    const p = mood.problems.find((x) => x.key === "pace");
    assert.ok(p);
    assert.match(p.fix, /a day for the rest of the month/);
  });

  it("bills creeping up is yellow and names the biggest jump", () => {
    const gas = { id: "gas", name: "Columbia Gas", amount: 8000, category: "bills", day: 5, variable: true, actuals: { "2025-02": 8000, "2025-03": 12000 }, updatedAt: 0 };
    const mood = computeMood(makeState({ items: THREE_SMALL, bills: [rent(), gas] }), NOW, money);
    assert.equal(mood.state, "watch");
    const b = mood.problems.find((x) => x.key === "bills");
    assert.match(b.text, /Up \$40 overall\. Biggest jump: Columbia Gas/);
  });
});

describe("red: needs action", () => {
  it("being over budget is red and points at the biggest spend", () => {
    const mood = computeMood(makeState({ items: [["2025-03-02", 100000, "shopping"], ["2025-03-05", 110000, "dining"]] }), NOW, money);
    assert.equal(mood.state, "alert");
    const over = mood.problems[0];
    assert.equal(over.key, "over");
    assert.equal(over.title, "You're $100 over budget");
    assert.match(over.fix, /Dining out is your biggest spend \(\$1,100\)/);
    assert.equal(mood.celebrate, false);
  });

  it("doesn't repeat the same shortfall as a separate savings problem", () => {
    const mood = computeMood(makeState({ items: [["2025-03-02", 100000], ["2025-03-05", 110000]] }), NOW, money);
    assert.equal(mood.problems.some((p) => p.key === "savings"), false);
  });

  it("a plan with no room to spend is red", () => {
    const mood = computeMood(makeState({ items: THREE_SMALL, bills: [{ ...rent(), amount: 360000 }] }), NOW, money);
    assert.equal(mood.state, "alert");
    assert.equal(mood.problems[0].key, "plan");
  });

  it("a bank balance that can't cover upcoming bills is red", () => {
    const mood = computeMood(makeState({ items: THREE_SMALL, bills: [rent(28)], balance: [100000, "2025-03-13"] }), NOW, money);
    assert.equal(mood.state, "alert");
    const bank = mood.problems.find((p) => p.key === "bank");
    assert.match(bank.text, /\$500 short/);
    assert.equal(bank.action.kind, "balance");
  });

  it("two alerts at once is red even when neither is a core problem", () => {
    const mood = computeMood(makeState({
      items: [["2025-03-02", 5000, "dining"], ["2025-03-05", 5000, "dining"], ["2025-03-09", 5000, "fun"]],
      limits: { dining: 5000, fun: 2000 },
    }), NOW, money);
    assert.equal(mood.state, "alert");
  });

  it("sorts the worst problem first and gives every problem a fix", () => {
    const mood = computeMood(makeState({
      items: [["2025-03-02", 100000, "shopping"], ["2025-03-05", 110000, "dining"]], limits: { dining: 50000 },
    }), NOW, money);
    assert.equal(mood.problems[0].state, "alert");
    assert.ok(mood.problems.every((p) => p.title && p.text && p.fix));
  });
});

describe("neutral and edge cases", () => {
  it("has no mood without a plan or without any activity", () => {
    assert.equal(computeMood(makeState({ income: 0 }), NOW, money).state, "none");
    assert.equal(computeMood(makeState(), NOW, money).state, "none");
  });

  it("a stale bank check is a to-do, not a color change", () => {
    const mood = computeMood(makeState({ items: THREE_SMALL, balance: [800000, "2025-02-20"] }), NOW, money);
    assert.equal(mood.state, "good");
    assert.equal(mood.problems.length, 1);
    assert.equal(mood.problems[0].key, "check");
    assert.equal(mood.problems[0].affects, false);
  });

  it("only celebrates things that are true", () => {
    const mood = computeMood(makeState({ items: [["2025-03-02", 100000], ["2025-03-05", 110000]] }), NOW, money);
    assert.equal(mood.wins.some((w) => w.key === "pace" || w.key === "savings"), false);
  });
});

describe("per-device preferences", () => {
  const memory = (seed) => {
    const map = new Map(seed ? [["pocket:ui", seed]] : []);
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
  };

  it("defaults to everything on and survives corrupt data", () => {
    assert.deepEqual(createPrefs(memory()).get(), { mood: true, celebrate: true, lastMood: "", celebratedOn: "" });
    assert.equal(createPrefs(memory("{oops")).get().mood, true);
  });

  it("saves changes and rejects junk values", () => {
    const store = memory();
    const prefs = createPrefs(store);
    prefs.set({ mood: false, lastMood: "good", celebratedOn: "2025-03-13" });
    prefs.set({ lastMood: "purple", celebratedOn: "yesterday" });
    assert.deepEqual(createPrefs(store).get(), { mood: false, celebrate: true, lastMood: "", celebratedOn: "" });
  });
});
