import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeStates, sameData } from "../js/merge.js";
import { createStore, defaultState, normalize, stampChanges } from "../js/store.js";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}
const item = (id, amount, updatedAt, extra = {}) => ({
  id, amount, category: "groceries", note: "", date: "2025-03-01", createdAt: 1, updatedAt, ...extra,
});
const stateWith = (patch) => normalize({ ...defaultState(), ...patch });

describe("stampChanges", () => {
  it("stamps new and edited records, tombstones removed ones", () => {
    const prev = stateWith({ items: [item("a", 100, 5), item("b", 200, 5)] });
    const next = stateWith({ items: [item("a", 150, 5), item("c", 300, 5)] });
    stampChanges(prev, next, 99);
    assert.deepEqual(next.items.map((i) => [i.id, i.updatedAt]), [["a", 99], ["c", 99]]);
    assert.deepEqual(next.deleted, { b: 99 });
  });

  it("leaves untouched records alone", () => {
    const prev = stateWith({ items: [item("a", 100, 5)] });
    const next = stateWith({ items: [item("a", 100, 5)] });
    stampChanges(prev, next, 99);
    assert.equal(next.items[0].updatedAt, 5);
    assert.equal(next.settingsAt, 0);
  });

  it("clears the tombstone when a deleted record comes back (undo)", () => {
    const prev = stateWith({ deleted: { a: Date.now() - 10 } });
    const next = stateWith({ items: [item("a", 100, 5)], deleted: { a: Date.now() - 10 } });
    stampChanges(prev, next, Date.now());
    assert.deepEqual(next.deleted, {});
  });

  it("stamps shared settings but not the theme", () => {
    const prev = stateWith({});
    const themeOnly = stateWith({ settings: { ...prev.settings, theme: "dark" } });
    assert.equal(stampChanges(prev, themeOnly, 50).settingsAt, 0);
    const goal = stateWith({ settings: { ...prev.settings, goal: 40000 } });
    assert.equal(stampChanges(prev, goal, 50).settingsAt, 50);
  });

  it("is applied automatically by store.update", () => {
    const store = createStore(memoryStorage());
    store.update((s) => { s.items.push(item("x", 100, 0)); });
    assert.ok(store.state.items[0].updatedAt > 0);
    store.update((s) => { s.items = []; });
    assert.ok(store.state.deleted.x > 0);
  });

  it("does not stamp a local reset (so it can't wipe a shared budget)", () => {
    const store = createStore(memoryStorage());
    store.update((s) => { s.items.push(item("x", 100, 0)); });
    store.reset();
    assert.deepEqual(store.state.deleted, {});
  });
});

describe("mergeStates", () => {
  it("keeps everything both people added", () => {
    const mine = stateWith({ items: [item("a", 100, 10)] });
    const hers = stateWith({ items: [item("b", 200, 11)] });
    assert.deepEqual(mergeStates(mine, hers).items.map((i) => i.id).sort(), ["a", "b"]);
  });

  it("takes the most recent edit of the same record", () => {
    const mine = stateWith({ items: [item("a", 100, 10)] });
    const hers = stateWith({ items: [item("a", 999, 20)] });
    assert.equal(mergeStates(mine, hers).items[0].amount, 999);
    assert.equal(mergeStates(hers, mine).items[0].amount, 999);
  });

  it("lets a delete win over older edits, but not newer ones", () => {
    const mine = stateWith({ items: [item("a", 100, 10)] });
    const deletedLater = stateWith({ deleted: { a: Date.now() } });
    assert.equal(mergeStates(mine, deletedLater).items.length, 0);
    const editedAfter = stateWith({ items: [item("a", 100, Date.now() + 1000)] });
    const deletedBefore = stateWith({ deleted: { a: Date.now() - 1000 } });
    assert.equal(mergeStates(editedAfter, deletedBefore).items.length, 1);
  });

  it("takes newer shared settings but always keeps this device's theme", () => {
    const mine = stateWith({ settings: { ...defaultState().settings, goal: 100, theme: "dark" }, settingsAt: 10 });
    const hers = stateWith({ settings: { ...defaultState().settings, goal: 500, theme: "light" }, settingsAt: 20 });
    const m = mergeStates(mine, hers);
    assert.equal(m.settings.goal, 500);
    assert.equal(m.settings.theme, "dark");
    assert.equal(m.settingsAt, 20);
  });

  it("is order-independent for shared data", () => {
    const a = stateWith({ items: [item("a", 1, 3), item("c", 3, 9)], deleted: { z: Date.now() } });
    const b = stateWith({ items: [item("b", 2, 4), item("c", 4, 8)], settingsAt: 5 });
    assert.ok(sameData(mergeStates(a, b), mergeStates(b, a)));
  });

  it("is idempotent", () => {
    const a = stateWith({ items: [item("a", 1, 3)] });
    const b = stateWith({ items: [item("b", 2, 4)] });
    const once = mergeStates(a, b);
    assert.ok(sameData(mergeStates(once, b), once));
  });

  it("survives normalize round-trips (what the server stores)", () => {
    const a = stateWith({ items: [item("a", 1, 3)], paychecks: [{ id: "p", amount: 5, date: "2025-03-07", createdAt: 1, updatedAt: 2 }] });
    const m = mergeStates(a, normalize(JSON.parse(JSON.stringify(a))));
    assert.ok(sameData(normalize(m), a));
  });
});
