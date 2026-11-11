import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { daysInMonth, dayLabel, isISODate, ordinal, shiftYM } from "../js/dates.js";
import { applyKey, centsToInput, createMoney, toCents } from "../js/money.js";

describe("toCents", () => {
  const cases = [
    ["12.34", 1234], ["12.3", 1230], ["12", 1200], [".5", 50], ["1,234.56", 123456],
    ["12,5", 1250], ["$ 9.99", 999], ["1.005", 101], ["", 0], ["abc", 0], [0.1 + 0.2, 30], [NaN, 0],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => assert.equal(toCents(input), expected));
  }
});

describe("centsToInput", () => {
  it("drops trailing .00 and keeps meaningful decimals", () => {
    assert.equal(centsToInput(1200), "12");
    assert.equal(centsToInput(1250), "12.50");
    assert.equal(centsToInput(0), "");
  });
});

describe("applyKey", () => {
  const type = (keys) => keys.reduce((v, k) => applyKey(v, k), "");
  it("builds amounts", () => assert.equal(type(["1", "2", ".", "5", "0"]), "12.50"));
  it("caps decimals at two", () => assert.equal(type(["1", ".", "2", "3", "4"]), "1.23"));
  it("ignores a second decimal point", () => assert.equal(type(["1", ".", ".", "2"]), "1.2"));
  it("prefixes a bare decimal with zero", () => assert.equal(type(["."]), "0."));
  it("replaces a leading zero", () => assert.equal(type(["0", "0", "7"]), "7"));
  it("limits integer digits", () => assert.equal(type(Array(9).fill("9")), "9999999"));
  it("backspaces and clears", () => {
    assert.equal(applyKey("12.5", "back"), "12.");
    assert.equal(applyKey("", "back"), "");
    assert.equal(applyKey("12.5", "clear"), "");
  });
});

describe("createMoney", () => {
  it("formats cents", () => {
    const m = createMoney("USD", "en-US");
    assert.equal(m.format(123456), "$1,234.56");
    assert.equal(m.short(123456), "$1,235");
    assert.equal(m.short(-40), "$0");
    assert.equal(m.symbol, "$");
  });
});

describe("dates", () => {
  it("shifts months across years", () => {
    assert.equal(shiftYM("2025-01", -1), "2024-12");
    assert.equal(shiftYM("2024-12", 1), "2025-01");
    assert.equal(shiftYM("2025-03", -14), "2024-01");
  });
  it("knows leap years", () => {
    assert.equal(daysInMonth("2024-02"), 29);
    assert.equal(daysInMonth("2025-02"), 28);
  });
  it("validates real calendar dates", () => {
    assert.equal(isISODate("2024-02-29"), true);
    assert.equal(isISODate("2025-02-29"), false);
    assert.equal(isISODate("2025-3-1"), false);
  });
  it("labels relative days", () => {
    const now = new Date(2025, 2, 1, 9);
    assert.equal(dayLabel("2025-03-01", now), "Today");
    assert.equal(dayLabel("2025-02-28", now), "Yesterday");
  });
  it("formats ordinals", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal),
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "31st"]);
  });
});
