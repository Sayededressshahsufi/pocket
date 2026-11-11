import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStore, defaultState, LEGACY_KEY, normalize, STORAGE_KEY } from "../js/store.js";

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

describe("normalize", () => {
  it("returns defaults for garbage", () => {
    assert.deepEqual(normalize(null), defaultState());
    assert.deepEqual(normalize("nope"), defaultState());
    assert.deepEqual(normalize({ version: 1 }), defaultState());
  });

  it("drops invalid items and coerces fields", () => {
    const s = normalize({
      version: 2,
      settings: { currency: "usd", income: -5, goal: "2500", theme: "neon" },
      limits: { dining: 1000, bogus: 50, fun: 0 },
      items: [
        { id: 1, amount: 1234, category: "dining", date: "2025-03-01", note: "  lunch  " },
        { amount: 0, category: "dining", date: "2025-03-01" },
        { amount: 100, category: "dining", date: "2025-02-31" },
        { amount: 100, category: "unknown", date: "2025-03-02" },
      ],
      recurring: [{ name: "", amount: 5000, day: 45 }, { name: "x", amount: 0 }],
    });
    assert.deepEqual(s.settings, {
      currency: "USD", income: 0, goal: 2500, theme: "system",
      pay: { frequency: "monthly", amount: 0, weekday: 5, anchor: "" },
    });
    assert.deepEqual(s.limits, { dining: 1000 });
    assert.equal(s.items.length, 2);
    assert.equal(s.items[0].note, "lunch");
    assert.equal(s.items[0].id, "1");
    assert.equal(s.items[1].category, "other");
    assert.deepEqual(s.recurring.map((b) => [b.name, b.day, b.category, b.variable]), [["Bill", 31, "bills", false]]);
  });

  it("keeps valid variable-bill actuals and drops bad ones", () => {
    const s = normalize({
      version: 2,
      recurring: [{ name: "Columbia Gas", amount: 8000, variable: 1, actuals: { "2025-01": 9123, "2025-13": 50, "2025-02": -4, nope: 10 } }],
    });
    assert.equal(s.recurring[0].variable, true);
    assert.deepEqual(s.recurring[0].actuals, { "2025-01": 9123 });
  });
});

describe("paychecks & balances", () => {
  it("validates pay schedule, paychecks and signed balances", () => {
    const s = normalize({
      version: 2,
      settings: { pay: { frequency: "weekly", amount: 85000, weekday: 9, anchor: "nope" } },
      paychecks: [{ amount: 85000, date: "2025-03-07", note: " ACME " }, { amount: -5, date: "2025-03-07" }],
      balances: [{ amount: -2500, date: "2025-03-07", at: 5 }, { amount: "x", date: "2025-03-07" }, { amount: 100, date: "bad" }],
    });
    assert.deepEqual(s.settings.pay, { frequency: "weekly", amount: 85000, weekday: 5, anchor: "" });
    assert.deepEqual(s.paychecks.map((p) => [p.amount, p.note]), [[85000, "ACME"]]);
    assert.deepEqual(s.balances.map((b) => [b.amount, b.at]), [[-2500, 5]]);
  });

  it("gives older saves an empty paycheck and balance history", () => {
    const s = normalize({ version: 2, items: [] });
    assert.deepEqual([s.paychecks, s.balances, s.settings.pay.frequency], [[], [], "monthly"]);
  });
});

describe("v1 migration", () => {
  it("converts dollars to cents and legacy category names", () => {
    const v1 = {
      income: 3000.5, goal: 300, limits: { "Eating out": 150.25 },
      items: [{ id: 1700000000000, amount: 12.34, cat: "Eating out", note: "Tacos", date: "2025-03-04" },
        { id: 2, amount: 0.1 + 0.2, cat: "Food", note: "", date: "2025-03-05" }],
    };
    const store = createStore(memoryStorage({ [LEGACY_KEY]: JSON.stringify(v1) }));
    const s = store.state;
    assert.equal(s.onboarded, true);
    assert.equal(s.settings.income, 300050);
    assert.equal(s.settings.goal, 30000);
    assert.deepEqual(s.limits, { dining: 15025 });
    assert.deepEqual(s.items.map((i) => [i.amount, i.category]), [[1234, "dining"], [30, "groceries"]]);
    assert.equal(s.items[0].createdAt, 1700000000000);
  });

  it("prefers v2 data over legacy data", () => {
    const v2 = { ...defaultState(), settings: { ...defaultState().settings, income: 1 } };
    const store = createStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(v2), [LEGACY_KEY]: JSON.stringify({ income: 9, items: [] }) }));
    assert.equal(store.state.settings.income, 1);
  });

  it("survives corrupt JSON", () => {
    const store = createStore(memoryStorage({ [STORAGE_KEY]: "{oops" }));
    assert.deepEqual(store.state, defaultState());
  });
});

describe("createStore", () => {
  it("persists updates, notifies subscribers and never mutates previous state", () => {
    const storage = memoryStorage();
    const store = createStore(storage);
    const before = store.state;
    let calls = 0;
    store.subscribe(() => calls++);
    store.update((s) => { s.settings.income = 5000; });
    assert.equal(calls, 1);
    assert.equal(before.settings.income, 0);
    assert.equal(JSON.parse(storage.dump()[STORAGE_KEY]).settings.income, 5000);
  });

  it("reports failed writes instead of throwing", () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    const store = createStore(storage);
    assert.equal(store.update((s) => { s.onboarded = true; }), false);
    assert.equal(store.state.onboarded, true);
  });

  it("round-trips through serialize", () => {
    const store = createStore(memoryStorage());
    store.update((s) => { s.items.push({ id: "a", amount: 500, category: "fun", note: "", date: "2025-01-01", createdAt: 1 }); });
    const copy = createStore(memoryStorage());
    copy.replace(JSON.parse(store.serialize()), { stamp: false });
    assert.deepEqual(copy.state, store.state);
  });
});
