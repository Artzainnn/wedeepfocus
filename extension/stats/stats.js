// Stats page: the local usage history (chrome.storage.local "history"), never sent anywhere.
import { t, applyI18n, uiLocale } from "../shared/i18n.js";
import { mountFeedbackLink } from "../ui/feedback-link.js";
import { formatDurationShort, localDayKey } from "../shared/format.js";
import { cleanHistory, focusLevel, gridWeeks, streaks, summarize } from "../shared/stats.js";
import { icon } from "../shared/icons.js";
import { ACCOUNTABILITY_ENABLED } from "../shared/constants.js";

const WEEKS = 30;
const locale = uiLocale();
const $ = (role) => document.querySelector(`[data-role="${role}"]`);
let period = "7";
let history = { days: {} };

const dayLabel = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });

init();

async function init() {
  applyI18n();
  document.title = t("stats_page_title", [t("appName")]);
  mountFeedbackLink();
  for (const slot of document.querySelectorAll("[data-icon]")) {
    slot.replaceChildren(icon(slot.dataset.icon));
    slot.setAttribute("aria-hidden", "true");
  }
  document.querySelector('[data-testid="stats-paid"]').hidden = !ACCOUNTABILITY_ENABLED;
  for (const chip of document.querySelectorAll("[data-period]")) {
    chip.setAttribute("role", "radio");
    chip.addEventListener("click", () => {
      period = chip.dataset.period;
      render();
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.history) load();
  });
  await load();
  document.querySelector(".page").removeAttribute("aria-busy");
}

async function load() {
  const stored = await chrome.storage.local.get({ history: null });
  history = cleanHistory(stored.history);
  render();
}

function render() {
  const today = localDayKey(Date.now());
  renderStreak(today);
  renderDays(today);
  renderCards(today);
}

function renderStreak(today) {
  const { current, best } = streaks(history, today);
  const card = document.querySelector('[data-testid="stats-streak"]');
  card.classList.toggle("is-empty", current === 0);
  $("streak-value").textContent =
    current === 0 ? t("stats_streak_none") : current === 1 ? t("stats_streak_one") : t("stats_streak_many", [String(current)]);
  $("streak-best").textContent = best > 0 ? t("stats_streak_best", [String(best)]) : "";
  $("streak-best").hidden = best === 0;
}

// One square per day (weeks as columns, Monday on top), coloured by protected focus time.
function renderDays(today) {
  const map = $("daymap");
  const squares = [];
  for (const week of gridWeeks(today, WEEKS)) {
    for (const key of week) {
      const square = document.createElement("i");
      if (!key) {
        square.className = "is-future";
      } else {
        const day = history.days[key];
        square.className = `lv${focusLevel(day)}${key === today ? " is-today" : ""}`;
        square.dataset.day = key;
        square.title = dayTitle(key, day);
      }
      squares.push(square);
    }
  }
  map.replaceChildren(...squares);
  map.setAttribute("aria-label", t("stats_grid_label"));
  // On narrow screens the grid scrolls: start on the most recent weeks.
  map.parentElement.scrollLeft = map.parentElement.scrollWidth;
}

function dayTitle(key, day) {
  const [y, m, d] = key.split("-").map(Number);
  const label = dayLabel.format(new Date(y, m - 1, d, 12));
  const focus = day?.focusMs ?? 0;
  return focus >= 60_000 ? t("stats_grid_day", [label, formatDurationShort(focus, locale)]) : t("stats_grid_day_none", [label]);
}

function money(paid) {
  const parts = Object.entries(paid)
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) =>
      new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(amount),
    );
  return parts.length ? parts.join(" + ") : "0";
}

function renderCards(today) {
  for (const chip of document.querySelectorAll("[data-period]")) {
    chip.setAttribute("aria-checked", String(chip.dataset.period === period));
  }
  const total = summarize(history, today, period === "all" ? null : Number(period));
  $("focus-value").textContent = formatDurationShort(total.focusMs, locale);
  $("focus-sub").textContent = t("stats_focus_sub");
  $("blocked-value").textContent = String(total.blocked);
  $("blocked-sub").textContent = t("stats_blocked_sub");
  $("completed-value").textContent = String(total.completed);
  $("completed-sub").textContent = t("stats_completed_sub");
  $("ended-value").textContent = String(total.ended);
  // Free only (first release): no paid ends to split out, no money card.
  $("ended-sub").textContent = ACCOUNTABILITY_ENABLED ? t("stats_ended_sub", [String(total.endedFree), String(total.endedPaid)]) : "";
  $("paid-value").textContent = money(total.paid);
  $("paid-sub").textContent =
    total.endedPaid === 0 ? t("stats_paid_none") : total.endedPaid === 1 ? t("stats_paid_one") : t("stats_paid_many", [String(total.endedPaid)]);
}
