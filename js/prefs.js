/**
 * Per-device preferences, kept separate from the budget data on purpose:
 * they never sync to a partner's phone and aren't part of backups.
 */
const KEY = "pocket:ui";
const MOODS = ["good", "watch", "alert"];

function sanitize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    mood: r.mood !== false, // mood colors on by default
    celebrate: r.celebrate !== false, // confetti on by default
    lastMood: MOODS.includes(r.lastMood) ? r.lastMood : "", // lets the next launch paint the right color before JS runs
    celebratedOn: /^\d{4}-\d{2}-\d{2}$/.test(r.celebratedOn) ? r.celebratedOn : "",
  };
}

export function createPrefs(storage = globalThis.localStorage) {
  let data;
  try {
    data = sanitize(JSON.parse(storage.getItem(KEY)));
  } catch {
    data = sanitize(null);
  }
  return {
    get: () => data,
    set(patch) {
      data = sanitize({ ...data, ...patch });
      try {
        storage.setItem(KEY, JSON.stringify(data));
      } catch {
        /* storage full or private mode: keep working in memory */
      }
      return data;
    },
  };
}
