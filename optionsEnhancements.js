(function () {
  const autoLearn = document.querySelector("#autoLearnCorrections");
  const learnSensitive = document.querySelector("#learnSensitiveFields");
  const saveButton = document.querySelector("#saveProfile");
  const clearButton = document.querySelector("#clearMemory");

  initialize();

  async function initialize() {
    const { profile } = await chrome.storage.local.get(["profile"]);
    autoLearn.checked = profile?.preferences?.autoLearnCorrections !== false;
    learnSensitive.checked = profile?.preferences?.learnSensitiveFields === true;
  }

  saveButton.addEventListener("click", () => {
    window.setTimeout(saveLearningPreferences, 180);
  });

  clearButton.addEventListener("click", () => {
    window.setTimeout(async () => {
      await chrome.storage.local.set({
        memoryStats: {
          totalLearned: 0,
          correctedAutofill: 0,
          recoveredAfterFailure: 0,
          manualAfterAutofill: 0,
          failuresObserved: 0,
          lastUpdatedAt: 0
        },
        autofillMonitorLog: []
      });
    }, 100);
  });

  async function saveLearningPreferences() {
    const stored = await chrome.storage.local.get(["profile"]);
    const next = stored.profile || {};
    next.preferences ||= {};
    next.preferences.autoLearnCorrections = autoLearn.checked;
    next.preferences.learnSensitiveFields = learnSensitive.checked;
    await chrome.storage.local.set({ profile: next });
  }
})();
