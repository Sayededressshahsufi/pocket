/**
 * Money is stored as integer cents everywhere to avoid floating point drift
 * (0.1 + 0.2 !== 0.3). Conversion happens only at the input/output edges.
 */
export const CURRENCIES = Object.freeze([
  "USD", "EUR", "GBP", "CAD", "AUD", "NZD", "INR", "JPY", "CHF", "SGD", "AED", "MXN", "BRL", "ZAR",
]);

export const MAX_INT_DIGITS = 7;

/** Parse user input ("1,234.56", "12,5", 12.5) into integer cents, exactly. */
export function toCents(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : 0;
  let s = String(value ?? "").trim().replace(/\s/g, "");
  if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", "."); // decimal comma
  s = s.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const m = s.match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[2] && !m[3])) return 0;
  const frac = (m[3] || "").padEnd(3, "0");
  const cents = parseInt(m[2] || "0", 10) * 100 + parseInt(frac.slice(0, 2), 10) + (Number(frac[2]) >= 5 ? 1 : 0);
  return m[1] ? -cents : cents;
}

/** Cents to a plain editable string: 1250 -> "12.50", 1200 -> "12". */
export function centsToInput(cents) {
  if (!cents) return "";
  const s = (cents / 100).toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** Keypad state machine. `value` is a plain "123.4" string. */
export function applyKey(value, key) {
  if (key === "back") return value.slice(0, -1);
  if (key === "clear") return "";
  if (key === ".") return value.includes(".") ? value : (value || "0") + ".";
  if (!/^\d$/.test(key)) return value;
  const [int, dec] = value.split(".");
  if (dec !== undefined) return dec.length >= 2 ? value : value + key;
  if (int === "0") return key === "0" ? value : key;
  if (int.length >= MAX_INT_DIGITS) return value;
  return value + key;
}

export function createMoney(currency = "USD", locale) {
  const full = new Intl.NumberFormat(locale, { style: "currency", currency });
  const whole = new Intl.NumberFormat(locale, {
    style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
  const symbol = full.formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  return {
    currency,
    symbol,
    /** $1,234.56 */
    format: (cents) => full.format(cents / 100),
    /** $1,235 */
    short: (cents) => whole.format(Math.round(cents / 100) || 0),
  };
}

export function currencyName(code) {
  try {
    return new Intl.DisplayNames(undefined, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}
