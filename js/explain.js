/**
 * Plain-English help for every card. One place to edit wording.
 *   what: what the card is for, in one sentence a non-expert understands.
 *   Status text comes from status.js and appears under "Right now".
 */
export const EXPLAIN = Object.freeze({
  hero: {
    title: "Left to spend",
    what: "The money you can still spend this month without touching your savings goal or missing bills.",
  },
  balance: {
    title: "Bank balance",
    what: "Your bank balance, estimated between checks. Pocket adds paychecks, takes away spending and bills, and asks you to check every week.",
  },
  week: {
    title: "This week",
    what: "How this week's spending compares with the same days last week.",
  },
  savings: {
    title: "Savings",
    what: "How much you're on track to save this month compared with your goal.",
  },
  pace: {
    title: "Spending pace",
    what: "Your spending so far (solid line) against an even pace for the whole month (dashed line). Staying under the dashed line means you're on track.",
  },
  categories: {
    title: "Where it went",
    what: "Which kinds of spending take up most of your money this month. Limits you set show a bar that fills as you spend.",
  },
  recent: {
    title: "Recent",
    what: "Your latest expenses and paychecks. Tap any one to edit it.",
  },
  afford: {
    title: "Can I afford this?",
    what: "Type a price before you buy. Pocket tells you whether it fits today, this month, and your bank balance.",
  },
  billsCompare: {
    title: "Bills vs last month",
    what: "Each bill compared with last month. Red means it went up a lot, yellow means a little, green means the same or lower. Gray means the new bill isn't in yet.",
  },
  calendar: {
    title: "Spending calendar",
    what: "Each day of the month, colored by how much you spent. Darker is more. Tap a day to see what you bought.",
  },
  months: {
    title: "Last 6 months",
    what: "Your spending each month for the last six months. Bars above the dashed line are over your budget.",
  },
  monthOverMonth: {
    title: "Month over month",
    what: "Each category compared with last month. Green means you spent less, red means more.",
  },
  forecast: {
    title: "Savings forecast",
    what: "A simple estimate of how much you'll save by the end of the year, if you keep your current habits.",
  },
  habits: {
    title: "Your habits",
    what: "When you spend most, where it goes most often, and how small purchases add up.",
  },
  year: {
    title: "Year in review",
    what: "How each month of the year went, with your best and toughest months.",
  },
  mood: {
    title: "How you're doing",
    what: "The whole app changes color to show how your month is going. Green means you're on track, yellow means keep an eye on something, red means something needs fixing. It looks at your spending pace, savings goal, category limits, bills and bank balance. You can turn the colors off in Plan.",
  },
  fixedBills: {
    title: "Fixed bills",
    what: "Regular monthly payments like rent and utilities. Pocket sets them aside first, so they never count as spending.",
  },
});
