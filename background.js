// ================== YARDIMCI ==================
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

// ================== ALARM KURULUMU ==================
function scheduleMidnightAlarm() {
  chrome.alarms.create("midnightReset", {
    when: Date.now() + msUntilMidnight(),
    periodInMinutes: 24 * 60
  });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleMidnightAlarm();
  updateBadgeFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleMidnightAlarm();
  updateBadgeFromStorage();
});

// ================== GECE YARISI RESET ==================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "midnightReset") {
    chrome.storage.local.get(["sigaraState"], (result) => {
      if (!result.sigaraState) return;
      const state = result.sigaraState;
      const key = todayKey();

      // Yeni günün history kaydı oluşturulur (eğer yoksa)
      if (!state.history[key]) {
        state.history[key] = { smoked: 0, spent: 0 };
      }

      // Badge her gün başında sıfırlanır (yeni günün verisine göre)
      chrome.storage.local.set({ sigaraState: state }, () => {
        chrome.action.setBadgeText({ text: "" });
      });
    });
  }
});

// ================== BADGE'İ AÇILIŞTA GÜNCELLE ==================
function updateBadgeFromStorage() {
  chrome.storage.local.get(["sigaraState"], (result) => {
    if (!result.sigaraState) return;
    const state = result.sigaraState;
    const key = todayKey();
    const todayEntry = state.history[key];
    const smoked = todayEntry ? todayEntry.smoked : 0;

    chrome.action.setBadgeText({ text: smoked > 0 ? String(smoked) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#ff8a00" });
  });
}
