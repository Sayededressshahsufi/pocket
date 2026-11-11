/**
 * Spending categories. `path` is a 24x24 stroke icon (lucide-style) so icons
 * render identically on every platform, unlike emoji.
 */
export const CATEGORIES = Object.freeze([
  { id: "groceries", name: "Groceries", color: "#34d399", path: "M3 4h2l2.2 10.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6.1M9.5 20.5h.01M17 20.5h.01" },
  { id: "dining", name: "Dining out", color: "#fb923c", path: "M7 3v7a2 2 0 0 0 2 2M11 3v7a2 2 0 0 1-2 2m0 0v9M17 21V3c-2 1.5-3 4-3 7v3h3" },
  { id: "transport", name: "Transport", color: "#fbbf24", path: "M5 16v-5l1.8-4.6A2 2 0 0 1 8.7 5h6.6a2 2 0 0 1 1.9 1.4L19 11v5M3 11h18M5 16h14M7 16v2.5M17 16v2.5M7.5 13.5h.01M16.5 13.5h.01" },
  { id: "housing", name: "Housing", color: "#a78bfa", path: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { id: "bills", name: "Utilities", color: "#60a5fa", path: "M13 2 4 14h7l-1 8 9-12h-7z" },
  { id: "subscriptions", name: "Subscriptions", color: "#2dd4bf", path: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" },
  { id: "shopping", name: "Shopping", color: "#f472b6", path: "M5 8h14l-1 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM9 8V6a3 3 0 0 1 6 0v2" },
  { id: "fun", name: "Entertainment", color: "#c084fc", path: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" },
  { id: "health", name: "Health", color: "#f87171", path: "M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" },
  { id: "debt", name: "Cards & loans", color: "#a3e635", path: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3 10h18M7 15h3" },
  { id: "other", name: "Other", color: "#94a3b8", path: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
]);

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Category names used by v1 of the app, mapped to current ids. */
export const LEGACY_NAMES = Object.freeze({
  Food: "groceries",
  "Eating out": "dining",
  Gas: "transport",
  Bills: "bills",
  Rent: "housing",
  Shopping: "shopping",
  Fun: "fun",
  Health: "health",
  Other: "other",
});

export const isCategory = (id) => BY_ID.has(id);
export const getCategory = (id) => BY_ID.get(id) ?? BY_ID.get("other");
