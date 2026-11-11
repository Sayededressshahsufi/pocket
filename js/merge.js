/**
 * Conflict-free merge of two copies of the budget (this phone + the server).
 *
 * - Records (expenses, paychecks, bills, balances) merge one by one: the most
 *   recently edited version of each id wins, so two people adding things at
 *   the same time never overwrite each other.
 * - A deletion wins over any edit made before it.
 * - Shared settings (pay, goal, limits, currency) are taken from whichever
 *   copy changed them most recently. Theme always stays per-device.
 */
import { COLLECTIONS } from "./store.js";

const newer = (a, b) => {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b; // deterministic tie-break
};

const order = (a, b) =>
  (a.createdAt ?? a.at ?? 0) - (b.createdAt ?? b.at ?? 0) || String(a.id).localeCompare(String(b.id));

/** @param local this device's state  @param remote the server's state (both normalized) */
export function mergeStates(local, remote) {
  const deleted = { ...local.deleted };
  for (const [id, ts] of Object.entries(remote.deleted ?? {})) {
    if (!(deleted[id] >= ts)) deleted[id] = ts;
  }

  const shared = (remote.settingsAt ?? 0) > (local.settingsAt ?? 0) ? remote : local;
  const out = {
    version: local.version,
    onboarded: local.onboarded || remote.onboarded,
    settings: { ...shared.settings, theme: local.settings.theme },
    settingsAt: Math.max(local.settingsAt ?? 0, remote.settingsAt ?? 0),
    limits: shared.limits,
    deleted,
  };

  for (const key of COLLECTIONS) {
    const byId = new Map();
    for (const r of [...(local[key] ?? []), ...(remote[key] ?? [])]) {
      const cur = byId.get(r.id);
      byId.set(r.id, cur ? newer(cur, r) : r);
    }
    out[key] = [...byId.values()].filter((r) => !(deleted[r.id] >= r.updatedAt)).sort(order);
  }
  return out;
}

/** Compare shared content (ignores per-device theme and record order). */
export function sameData(a, b) {
  const canon = (s) => JSON.stringify({
    onboarded: s.onboarded,
    settings: { ...s.settings, theme: null },
    settingsAt: s.settingsAt,
    limits: s.limits,
    deleted: Object.keys(s.deleted ?? {}).sort().map((k) => [k, s.deleted[k]]),
    ...Object.fromEntries(COLLECTIONS.map((k) => [k, [...(s[k] ?? [])].sort(order)])),
  });
  return canon(a) === canon(b);
}
