/**
 * Pocket · app controller.
 * Connects the store to the views and handles routing, sheets and input.
 * Rendering is a pure function of (store.state, ui): any change re-renders
 * the active view.
 */
import { CATEGORIES, getCategory } from "./categories.js";
import {
  balanceEstimate, billAmount, billHistory, billsDue, buildInsights, compareMonths, fixedCosts,
  history as monthHistory, incomeFor, itemsInMonth, lastWeekday, lifetimeStats, needsBalanceCheck,
  paydayPending, paydaysIn, reconcile, summarize, sum,
} from "./budget.js";
import { renderBars, renderBurn, renderDonut, setRing } from "./charts.js";
import {
  currentYM, dayLabel, daysInMonth, lastDayOf, monthLabel, ordinal, parseISO, shiftYM, toISO, ymOf,
} from "./dates.js";
import { applyKey, centsToInput, createMoney, CURRENCIES, currencyName, toCents } from "./money.js";
import { createStore, uid } from "./store.js";
import {
  $, $$, createSheetController, createToast, enableDragToDismiss, h, haptic, icon, pathIcon, shake,
} from "./ui.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const store = createStore();
const toast = createToast($("#toast"));
const sheets = createSheetController($("#scrim"));
const DECIMAL = (1.1).toLocaleString().charAt(1);

const ui = { view: "home", ym: currentYM(), query: "", filter: null };
let money = createMoney(store.state.settings.currency);
let lastCategory = "groceries";

const VIEWS = {
  home: { title: "Overview", monthNav: true, render: renderHome },
  activity: { title: "Activity", monthNav: true, render: renderActivity },
  insights: { title: "Insights", monthNav: true, render: renderInsights },
  plan: { title: "Plan", monthNav: false, render: renderPlan },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toneFor = (ratio) => (ratio >= 1 ? "bad" : ratio >= 0.85 ? "warn" : "good");
const byNewest = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
const minus = (cents) => `\u2212${money.format(cents)}`;

function greeting(hour = new Date().getHours()) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------
function categoryBadge(id, cls = "badge") {
  const cat = getCategory(id);
  return h("span", { class: cls, style: { "--tint": cat.color } }, pathIcon(cat.path));
}

function meter(ratio) {
  return h("div", { class: "meter" },
    h("span", { class: "meter__fill", "data-tone": toneFor(ratio), style: { width: `${clamp(ratio, 0, 1) * 100}%` } }));
}

function emptyState(iconName, title, text) {
  return h("div", { class: "empty" },
    h("span", { class: "empty__icon" }, icon(iconName)),
    h("p", { class: "empty__title" }, title),
    text && h("p", {}, text));
}

function txRow(item, { showDate = true } = {}) {
  const cat = getCategory(item.category);
  const title = item.note || cat.name;
  return h("button", {
    class: "tx", type: "button",
    "aria-label": `${title}, ${money.format(item.amount)}, ${cat.name}, ${dayLabel(item.date)}. Edit`,
    onclick: () => openEntry(item),
  },
  categoryBadge(item.category),
  h("span", { class: "tx__body" },
    h("span", { class: "tx__title" }, title),
    h("span", { class: "tx__sub" }, showDate ? `${cat.name} · ${dayLabel(item.date)}` : cat.name)),
  h("span", { class: "tx__amount num" }, minus(item.amount)));
}

function incomeBadge() {
  return h("span", { class: "badge", style: { "--tint": "var(--good)" } }, icon("pay"));
}

function incomeRow(p, { showDate = true } = {}) {
  const title = p.note || "Paycheck";
  return h("button", {
    class: "tx", type: "button",
    "aria-label": `${title}, plus ${money.format(p.amount)}, ${dayLabel(p.date)}. Edit`,
    onclick: () => openEntry(p, { mode: "income" }),
  },
  incomeBadge(),
  h("span", { class: "tx__body" },
    h("span", { class: "tx__title" }, title),
    h("span", { class: "tx__sub" }, showDate ? `Income · ${dayLabel(p.date)}` : "Income")),
  h("span", { class: "tx__amount is-in num" }, `+${money.format(p.amount)}`));
}

/** Expenses and paychecks merged into one newest-first list of rows. */
function ledgerRows(items, paychecks, opts) {
  return [
    ...items.map((i) => ({ r: i, row: () => txRow(i, opts) })),
    ...paychecks.map((p) => ({ r: p, row: () => incomeRow(p, opts) })),
  ].sort((a, b) => byNewest(a.r, b.r)).map((x) => x.row());
}

function paydayCard(iso) {
  const { amount } = store.state.settings.pay;
  return h("div", { class: "due due--good" },
    incomeBadge(),
    h("div", { class: "due__body" },
      h("p", { class: "due__title" }, "Payday"),
      h("p", { class: "due__text" }, `${dayLabel(iso)} · did your ${money.short(amount)} paycheck arrive?`)),
    h("button", {
      class: "btn btn--primary btn--sm", type: "button",
      onclick: () => openEntry(null, { mode: "income", date: iso }),
    }, "Log it"));
}

function sinceLabel(days) {
  if (days <= 0) return "Checked today";
  if (days === 1) return "Checked yesterday";
  return `Checked ${days} days ago`;
}

function renderBalanceCard(now) {
  const card = $("#balanceCard");
  card.hidden = ui.ym !== currentYM(now);
  if (card.hidden) return;
  const state = store.state;
  const est = balanceEstimate(state, now);
  const head = (meta) => h("header", { class: "card__head" },
    h("h2", { id: "balanceTitle" }, "Bank balance"), meta && h("span", { class: "card__meta" }, meta));

  if (!est) {
    card.replaceChildren(
      head(),
      h("p", { class: "balance__intro" }, "Enter what's in your account and Pocket keeps a running total as you log paychecks, spending and bills."),
      h("button", { class: "btn btn--primary btn--block", type: "button", onclick: openBalance },
        icon("bank"), "Add my balance"));
    return;
  }

  const ask = needsBalanceCheck(state, now);
  const moved = est.paidIn > 0 || est.spent > 0 || est.bills > 0;
  const row = (label, value, cls) => h("div", {}, h("dt", {}, label), h("dd", { class: `num ${cls ?? ""}` }, value));
  card.replaceChildren(...[
    head(sinceLabel(est.daysSince)),
    ask && h("div", { class: "callout", role: "note" }, icon("alert"),
      h("span", {}, `It's been ${est.daysSince} days. Check your banking app and update your balance so the numbers stay accurate.`)),
    h("p", { class: "balance__label" }, moved ? "Estimated now" : "In your account"),
    h("p", { class: `balance__value num${est.estimate < 0 ? " is-negative" : ""}` }, money.format(est.estimate)),
    moved && h("dl", { class: "balance__rows" },
      row(`Balance ${dayLabel(est.last.date).toLowerCase() === "today" ? "earlier today" : `on ${dayLabel(est.last.date)}`}`, money.format(est.last.amount)),
      est.paidIn > 0 && row("Paychecks", `+${money.format(est.paidIn)}`, "is-in"),
      est.spent > 0 && row("Spending", minus(est.spent)),
      est.bills > 0 && row("Bills paid", minus(est.bills))),
    est.upcoming > 0 && h("div", { class: "balance__after" },
      h("span", {}, "After bills still due this month"),
      h("strong", { class: `num${est.afterBills < 0 ? " is-negative" : ""}` }, money.format(est.afterBills))),
    h("button", { class: `btn ${ask ? "btn--primary" : "btn--soft"} btn--block`, type: "button", onclick: openBalance },
      icon("bank"), "Update balance"),
  ].filter(Boolean)); // replaceChildren would print `false` as text
}

const INSIGHT_ICONS = { good: "check", warn: "trend-up", bad: "alert", info: "sparkle" };
function insightCard(ins) {
  return h(ins.action ? "a" : "div", {
    class: "insight", "data-tone": ins.tone, href: ins.action ? `#${ins.action}` : null,
  },
  h("span", { class: "insight__icon" }, icon(INSIGHT_ICONS[ins.tone])),
  h("div", {},
    h("p", { class: "insight__title" }, ins.title),
    h("p", { class: "insight__text" }, ins.text)));
}

function dueDateLabel(bill, ym) {
  const d = parseISO(`${ym}-01`);
  d.setDate(Math.min(bill.day, daysInMonth(ym)));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueCard(bill) {
  const { average } = billHistory(bill, ui.ym);
  const typical = average ? `usually ${money.short(average)}` : `estimate ${money.short(bill.amount)}`;
  return h("div", { class: "due" },
    categoryBadge(bill.category),
    h("div", { class: "due__body" },
      h("p", { class: "due__title" }, `${bill.name} bill`),
      h("p", { class: "due__text" }, `Due ${dueDateLabel(bill, ui.ym)} · ${typical}`)),
    h("button", {
      class: "btn btn--primary btn--sm", type: "button", "aria-label": `Enter ${bill.name} amount`,
      onclick: () => openPay(bill, ui.ym),
    }, "Enter"));
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function paceStatus(s) {
  if (!s.income) return { label: "No plan yet", tone: "neutral" };
  if (s.phase === "future") return { label: "Upcoming", tone: "neutral" };
  if (s.left < 0) return { label: "Over budget", tone: "bad" };
  if (s.phase === "past") return { label: "Under budget", tone: "good" };
  if (s.spent - s.idealSpend > s.budget * 0.05) return { label: "Above pace", tone: "warn" };
  return { label: "On track", tone: "good" };
}

function renderHome() {
  const now = new Date();
  const state = store.state;
  const s = summarize(state, ui.ym, now);

  // Hero
  const used = s.budget > 0 ? s.spent / s.budget : s.spent > 0 ? 1 : 0;
  const pace = paceStatus(s);
  $("#heroLeft").textContent = money.format(s.left);
  $("#heroLeft").classList.toggle("is-negative", s.left < 0);
  $("#paceBadge").textContent = pace.label;
  $("#paceBadge").dataset.tone = pace.tone;
  $("#heroFill").style.width = `${clamp(used, 0, 1) * 100}%`;
  $("#heroFill").dataset.tone = toneFor(used);
  $("#heroMeter").setAttribute("aria-valuenow", String(Math.round(clamp(used, 0, 1) * 100)));
  $("#heroMeter").setAttribute("aria-valuetext", `${money.short(s.spent)} of ${money.short(s.budget)} used`);
  const marker = $("#heroMarker");
  marker.hidden = !(s.phase === "current" && s.budget > 0);
  marker.style.left = `${(s.elapsed / s.dim) * 100}%`;
  $("#heroSpent").textContent = `${money.short(s.spent)} spent`;
  $("#heroBudget").textContent = `of ${money.short(s.budget)} budget`;
  $("#statToday").textContent = s.phase === "current" ? money.short(s.leftToday) : "–";
  $("#statDaily").textContent = s.daysLeft ? money.short(s.dailyAllowance) : "–";
  $("#statDays").textContent = String(s.daysLeft);

  // Things waiting on you: a paycheck to confirm, variable bills to fill in
  const payday = ui.ym === currentYM(now) ? paydayPending(state, now) : null;
  $("#billsDue").replaceChildren(
    ...(payday ? [paydayCard(payday)] : []),
    ...billsDue(state, ui.ym, now).map(dueCard));
  renderBalanceCard(now);

  // Coaching
  $("#insights").replaceChildren(...buildInsights(state, ui.ym, now, money).slice(0, 2).map(insightCard));

  // Savings
  const { goal } = state.settings;
  const saved = s.projectedSavings;
  setRing($("#ringFill"), goal > 0 ? saved / goal : 0);
  $("#ringPct").textContent = goal > 0 ? `${Math.round(clamp(saved / goal, 0, 1) * 100)}%` : "–";
  $("#saveLabel").textContent = s.phase === "past" ? "Saved this month" : "Projected this month";
  $("#saveProjected").textContent = money.short(saved);
  $("#saveProjected").classList.toggle("is-negative", saved < 0);
  $("#saveCaption").textContent = goal ? `Goal ${money.short(goal)}` : "";
  $("#saveNote").textContent = goal
    ? `Hit it every month and you'll have ${money.short(goal * 12)} in a year.`
    : "Set a savings goal in Plan.";

  // Pace chart
  renderBurn($("#burnChart"), {
    series: s.daily, budget: s.budget, dim: s.dim,
    emptyText: s.phase === "future" ? "This month hasn't started" : "No spending yet",
  });

  // Categories
  const spentCats = s.categories.filter((c) => c.amount > 0);
  renderDonut($("#donut"), spentCats.map((c) => ({
    value: c.amount, color: getCategory(c.id).color, label: `${getCategory(c.id).name}: ${money.format(c.amount)}`,
  })), { label: "Spent", value: money.short(s.spent) });

  $("#legend").replaceChildren(...(spentCats.length
    ? spentCats.slice(0, 5).map((c) => h("li", { class: "legend__item" },
      h("span", { class: "legend__swatch", style: { background: getCategory(c.id).color } }),
      h("span", { class: "legend__name" }, getCategory(c.id).name),
      h("span", { class: "legend__pct num" }, `${Math.round(c.share * 100)}%`)))
    : [h("li", { class: "legend__empty" }, "Nothing logged this month yet.")]));

  const limits = s.categories.filter((c) => c.limit > 0).map((c) => h("div", {},
    h("div", { class: "limit__head" },
      h("span", { class: "limit__name" }, categoryBadge(c.id, "badge badge--sm"), getCategory(c.id).name),
      h("span", { class: "limit__value num" }, money.short(c.amount), h("span", {}, ` / ${money.short(c.limit)}`))),
    meter(c.amount / c.limit)));
  $("#limits").replaceChildren(...limits);
  $("#limits").hidden = !limits.length;

  // Recent
  const recent = ledgerRows(itemsInMonth(state.items, ui.ym), itemsInMonth(state.paychecks, ui.ym)).slice(0, 5);
  $("#recent").replaceChildren(...(recent.length
    ? recent
    : [emptyState("receipt", "Nothing logged yet", "Tap + to add an expense or paycheck.")]));
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
const INCOME_FILTER = "__income";

function renderActivity() {
  const all = itemsInMonth(store.state.items, ui.ym);
  const allPay = itemsInMonth(store.state.paychecks, ui.ym);
  const used = [...new Set(all.map((i) => i.category))];
  if (ui.filter && ui.filter !== INCOME_FILTER && !used.includes(ui.filter)) ui.filter = null;
  if (ui.filter === INCOME_FILTER && !allPay.length) ui.filter = null;

  const q = ui.query.trim().toLowerCase();
  const items = ui.filter === INCOME_FILTER ? [] : all
    .filter((i) => !ui.filter || i.category === ui.filter)
    .filter((i) => !q || i.note.toLowerCase().includes(q) || getCategory(i.category).name.toLowerCase().includes(q));
  const pays = ui.filter && ui.filter !== INCOME_FILTER ? [] : allPay
    .filter((p) => !q || p.note.toLowerCase().includes(q) || "paycheck income".includes(q));

  $("#actTotal").textContent = money.format(sum(items));
  $("#actIncome").textContent = `+${money.format(sum(pays))}`;

  const chip = (id, label) => h("button", {
    class: "filter", type: "button", "aria-pressed": String(ui.filter === id),
    onclick: () => { ui.filter = id; renderActivity(); },
  }, label);
  $("#filters").replaceChildren(
    chip(null, "All"),
    ...(allPay.length ? [chip(INCOME_FILTER, "Paychecks")] : []),
    ...used.map((id) => chip(id, getCategory(id).name)));
  $("#filters").hidden = used.length + (allPay.length ? 1 : 0) < 2;

  if (!items.length && !pays.length) {
    $("#activityList").replaceChildren(q || ui.filter
      ? emptyState("search", "No matches", "Try a different search or filter.")
      : emptyState("receipt", "Nothing this month", "Expenses and paychecks you log will show up here."));
    return;
  }

  const days = [...new Set([...items, ...pays].map((r) => r.date))].sort().reverse();
  $("#activityList").replaceChildren(...days.map((date) => {
    const dayItems = items.filter((i) => i.date === date);
    const dayPays = pays.filter((p) => p.date === date);
    const totals = [
      dayPays.length && `+${money.format(sum(dayPays))}`,
      dayItems.length && minus(sum(dayItems)),
    ].filter(Boolean).join(" · ");
    return h("section", { class: "day-group" },
      h("header", { class: "day-group__head" }, h("h3", {}, dayLabel(date)), h("span", { class: "num" }, totals)),
      h("div", { class: "card card--flush tx-list" }, ledgerRows(dayItems, dayPays, { showDate: false })));
  }));
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
function renderInsights() {
  const state = store.state;
  const budget = summarize(state, ui.ym).budget;

  renderBars($("#barsChart"), monthHistory(state, ui.ym, 6).map((m) => ({
    label: monthLabel(m.ym, "short"),
    value: m.spent,
    current: m.ym === ui.ym,
    over: m.over,
    title: `${monthLabel(m.ym)}: ${money.format(m.spent)}`,
  })), { budget, format: money.short });

  const st = lifetimeStats(state);
  $("#stAvg").textContent = money.short(st.avgSpend);
  $("#stSaved").textContent = money.short(st.totalSaved);
  $("#stStreak").textContent = `${st.streak} ${st.streak === 1 ? "month" : "months"}`;
  $("#stTop").replaceChildren(...(st.topCategory
    ? [categoryBadge(st.topCategory, "badge badge--sm"), getCategory(st.topCategory).name]
    : ["–"]));

  const prevYM = shiftYM(ui.ym, -1);
  $("#cmpCaption").textContent = `${monthLabel(ui.ym, "short")} vs ${monthLabel(prevYM, "short")}`;
  const rows = compareMonths(state, ui.ym);
  $("#compare").replaceChildren(...(rows.length ? rows.map((r) => {
    let dir = "flat", label = "Same";
    if (!r.previous) { dir = "up"; label = "New"; }
    else if (r.current !== r.previous) {
      const pct = Math.round(((r.current - r.previous) / r.previous) * 100);
      dir = pct > 0 ? "up" : "down";
      label = pct === 0 ? "≈0%" : `${pct > 0 ? "+" : "\u2212"}${Math.abs(pct)}%`;
    }
    return h("li", { class: "compare__row" },
      categoryBadge(r.id),
      h("span", { class: "compare__name" },
        h("b", {}, getCategory(r.id).name),
        h("small", { class: "num" }, `${money.short(r.previous)} last month`)),
      h("span", { class: "compare__amount num" }, money.short(r.current)),
      h("span", { class: "delta num", "data-dir": dir }, label));
  }) : [emptyState("chart", "Not enough data", "Log a few weeks of spending to see trends.")]));
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
function setMoneyInput(input, cents) {
  if (document.activeElement !== input) input.value = centsToInput(cents);
}

function renderPlan() {
  const { settings, limits, recurring } = store.state;
  const { pay } = settings;
  const cur = currentYM();
  const monthIncome = incomeFor(store.state, cur);

  // Pay schedule
  for (const btn of $$("[data-freq]", $("#payFreq"))) btn.setAttribute("aria-checked", String(btn.dataset.freq === pay.frequency));
  $("#incomeField").hidden = pay.frequency !== "monthly";
  $("#paycheckFields").hidden = pay.frequency === "monthly";
  $("#paydayField").hidden = pay.frequency !== "weekly";
  $("#anchorField").hidden = pay.frequency !== "biweekly";
  setMoneyInput($("#income"), settings.income);
  setMoneyInput($("#paycheck"), pay.amount);
  $("#payday").value = String(pay.weekday);
  if (document.activeElement !== $("#payAnchor")) $("#payAnchor").value = pay.anchor;
  const paydays = paydaysIn(pay, cur).length;
  const logged = itemsInMonth(store.state.paychecks, cur).length;
  $("#payHint").textContent = pay.frequency === "monthly" ? "" : pay.amount
    ? `${monthLabel(cur, "short")} has ${paydays} paydays. ${logged} logged so far; the rest are estimated at ${money.short(pay.amount)} until you log them.`
    : "Enter a typical paycheck so Pocket can estimate the month. Log each paycheck as it arrives.";

  setMoneyInput($("#goal"), settings.goal);
  for (const input of $$("#limitFields input")) setMoneyInput(input, limits[input.dataset.category] || 0);

  // Goal suggestion (20% rule of thumb)
  const suggested = Math.round((monthIncome * 0.2) / 100) * 100;
  $("#goalHint").replaceChildren(...(monthIncome && suggested !== settings.goal
    ? ["A common target is 20% of income. ", h("button", {
      class: "text-btn", type: "button",
      onclick: () => { store.update((s) => { s.settings.goal = suggested; }); toast("Savings goal updated"); },
    }, `Use ${money.short(suggested)}`)]
    : []));

  // Plan math (this month)
  const fixed = fixedCosts(store.state, cur);
  const flex = monthIncome - fixed - settings.goal;
  const row = (label, value, cls) => h("div", { class: cls }, h("dt", {}, label), h("dd", { class: "num" }, value));
  $("#equation").replaceChildren(
    row(pay.frequency === "monthly" ? "Income" : `Income · ${paydays} paychecks`, money.format(monthIncome)),
    row("Fixed bills", minus(fixed)),
    row("Savings goal", minus(settings.goal)),
    row("Flexible budget", money.format(flex), `equation__total${flex < 0 ? " is-short" : ""}`),
    ...(flex < 0 ? [h("p", { class: "equation__note" }, `Your plan is ${money.short(-flex)} short. Lower your goal or trim a bill.`)] : []),
  );

  // Bills
  const bills = [...recurring].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  $("#bills").replaceChildren(...(bills.length
    ? bills.map((b) => {
      const amount = billAmount(b, cur);
      const entered = Boolean(b.actuals[cur]);
      const sub = b.variable
        ? [`Varies · ${ordinal(b.day)} · `, entered ? `${monthLabel(cur, "short")} entered` : h("span", { class: "tag" }, "estimate")]
        : [`Monthly · ${ordinal(b.day)}`];
      return h("button", {
        class: "tx", type: "button", "aria-label": `${b.name}, ${money.format(amount)} on the ${ordinal(b.day)}. Edit`,
        onclick: () => openBill(b),
      },
      categoryBadge(b.category),
      h("span", { class: "tx__body" },
        h("span", { class: "tx__title" }, b.name),
        h("span", { class: "tx__sub" }, ...sub)),
      h("span", { class: "tx__amount num" }, money.format(amount)));
    })
    : [emptyState("repeat", "No fixed bills", "Add rent, phone or subscriptions so your budget is realistic.")]));

  $("#currency").value = settings.currency;
  for (const btn of $$("[data-theme-option]")) {
    btn.setAttribute("aria-checked", String(btn.dataset.themeOption === settings.theme));
  }
}

function bindMoneyInput(input, apply, message = "Plan updated") {
  input.addEventListener("change", () => {
    const cents = Math.max(0, toCents(input.value));
    store.update((s) => apply(s, cents));
    input.value = centsToInput(cents);
    toast(message);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}

// ---------------------------------------------------------------------------
// Expense sheet
// ---------------------------------------------------------------------------
const entry = { editing: null, amount: "", category: lastCategory, mode: "expense" };
const entrySheet = $("#entrySheet");

function paintAmount() {
  const [int, dec] = (entry.amount || "0").split(".");
  const intText = Number(int || 0).toLocaleString();
  $("#amountValue").textContent = dec === undefined ? intText : `${intText}${DECIMAL}${dec}`;
  $("#amountDisplay").classList.toggle("is-empty", !toCents(entry.amount));
}

function paintCategories() {
  for (const chip of $$(".cat-chip", entrySheet)) {
    const on = chip.dataset.category === entry.category;
    chip.setAttribute("aria-checked", String(on));
    chip.tabIndex = on ? 0 : -1;
  }
}

function setEntryDate(iso) {
  $("#entryDate").value = iso;
  $("#entryDateLabel").textContent = dayLabel(iso);
}

function defaultEntryDate() {
  const cur = currentYM();
  if (ui.ym === cur) return toISO(new Date());
  return ui.ym < cur ? lastDayOf(ui.ym) : `${ui.ym}-01`;
}

function setEntryMode(mode) {
  entry.mode = mode;
  const income = mode === "income";
  const editing = Boolean(entry.editing);
  for (const btn of $$("[data-mode]", entrySheet)) btn.setAttribute("aria-checked", String(btn.dataset.mode === mode));
  $("#entryMode").hidden = editing; // an expense can't turn into a paycheck mid-edit
  $("#catScroller").hidden = income;
  $("#entryTitle").textContent = `${editing ? "Edit" : "New"} ${income ? "paycheck" : "expense"}`;
  $("#entrySave").textContent = editing ? "Save changes" : income ? "Add paycheck" : "Add expense";
  $("#entryDelete").setAttribute("aria-label", income ? "Delete paycheck" : "Delete expense");
  $("#entryNote").placeholder = income ? "Employer or source (optional)" : "Add a note";
  // Prefill a typical paycheck so payday is one tap.
  const typical = store.state.settings.pay.amount;
  if (income && !editing && !toCents(entry.amount) && typical) entry.amount = centsToInput(typical);
  paintAmount();
}

function openEntry(item, { mode = "expense", date } = {}) {
  entry.editing = item ?? null;
  entry.amount = item ? centsToInput(item.amount) : "";
  entry.category = item?.category ?? lastCategory;
  $("#entryDelete").hidden = !item;
  $("#entryNote").value = item?.note ?? "";
  setEntryDate(item?.date ?? date ?? defaultEntryDate());
  setEntryMode(mode);
  paintCategories();
  sheets.open(entrySheet);
  requestAnimationFrame(() => $(".cat-chip[aria-checked='true']", entrySheet)?.scrollIntoView({ inline: "center", block: "nearest" }));
}

function savePaycheck(amount, date) {
  const record = { amount, note: $("#entryNote").value.trim(), date };
  const editing = entry.editing;
  ui.ym = ymOf(date);
  store.update((s) => {
    if (editing) Object.assign(s.paychecks.find((p) => p.id === editing.id) ?? {}, record);
    else s.paychecks.push({ id: uid(), createdAt: Date.now(), ...record });
  });
  sheets.close();
  haptic(14);
  if (editing) return toast("Paycheck updated");
  // Payday is the natural moment to confirm the bank balance.
  toast(`+${money.format(amount)} paycheck added`, {
    actionLabel: "Update balance", onAction: openBalance, duration: 5000,
  });
}

function pressKey(key) {
  const next = applyKey(entry.amount, key);
  if (next === entry.amount) {
    if (key !== "back") shake($("#amountDisplay"));
    return;
  }
  entry.amount = next;
  haptic(6);
  paintAmount();
}

function saveEntry() {
  const amount = toCents(entry.amount);
  if (amount <= 0) {
    shake($("#amountDisplay"));
    haptic([12, 40, 12]);
    return;
  }
  const date = $("#entryDate").value || toISO(new Date());
  if (entry.mode === "income") return savePaycheck(amount, date);
  const record = { amount, category: entry.category, note: $("#entryNote").value.trim(), date };
  const editing = entry.editing;
  const isFirst = !store.state.items.length;

  lastCategory = entry.category;
  ui.ym = ymOf(date); // jump to the month the expense landed in
  const ok = store.update((s) => {
    if (editing) Object.assign(s.items.find((i) => i.id === editing.id) ?? {}, record);
    else s.items.push({ id: uid(), createdAt: Date.now(), ...record });
  });
  sheets.close();
  haptic(14);

  if (!ok) return toast("Couldn't save. Storage may be full.");
  if (isFirst) navigator.storage?.persist?.().catch(() => {});
  if (editing) return toast("Changes saved");

  // Warn the moment a purchase crosses a limit or the budget.
  const s = summarize(store.state, ui.ym);
  const cat = s.categories.find((c) => c.id === record.category);
  const name = getCategory(record.category).name;
  if (cat?.limit && cat.amount > cat.limit && cat.amount - amount <= cat.limit) {
    toast(`Heads up: ${name} just passed its ${money.short(cat.limit)} limit`, { duration: 4000 });
  } else if (s.budget > 0 && s.left < 0 && s.left + amount >= 0) {
    toast("That puts you over budget for the month", { duration: 4000 });
  } else {
    toast(`${money.format(amount)} · ${name}`);
  }
}

function deleteEntry() {
  const removed = entry.editing;
  if (!removed) return;
  const key = entry.mode === "income" ? "paychecks" : "items";
  store.update((s) => { s[key] = s[key].filter((i) => i.id !== removed.id); });
  sheets.close();
  toast(key === "paychecks" ? "Paycheck deleted" : "Expense deleted", {
    onAction: () => store.update((s) => { s[key].push(removed); }),
  });
}

// ---------------------------------------------------------------------------
// Bill sheet
// ---------------------------------------------------------------------------
const billSheet = $("#billSheet");
let editingBill = null;

/** One-tap starters. Variable ones prompt for the real amount each month. */
const BILL_PRESETS = [
  { name: "Dominion Energy", category: "bills", variable: true, day: 15 },
  { name: "Columbia Gas", category: "bills", variable: true, day: 15 },
  { name: "Best Buy card", category: "debt", variable: true, day: 1 },
  { name: "Rent", category: "housing", variable: false, day: 1 },
  { name: "Internet", category: "bills", variable: false, day: 1 },
  { name: "Phone", category: "bills", variable: false, day: 1 },
];

function syncBillForm() {
  const variable = $("#billVariable").checked;
  $("#billAmountLabel").textContent = variable ? "Typical amount" : "Amount";
  $("#billHistory").hidden = !(editingBill && variable);
}

function renderBillPresets() {
  const taken = new Set(store.state.recurring.map((b) => b.name.toLowerCase()));
  const presets = BILL_PRESETS.filter((p) => !taken.has(p.name.toLowerCase()));
  $("#billPresets").hidden = Boolean(editingBill) || !presets.length;
  $("#billPresets").replaceChildren(...presets.map((p) => h("button", {
    class: "preset", type: "button",
    onclick: () => {
      $("#billName").value = p.name;
      $("#billCategory").value = p.category;
      $("#billVariable").checked = p.variable;
      $("#billDay").value = String(p.day);
      syncBillForm();
      $("#billAmount").focus();
    },
  }, categoryBadge(p.category), p.name)));
}

function renderBillHistory(bill) {
  const cur = currentYM();
  const { months, average, peak } = billHistory(bill, cur);
  const max = Math.max(...months.map((m) => m.amount || 0), 1);
  $("#billHistoryStats").textContent = average
    ? `Avg ${money.short(average)}${peak ? ` · High ${money.short(peak.amount)} in ${monthLabel(peak.ym, "short")}` : ""}`
    : "No amounts yet";
  $("#billHistoryBars").replaceChildren(...months.map((m) => {
    const cls = ["hbar", m.ym === cur && "is-current", m.amount == null && "is-missing",
      peak && m.ym === peak.ym && m.ym !== cur && "is-peak"].filter(Boolean).join(" ");
    return h("button", {
      class: cls, type: "button",
      "aria-label": `${monthLabel(m.ym)}: ${m.amount != null ? money.format(m.amount) : "not entered"}. Edit`,
      onclick: () => openPay(bill, m.ym),
    },
    h("span", { class: "hbar__value num" }, m.amount != null ? money.short(m.amount) : "–"),
    h("span", { class: "hbar__track" },
      h("span", { class: "hbar__fill", style: { height: m.amount != null ? `${Math.max(4, (m.amount / max) * 100)}%` : "55%" } })),
    h("span", { class: "hbar__label" }, monthLabel(m.ym, "short")));
  }));
  $("#billEnterNow").textContent = bill.actuals[cur] ? "Edit this month's amount" : "Enter this month's amount";
}

function openBill(bill) {
  editingBill = bill ?? null;
  $("#billTitle").textContent = bill ? "Edit bill" : "New bill";
  $("#billSave").textContent = bill ? "Save changes" : "Add bill";
  $("#billDelete").hidden = !bill;
  $("#billName").value = bill?.name ?? "";
  $("#billAmount").value = bill ? centsToInput(bill.amount) : "";
  $("#billDay").value = String(bill?.day ?? 1);
  $("#billCategory").value = bill?.category ?? "bills";
  $("#billVariable").checked = Boolean(bill?.variable);
  for (const el of $$("[aria-invalid]", billSheet)) el.removeAttribute("aria-invalid");
  renderBillPresets();
  if (bill) renderBillHistory(bill);
  syncBillForm();
  sheets.open(billSheet, { initialFocus: bill ? billSheet : $("#billName") });
}

// ---------------------------------------------------------------------------
// Bill amount sheet (variable bills)
// ---------------------------------------------------------------------------
const paySheet = $("#paySheet");
let paying = null;

function openPay(bill, ym) {
  paying = { id: bill.id, ym };
  const existing = bill.actuals?.[ym];
  const last = bill.actuals?.[shiftYM(ym, -1)];
  const { average } = billHistory(bill, ym);
  $("#payTitle").textContent = bill.name;
  $("#paySub").textContent = `${monthLabel(ym)} bill · due ${dueDateLabel(bill, ym)}`;
  $("#payAmount").value = centsToInput(existing ?? 0);
  $("#payAmount").removeAttribute("aria-invalid");
  $("#payHint").textContent = [
    last && `Last month ${money.format(last)}`,
    average ? `Average ${money.format(average)}` : `Estimate ${money.format(bill.amount)}`,
  ].filter(Boolean).join(" · ");
  $("#payClear").hidden = !existing;
  sheets.open(paySheet, { initialFocus: $("#payAmount") });
}

function savePay() {
  const amount = toCents($("#payAmount").value);
  if (amount <= 0) {
    $("#payAmount").setAttribute("aria-invalid", "true");
    shake($("#payAmount"));
    $("#payAmount").focus();
    return;
  }
  const { id, ym } = paying;
  const bill = store.state.recurring.find((b) => b.id === id);
  if (!bill) return sheets.close();
  const { average } = billHistory(bill, ym);
  store.update((s) => {
    const b = s.recurring.find((x) => x.id === id);
    if (b) b.actuals[ym] = amount;
  });
  sheets.close();
  haptic(14);
  const diff = average ? Math.round(((amount - average) / average) * 100) : 0;
  toast(diff >= 20
    ? `${bill.name}: ${money.format(amount)}, ${diff}% above your average`
    : `${bill.name}: ${money.format(amount)} saved`, { duration: diff >= 20 ? 4000 : undefined });
}

function clearPay() {
  const { id, ym } = paying;
  store.update((s) => {
    const b = s.recurring.find((x) => x.id === id);
    if (b) delete b.actuals[ym];
  });
  sheets.close();
  toast("Amount cleared. Using the estimate.");
}

function saveBill() {
  const name = $("#billName").value.trim();
  const amount = toCents($("#billAmount").value);
  const day = Number($("#billDay").value);
  const invalid = [
    !name && $("#billName"),
    amount <= 0 && $("#billAmount"),
    !(Number.isInteger(day) && day >= 1 && day <= 31) && $("#billDay"),
  ].filter(Boolean);
  for (const el of $$("[aria-invalid]", billSheet)) el.removeAttribute("aria-invalid");
  if (invalid.length) {
    invalid.forEach((el) => el.setAttribute("aria-invalid", "true"));
    invalid[0].focus();
    shake(invalid[0]);
    return;
  }
  const record = { name, amount, day, category: $("#billCategory").value, variable: $("#billVariable").checked };
  const editing = editingBill;
  store.update((s) => {
    if (editing) Object.assign(s.recurring.find((b) => b.id === editing.id) ?? {}, record);
    else s.recurring.push({ id: uid(), actuals: {}, ...record });
  });
  sheets.close();
  toast(editing ? "Bill updated" : record.variable
    ? `${name} added. We'll ask for the amount on the ${ordinal(day)}.`
    : `${name} added`, { duration: record.variable ? 4000 : undefined });
}

function deleteBill() {
  const removed = editingBill;
  if (!removed) return;
  store.update((s) => { s.recurring = s.recurring.filter((b) => b.id !== removed.id); });
  sheets.close();
  toast("Bill removed", { onAction: () => store.update((s) => { s.recurring.push(removed); }) });
}

// ---------------------------------------------------------------------------
// Data import / export
// ---------------------------------------------------------------------------
async function exportData() {
  const name = `pocket-backup-${toISO(new Date())}.json`;
  const file = new File([store.serialize()], name, { type: "application/json" });
  const mobile = matchMedia("(pointer: coarse)").matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Pocket backup" });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup downloaded");
}

async function importData(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("too large");
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.items)) throw new Error("invalid");
    if (!confirm(`Replace your current data with this backup (${parsed.items.length} expenses)?`)) return;
    store.replace({ ...parsed, onboarded: true });
    toast("Backup restored");
  } catch {
    toast("That file isn't a valid Pocket backup");
  }
}

// ---------------------------------------------------------------------------
// Bank balance check-in
// ---------------------------------------------------------------------------
const balanceSheet = $("#balanceSheet");
let pendingBalance = null;

function showBalanceStep(step) {
  $("#balAsk").hidden = step !== "ask";
  $("#balResult").hidden = step !== "result";
}

function openBalance() {
  pendingBalance = null;
  const est = balanceEstimate(store.state);
  $("#balanceAmount").value = "";
  $("#balanceAmount").removeAttribute("aria-invalid");
  $("#balanceHint").textContent = est
    ? `Pocket expects about ${money.format(est.estimate)}. If you're overdrawn, start with a minus sign.`
    : "If you're overdrawn, start with a minus sign.";
  showBalanceStep("ask");
  sheets.open(balanceSheet, { initialFocus: $("#balanceAmount") });
}

/**
 * Save a confirmed balance. Optional adjustment logs the gap so history
 * stays truthful; it's stamped just before the check so it isn't counted twice.
 */
function recordBalance(actual, adjust) {
  const at = Date.now();
  const date = toISO(new Date());
  store.update((s) => {
    if (adjust?.type === "spend") {
      s.items.push({ id: uid(), amount: adjust.amount, category: "other", note: "Unlogged spending (balance check)", date, createdAt: at - 1 });
    } else if (adjust?.type === "income") {
      s.paychecks.push({ id: uid(), amount: adjust.amount, note: "Unlogged deposit (balance check)", date, createdAt: at - 1 });
    }
    s.balances.push({ id: uid(), amount: actual, date, at });
  });
}

function submitBalance() {
  const raw = $("#balanceAmount").value;
  if (!/\d/.test(raw)) {
    $("#balanceAmount").setAttribute("aria-invalid", "true");
    shake($("#balanceAmount"));
    $("#balanceAmount").focus();
    return;
  }
  const actual = toCents(raw);
  const est = balanceEstimate(store.state);
  if (!est) {
    recordBalance(actual);
    sheets.close();
    return toast("Balance saved. Pocket will keep it updated as you go.", { duration: 3500 });
  }

  const { diff, matches } = reconcile(est.estimate, actual);
  if (matches) {
    recordBalance(actual);
    sheets.close();
    haptic(14);
    return toast(diff === 0 ? "Spot on. Your balance matches." : `Matches. Only ${money.format(Math.abs(diff))} off.`);
  }

  // Doesn't add up: explain the gap and ask what happened.
  pendingBalance = { actual, expected: est.estimate, diff };
  const gap = money.format(Math.abs(diff));
  const less = diff < 0;
  $("#balResultTitle").textContent = less ? `${gap} less than expected` : `${gap} more than expected`;
  $("#balResultText").textContent = less
    ? "Something may not be logged yet, like a purchase, a fee, or a bill that came in higher than usual."
    : "A paycheck, refund or transfer may not be logged yet.";
  const row = (label, value, cls) => h("div", { class: cls }, h("dt", {}, label), h("dd", { class: "num" }, value));
  $("#balCompare").replaceChildren(
    row("Pocket expected", money.format(est.estimate)),
    row("Your bank says", money.format(actual)),
    row("Difference", `${less ? "\u2212" : "+"}${gap}`, `equation__total${less ? " is-short" : ""}`));
  $("#balLog").textContent = less ? `Log ${gap} as spending I missed` : `Log ${gap} as income I missed`;
  showBalanceStep("result");
  haptic([10, 40, 10]);
  $("#balLog").focus();
}

function resolveBalance(logGap) {
  if (!pendingBalance) return;
  const { actual, diff } = pendingBalance;
  recordBalance(actual, logGap ? { type: diff < 0 ? "spend" : "income", amount: Math.abs(diff) } : null);
  pendingBalance = null;
  sheets.close();
  toast(logGap
    ? `Balance updated and ${money.format(Math.abs(diff))} logged`
    : "Balance updated", { duration: 3000 });
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 };
let obFrequency = "weekly";

function updateOnboardingHint() {
  const amount = toCents($("#obIncome").value);
  const m = createMoney($("#obCurrency").value);
  for (const el of $$("#onboarding [data-currency-symbol]")) el.textContent = m.symbol;
  for (const btn of $$("[data-freq]", $("#obFreq"))) btn.setAttribute("aria-checked", String(btn.dataset.freq === obFrequency));
  $("#obIncomeLabel").textContent = obFrequency === "monthly" ? "Monthly take-home" : "Typical paycheck";
  $("#obPaydayField").hidden = obFrequency === "monthly";
  const monthly = Math.round(amount * PER_MONTH[obFrequency]);
  $("#obHint").textContent = amount > 0
    ? `That's about ${m.short(monthly)} a month. 20% would be ${m.short(Math.round(monthly * 0.2))}.`
    : "Tip: 20% of income is a common target.";
}

function showOnboarding() {
  $("#onboarding").hidden = false;
  $("#obCurrency").value = store.state.settings.currency;
  $("#obPayday").value = "5";
  updateOnboardingHint();
  setTimeout(() => $("#obIncome").focus(), 80);
}

function finishOnboarding(withValues) {
  const balanceRaw = $("#obBalance").value;
  store.update((s) => {
    s.onboarded = true;
    if (!withValues) return;
    const amount = Math.max(0, toCents($("#obIncome").value));
    const weekday = Number($("#obPayday").value);
    s.settings.goal = Math.max(0, toCents($("#obGoal").value));
    s.settings.currency = $("#obCurrency").value;
    s.settings.income = obFrequency === "monthly" ? amount : 0;
    s.settings.pay = {
      frequency: obFrequency,
      amount: obFrequency === "monthly" ? 0 : amount,
      weekday,
      anchor: obFrequency === "biweekly" ? lastWeekday(weekday) : "",
    };
    if (/\d/.test(balanceRaw)) {
      s.balances.push({ id: uid(), amount: toCents(balanceRaw), date: toISO(new Date()), at: Date.now() });
    }
  });
  $("#onboarding").hidden = true;
  if (withValues) toast("You're all set");
}

/** Switching schedules converts the amount so the budget doesn't jump to zero. */
function setPayFrequency(next) {
  store.update((s) => {
    const { pay } = s.settings;
    const prev = pay.frequency;
    if (prev === next) return;
    const monthly = prev === "monthly" ? s.settings.income : Math.round(pay.amount * PER_MONTH[prev]);
    pay.frequency = next;
    if (next === "monthly") {
      s.settings.income = s.settings.income || monthly;
    } else {
      pay.amount = prev === "monthly" ? Math.round(monthly / PER_MONTH[next]) : Math.round(pay.amount * PER_MONTH[prev] / PER_MONTH[next]);
      if (next === "biweekly" && !pay.anchor) pay.anchor = lastWeekday(pay.weekday);
    }
  });
  toast("Pay schedule updated");
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) $('meta[name="theme-color"]').setAttribute("content", bg);
}

// ---------------------------------------------------------------------------
// Routing & render
// ---------------------------------------------------------------------------
function render() {
  const cur = currentYM();
  $("#monthLabel").textContent = monthLabel(ui.ym);
  $("#monthLabel").setAttribute("aria-label", `${monthLabel(ui.ym)}${ui.ym === cur ? "" : ". Go to current month"}`);
  $("#monthLabel").disabled = ui.ym === cur;
  for (const el of $$("[data-currency-symbol]")) {
    if (!el.closest("#onboarding")) el.textContent = money.symbol;
  }
  VIEWS[ui.view].render();
}

function route() {
  const name = location.hash.slice(1);
  if (name === "add") {
    history.replaceState(null, "", "#home");
    route();
    openEntry();
    return;
  }
  const view = VIEWS[name] ? name : "home";
  const changed = view !== ui.view;
  ui.view = view;
  for (const sec of $$("[data-view]")) {
    const active = sec.dataset.view === view;
    sec.hidden = !active;
    if (active && changed) {
      sec.classList.remove("is-entering");
      void sec.offsetWidth;
      sec.classList.add("is-entering");
    }
  }
  for (const tab of $$("[data-route]")) {
    if (tab.dataset.route === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  $("#viewTitle").textContent = VIEWS[view].title;
  $("#monthSwitch").classList.toggle("is-hidden", !VIEWS[view].monthNav);
  document.title = `${VIEWS[view].title} · Pocket`;
  if (changed) window.scrollTo({ top: 0 });
  render();
}

// ---------------------------------------------------------------------------
// One-time UI construction & event wiring
// ---------------------------------------------------------------------------
function buildStaticUI() {
  // Category chips (roving tabindex radiogroup)
  $("#catScroller").replaceChildren(...CATEGORIES.map((c) => h("button", {
    class: "cat-chip", type: "button", role: "radio", "data-category": c.id, "aria-checked": "false",
    onclick: () => { entry.category = c.id; haptic(4); paintCategories(); },
  }, categoryBadge(c.id), h("span", {}, c.name))));
  $("#catScroller").addEventListener("keydown", (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const idx = CATEGORIES.findIndex((c) => c.id === entry.category);
    entry.category = CATEGORIES[(idx + dir + CATEGORIES.length) % CATEGORIES.length].id;
    paintCategories();
    $(".cat-chip[aria-checked='true']", entrySheet).focus();
  });

  // Keypad
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  $("#keypad").replaceChildren(...keys.map((k) => h("button", {
    class: "key num", type: "button", "data-key": k,
    "aria-label": k === "back" ? "Delete digit" : k === "." ? "Decimal point" : null,
  }, k === "back" ? icon("backspace") : k === "." ? DECIMAL : k)));
  $("#keypad").addEventListener("click", (e) => {
    const key = e.target.closest("[data-key]")?.dataset.key;
    if (key) pressKey(key);
  });
  // Long-press backspace clears the amount.
  let clearTimer;
  const back = $('[data-key="back"]');
  back.addEventListener("pointerdown", () => {
    clearTimer = setTimeout(() => { entry.amount = ""; paintAmount(); haptic(20); }, 500);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => back.addEventListener(ev, () => clearTimeout(clearTimer)));

  // Category limit inputs
  $("#limitFields").replaceChildren(...CATEGORIES.map((c) => {
    const input = h("input", {
      class: "input num", id: `limit-${c.id}`, type: "text", inputmode: "decimal",
      autocomplete: "off", placeholder: "No limit", "data-category": c.id,
    });
    bindMoneyInput(input, (s, cents) => {
      if (cents) s.limits[c.id] = cents;
      else delete s.limits[c.id];
    }, "Limit saved");
    return h("div", { class: "limit-field" },
      categoryBadge(c.id),
      h("label", { for: input.id }, c.name),
      h("div", { class: "money-field" }, h("span", { class: "money-field__sym", "data-currency-symbol": "" }, "$"), input));
  }));

  // Selects
  const currencyOptions = () => CURRENCIES.map((code) => h("option", { value: code }, `${code} · ${currencyName(code)}`));
  $("#currency").replaceChildren(...currencyOptions());
  $("#obCurrency").replaceChildren(...currencyOptions());
  $("#billCategory").replaceChildren(...CATEGORIES.map((c) => h("option", { value: c.id }, c.name)));

  // Weekday pickers (7 Jan 2024 was a Sunday)
  const weekdays = () => Array.from({ length: 7 }, (_, i) => h("option", { value: String(i) },
    new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: "long" })));
  $("#payday").replaceChildren(...weekdays());
  $("#obPayday").replaceChildren(...weekdays());
}

function wireEvents() {
  window.addEventListener("hashchange", route);
  $("#prevMonth").addEventListener("click", () => { ui.ym = shiftYM(ui.ym, -1); render(); });
  $("#nextMonth").addEventListener("click", () => { ui.ym = shiftYM(ui.ym, 1); render(); });
  $("#monthLabel").addEventListener("click", () => { ui.ym = currentYM(); render(); });
  $("#search").addEventListener("input", (e) => { ui.query = e.target.value; renderActivity(); });

  // Expense sheet
  $("#fab").addEventListener("click", () => openEntry());
  entrySheet.addEventListener("submit", (e) => { e.preventDefault(); saveEntry(); });
  $("#entryDelete").addEventListener("click", deleteEntry);
  $("#entryDate").addEventListener("change", (e) => { if (e.target.value) setEntryDate(e.target.value); });
  $("#entryDate").addEventListener("click", (e) => { try { e.target.showPicker?.(); } catch { /* unsupported */ } });
  document.addEventListener("keydown", (e) => {
    if (sheets.active !== entrySheet || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches("input, select, textarea")) return;
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === "." || e.key === ",") pressKey(".");
    else if (e.key === "Backspace") { e.preventDefault(); pressKey("back"); }
    else if (e.key === "Enter" && !e.target.matches("button")) { e.preventDefault(); saveEntry(); }
    else return;
  });

  // Bill sheet
  $("#addBill").addEventListener("click", () => openBill());
  billSheet.addEventListener("submit", (e) => { e.preventDefault(); saveBill(); });
  $("#billDelete").addEventListener("click", deleteBill);
  $("#billVariable").addEventListener("change", syncBillForm);
  $("#billEnterNow").addEventListener("click", () => {
    const bill = editingBill && store.state.recurring.find((b) => b.id === editingBill.id);
    if (bill) openPay(bill, currentYM());
  });

  // Bill amount sheet
  paySheet.addEventListener("submit", (e) => { e.preventDefault(); savePay(); });
  $("#payClear").addEventListener("click", clearPay);

  // Expense / paycheck toggle
  $("#entryMode").addEventListener("click", (e) => {
    const mode = e.target.closest("[data-mode]")?.dataset.mode;
    if (mode && mode !== entry.mode) { haptic(4); setEntryMode(mode); }
  });

  // Bank balance
  balanceSheet.addEventListener("submit", (e) => { e.preventDefault(); submitBalance(); });
  $("#balLog").addEventListener("click", () => resolveBalance(true));
  $("#balJust").addEventListener("click", () => resolveBalance(false));
  $("#balBack").addEventListener("click", () => { showBalanceStep("ask"); $("#balanceAmount").select(); });

  for (const sheet of [entrySheet, billSheet, paySheet, balanceSheet]) {
    enableDragToDismiss(sheet, () => sheets.close());
    $("[data-close]", sheet).addEventListener("click", () => sheets.close());
  }

  // Plan: pay schedule
  $("#payFreq").addEventListener("click", (e) => {
    const freq = e.target.closest("[data-freq]")?.dataset.freq;
    if (freq) setPayFrequency(freq);
  });
  bindMoneyInput($("#paycheck"), (s, c) => { s.settings.pay.amount = c; });
  $("#payday").addEventListener("change", (e) => {
    store.update((s) => { s.settings.pay.weekday = Number(e.target.value); });
    toast("Payday updated");
  });
  $("#payAnchor").addEventListener("change", (e) => {
    const iso = e.target.value;
    if (!iso) return;
    store.update((s) => { s.settings.pay.anchor = iso; s.settings.pay.weekday = parseISO(iso).getDay(); });
    toast("Pay schedule updated");
  });

  // Plan
  bindMoneyInput($("#income"), (s, c) => { s.settings.income = c; });
  bindMoneyInput($("#goal"), (s, c) => { s.settings.goal = c; });
  $("#currency").addEventListener("change", (e) => {
    store.update((s) => { s.settings.currency = e.target.value; });
    toast(`Currency set to ${e.target.value}`);
  });
  $("#themeSeg").addEventListener("click", (e) => {
    const opt = e.target.closest("[data-theme-option]")?.dataset.themeOption;
    if (opt) store.update((s) => { s.settings.theme = opt; });
  });

  // Data
  $("#exportBtn").addEventListener("click", exportData);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await importData(file);
    e.target.value = "";
  });
  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("Erase all expenses, bills and settings? This can't be undone unless you have a backup.")) return;
    store.reset();
    ui.ym = currentYM();
    showOnboarding();
  });

  // Onboarding
  $("#obFreq").addEventListener("click", (e) => {
    const freq = e.target.closest("[data-freq]")?.dataset.freq;
    if (freq) { obFrequency = freq; updateOnboardingHint(); }
  });
  $("#obIncome").addEventListener("input", updateOnboardingHint);
  $("#obCurrency").addEventListener("change", updateOnboardingHint);
  $("#obForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (toCents($("#obIncome").value) <= 0) {
      $("#obIncome").setAttribute("aria-invalid", "true");
      shake($("#obIncome"));
      $("#obIncome").focus();
      return;
    }
    finishOnboarding(true);
  });
  $("#obSkip").addEventListener("click", () => finishOnboarding(false));

  // Keep "today" accurate when the app is resumed on a new day.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    $("#greeting").textContent = greeting();
    render();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(store.state.settings.theme));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          toast("A new version is ready", {
            actionLabel: "Update", duration: 12000,
            onAction: () => worker.postMessage({ type: "SKIP_WAITING" }),
          });
        }
      });
    });
  }).catch(() => { /* offline support is a progressive enhancement */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
store.subscribe((state) => {
  if (state.settings.currency !== money.currency) money = createMoney(state.settings.currency);
  applyTheme(state.settings.theme);
  render();
});

buildStaticUI();
wireEvents();
applyTheme(store.state.settings.theme);
$("#greeting").textContent = greeting();
route();
if (!store.state.onboarded) showOnboarding();
registerServiceWorker();
