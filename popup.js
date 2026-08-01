// ================== HELPERS ==================
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateEN() {
  const d = new Date();
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", weekday: "long" });
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatMoney(amount) {
  const cur = state.currency || "TL";
  return `${amount.toFixed(2)} ${cur}`;
}

function getDefaultState() {
  return {
    onboarded: false,
    packPrice: 70,
    packSize: 20,
    currency: "TL",
    remaining: 20,
    lastSmokedAt: null,
    packsFinished: 0,
    history: {},          // { "YYYY-MM-DD": { smoked: n, spent: n } }
    lastAction: null       // for undo: { prevRemaining, prevSmokedToday, prevPacksFinished, prevLastSmokedAt }
  };
}

let state = null;
let timerInterval = null;
let chartInstance = null;

// ================== STORAGE ==================
function loadState(callback) {
  chrome.storage.local.get(["sigaraState"], (result) => {
    if (result.sigaraState) {
      state = result.sigaraState;
      if (!state.packSize) state.packSize = 20;
      if (!state.currency) state.currency = "TL";
    } else {
      state = getDefaultState();
    }
    callback();
  });
}

function saveState() {
  chrome.storage.local.set({ sigaraState: state });
}

// ================== TODAY'S ENTRY ==================
function ensureTodayEntry() {
  const key = todayKey();
  if (!state.history[key]) {
    state.history[key] = { smoked: 0, spent: 0 };
  }
  return state.history[key];
}

// ================== ONBOARDING ==================
function showOnboarding() {
  document.getElementById("onboarding").classList.remove("hidden");
  document.getElementById("dashboard").classList.add("hidden");
  document.getElementById("analytics").classList.add("hidden");
}

function setupOnboardingEvents() {
  const btnNewPack = document.getElementById("btn-new-pack");
  const btnOpenPack = document.getElementById("btn-open-pack");
  const openPackInput = document.getElementById("open-pack-input");
  const btnConfirmOpen = document.getElementById("btn-confirm-open");
  const ob1 = document.getElementById("ob-step1");
  const ob2 = document.getElementById("ob-step2");
  const btnFinish = document.getElementById("btn-finish-onboarding");
  const currencySelect = document.getElementById("currency-select");
  const currencyCustom = document.getElementById("currency-custom");

  let chosenRemaining = null; // null => full pack, set later based on packSize

  btnNewPack.addEventListener("click", () => {
    chosenRemaining = null; // full pack, resolved with packSize on finish
    ob1.classList.add("hidden");
    ob2.classList.remove("hidden");
  });

  btnOpenPack.addEventListener("click", () => {
    openPackInput.classList.remove("hidden");
  });

  btnConfirmOpen.addEventListener("click", () => {
    const val = parseInt(document.getElementById("open-count").value, 10);
    chosenRemaining = isNaN(val) || val < 1 ? 10 : val;
    ob1.classList.add("hidden");
    ob2.classList.remove("hidden");
  });

  currencySelect.addEventListener("change", () => {
    if (currencySelect.value === "custom") {
      currencyCustom.classList.remove("hidden");
    } else {
      currencyCustom.classList.add("hidden");
    }
  });

  btnFinish.addEventListener("click", () => {
    const price = parseFloat(document.getElementById("pack-price").value);
    const size = parseInt(document.getElementById("pack-size").value, 10);
    const validSize = isNaN(size) || size < 1 ? 20 : size;

    let currency = currencySelect.value;
    if (currency === "custom") {
      const custom = currencyCustom.value.trim();
      currency = custom.length > 0 ? custom : "TL";
    }

    state.packSize = validSize;
    state.remaining = chosenRemaining === null ? validSize : Math.min(chosenRemaining, validSize);
    state.packPrice = isNaN(price) ? 70 : price;
    state.currency = currency;
    state.onboarded = true;
    saveState();
    renderDashboard();
    showDashboard();
  });
}

// ================== DASHBOARD ==================
function showDashboard() {
  document.getElementById("onboarding").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  document.getElementById("analytics").classList.add("hidden");
}

function renderDashboard() {
  const todayEntry = ensureTodayEntry();

  document.getElementById("today-date").textContent = formatDateEN();
  document.getElementById("today-smoked").textContent = todayEntry.smoked;
  document.getElementById("today-spent").textContent = formatMoney(todayEntry.spent);

  const packsBox = document.getElementById("packs-finished-box");
  if (state.packsFinished >= 1) {
    packsBox.classList.remove("hidden");
    document.getElementById("packs-finished").textContent = state.packsFinished;
  } else {
    packsBox.classList.add("hidden");
  }

  renderCigBar();

  document.getElementById("remaining-label").textContent =
    `${state.remaining} cigarette${state.remaining === 1 ? "" : "s"} left in pack`;

  const btnPlusOne = document.getElementById("btn-plus-one");
  const btnNewPackAction = document.getElementById("btn-new-pack-action");
  const btnUndo = document.getElementById("btn-undo");

  if (state.remaining <= 0) {
    btnPlusOne.classList.add("hidden");
    btnNewPackAction.classList.remove("hidden");
  } else {
    btnPlusOne.classList.remove("hidden");
    btnNewPackAction.classList.add("hidden");
  }

  btnUndo.disabled = !state.lastAction;

  updateBadge();
  restartTimerDisplay();
}

// Fill width represents remaining % of the dynamic pack size.
// Filter stays fixed on the left (CSS flex-basis 20%); body fill shrinks
// from the right edge toward the filter as cigarettes are smoked.
function renderCigBar() {
  const packSize = state.packSize || 20;
  const percentage = Math.max(0, Math.min(100, (state.remaining / packSize) * 100));
  const fill = document.getElementById("cig-bar-fill");

  fill.style.width = `${percentage}%`;

  if (state.remaining <= 0) {
    fill.classList.add("empty");
  } else {
    fill.classList.remove("empty");
  }
}

// ================== +1 / UNDO / NEW PACK ==================
function handlePlusOne() {
  if (state.remaining <= 0) return;

  const todayEntry = ensureTodayEntry();
  const packSize = state.packSize || 20;

  // Save previous state for undo
  state.lastAction = {
    prevRemaining: state.remaining,
    prevSmoked: todayEntry.smoked,
    prevSpent: todayEntry.spent,
    prevLastSmokedAt: state.lastSmokedAt,
    prevPacksFinished: state.packsFinished
  };

  state.remaining -= 1;
  todayEntry.smoked += 1;
  todayEntry.spent = parseFloat(((state.packPrice / packSize) * todayEntry.smoked).toFixed(2));
  state.lastSmokedAt = Date.now();

  if (state.remaining === 0) {
    state.packsFinished += 1;
  }

  saveState();
  renderDashboard();
}

function handleUndo() {
  if (!state.lastAction) return;

  const todayEntry = ensureTodayEntry();
  const la = state.lastAction;

  state.remaining = la.prevRemaining;
  todayEntry.smoked = la.prevSmoked;
  todayEntry.spent = la.prevSpent;
  state.lastSmokedAt = la.prevLastSmokedAt;
  state.packsFinished = la.prevPacksFinished;
  state.lastAction = null;

  saveState();
  renderDashboard();
}

function handleNewPack() {
  state.remaining = state.packSize || 20;
  state.lastAction = null;
  saveState();
  renderDashboard();
}

// ================== TIMER ==================
function restartTimerDisplay() {
  if (timerInterval) clearInterval(timerInterval);
  updateTimerText();
  timerInterval = setInterval(updateTimerText, 1000);
}

function updateTimerText() {
  const el = document.getElementById("timer-value");
  if (!state.lastSmokedAt) {
    el.textContent = "--:--:--";
    return;
  }
  const diffMs = Date.now() - state.lastSmokedAt;
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ================== BADGE ==================
function updateBadge() {
  const todayEntry = ensureTodayEntry();
  chrome.action.setBadgeText({ text: todayEntry.smoked > 0 ? String(todayEntry.smoked) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#ff8a00" });
}

// ================== ANALYTICS ==================
function showAnalytics() {
  document.getElementById("dashboard").classList.add("hidden");
  document.getElementById("analytics").classList.remove("hidden");
  renderAnalytics();
}

function getSortedDates() {
  return Object.keys(state.history).sort();
}

function getRangeData(range) {
  const dates = getSortedDates();

  let filtered = [];

  if (range === "daily") {
    filtered = dates.slice(-7);
  } else if (range === "weekly") {
    filtered = dates.slice(-28);
  } else {
    filtered = dates.slice(-90);
  }

  return filtered.map((d) => ({
    date: d,
    smoked: state.history[d].smoked,
    spent: state.history[d].spent
  }));
}

function renderAnalytics() {
  const range = document.getElementById("range-select").value;
  const data = getRangeData(range);

  const labels = data.map((d) => {
    const [y, m, day] = d.date.split("-");
    return `${day}/${m}`;
  });
  const values = data.map((d) => d.smoked);

  const ctx = document.getElementById("stats-chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Cigarettes Smoked",
        data: values,
        backgroundColor: "#ff8a00",
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });

  // Financial summary
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let weekSpent = 0;
  let monthSpent = 0;

  for (const [dateStr, entry] of Object.entries(state.history)) {
    const d = new Date(dateStr);
    if (d >= startOfWeek) weekSpent += entry.spent;
    if (d >= startOfMonth) monthSpent += entry.spent;
  }

  document.getElementById("week-spent").textContent = formatMoney(weekSpent);
  document.getElementById("month-spent").textContent = formatMoney(monthSpent);
}

// ================== EVENT LISTENERS ==================
function setupDashboardEvents() {
  document.getElementById("btn-plus-one").addEventListener("click", handlePlusOne);
  document.getElementById("btn-undo").addEventListener("click", handleUndo);
  document.getElementById("btn-new-pack-action").addEventListener("click", handleNewPack);
  document.getElementById("btn-goto-stats").addEventListener("click", showAnalytics);
}

function setupAnalyticsEvents() {
  document.getElementById("btn-back-dashboard").addEventListener("click", () => {
    showDashboard();
    renderDashboard();
  });
  document.getElementById("range-select").addEventListener("change", renderAnalytics);
}

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  loadState(() => {
    setupOnboardingEvents();
    setupDashboardEvents();
    setupAnalyticsEvents();

    if (!state.onboarded) {
      showOnboarding();
    } else {
      showDashboard();
      renderDashboard();
    }
  });
});
