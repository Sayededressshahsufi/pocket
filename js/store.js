/**
 * Persistence layer. All reads go through `normalize`, so anything loaded from
 * storage or an imported backup is validated before the UI ever sees it.
 */
import { isCategory, LEGACY_NAMES } from "./categories.js";
import { isISODate } from "./dates.js";

export const STORAGE_KEY = "pocket:v2";
export const LEGACY_KEY = "myMoneyApp.v1";
export const SCHEMA_VERSION = 2;
const THEMES = ["system", "light", "dark"];

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const FREQUENCIES = ["weekly", "biweekly", "monthly"];

export function defaultPay() {
  return { frequency: "monthly", amount: 0, weekday: 5, anchor: "" };
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    onboarded: false,
    settings: { currency: "USD", income: 0, goal: 0, theme: "system", pay: defaultPay() },
    limits: {},
    recurring: [],
    items: [],
    paychecks: [],
    balances: [],
  };
}

const cents = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1e11) : 0;
};
const categoryId = (v) => (isCategory(v) ? v : LEGACY_NAMES[v] ?? "other");
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const day = (v) => Math.min(31, Math.max(1, Math.trunc(Number(v)) || 1));

function normalizeItem(raw) {
  if (!raw || !isISODate(raw.date)) return null;
  const amount = cents(raw.amount);
  if (!amount) return null;
  return {
    id: String(raw.id ?? uid()),
    amount,
    category: categoryId(raw.category),
    note: text(raw.note, 80),
    date: raw.date,
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function normalizePay(raw) {
  const p = raw ?? {};
  const weekday = Math.trunc(Number(p.weekday));
  return {
    frequency: FREQUENCIES.includes(p.frequency) ? p.frequency : "monthly",
    amount: cents(p.amount),
    weekday: weekday >= 0 && weekday <= 6 ? weekday : 5,
    anchor: isISODate(p.anchor) ? p.anchor : "",
  };
}

function normalizePaycheck(raw) {
  if (!raw || !isISODate(raw.date)) return null;
  const amount = cents(raw.amount);
  if (!amount) return null;
  return {
    id: String(raw.id ?? uid()),
    amount,
    note: text(raw.note, 80),
    date: raw.date,
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

/** Balances may be negative (overdrawn), so they use signed cents. */
function normalizeBalance(raw) {
  if (!raw || !isISODate(raw.date)) return null;
  const amount = Math.round(Number(raw.amount));
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e11) return null;
  return { id: String(raw.id ?? uid()), amount, date: raw.date, at: Number(raw.at) || Date.now() };
}

/** Actual amounts for variable bills, keyed by "YYYY-MM". */
function normalizeActuals(raw) {
  const out = {};
  for (const [ym, v] of Object.entries(raw ?? {})) {
    const c = cents(v);
    if (c && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) out[ym] = c;
  }
  return out;
}

function normalizeBill(raw) {
  if (!raw) return null;
  const amount = cents(raw.amount); // fixed amount, or the estimate for variable bills
  if (!amount) return null;
  return {
    id: String(raw.id ?? uid()),
    name: text(raw.name, 40) || "Bill",
    amount,
    category: categoryId(raw.category ?? "bills"),
    day: day(raw.day),
    variable: Boolean(raw.variable),
    actuals: normalizeActuals(raw.actuals),
  };
}

function normalizeLimits(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const c = cents(v);
    if (c && isCategory(k)) out[k] = c;
  }
  return out;
}

/** v1 stored dollars as floats and category display names. */
function fromV1(raw) {
  if (!Array.isArray(raw.items)) return defaultState();
  const toC = (v) => Math.round((Number(v) || 0) * 100);
  const limits = {};
  for (const [name, v] of Object.entries(raw.limits ?? {})) {
    const id = categoryId(name);
    limits[id] = (limits[id] || 0) + toC(v);
  }
  return normalize({
    version: SCHEMA_VERSION,
    onboarded: toC(raw.income) > 0,
    settings: { currency: "USD", income: toC(raw.income), goal: toC(raw.goal), theme: "system" },
    limits,
    recurring: [],
    items: raw.items.map((i) => i && {
      id: i.id, amount: toC(i.amount), category: i.cat, note: i.note, date: i.date, createdAt: Number(i.id) || undefined,
    }),
  });
}

export function normalize(raw) {
  if (!raw || typeof raw !== "object") return defaultState();
  if (raw.version !== SCHEMA_VERSION) return fromV1(raw);
  const s = raw.settings ?? {};
  return {
    version: SCHEMA_VERSION,
    onboarded: Boolean(raw.onboarded),
    settings: {
      currency: typeof s.currency === "string" && /^[A-Z]{3}$/.test(s.currency) ? s.currency : "USD",
      income: cents(s.income),
      goal: cents(s.goal),
      theme: THEMES.includes(s.theme) ? s.theme : "system",
      pay: normalizePay(s.pay),
    },
    limits: normalizeLimits(raw.limits),
    recurring: Array.isArray(raw.recurring) ? raw.recurring.map(normalizeBill).filter(Boolean) : [],
    items: Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : [],
    paychecks: Array.isArray(raw.paychecks) ? raw.paychecks.map(normalizePaycheck).filter(Boolean) : [],
    balances: Array.isArray(raw.balances) ? raw.balances.map(normalizeBalance).filter(Boolean).slice(-300) : [],
  };
}

export function createStore(storage = globalThis.localStorage) {
  const listeners = new Set();
  let state = load();

  function load() {
    try {
      const current = storage.getItem(STORAGE_KEY);
      if (current) return normalize(JSON.parse(current));
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy) return normalize(JSON.parse(legacy));
    } catch {
      /* Corrupt JSON: fall through to a fresh state rather than crash. */
    }
    return defaultState();
  }

  function commit(next) {
    state = normalize(next);
    let saved = true;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      saved = false; // quota exceeded or private mode
    }
    listeners.forEach((fn) => fn(state));
    return saved;
  }

  return {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Mutate a deep copy, then validate and persist it. */
    update(mutator) {
      const draft = structuredClone(state);
      mutator(draft);
      return commit(draft);
    },
    replace: (next) => commit(next),
    reset: () => commit(defaultState()),
    serialize: () =>
      JSON.stringify({ app: "pocket", exportedAt: new Date().toISOString(), ...state }, null, 2),
  };
}
