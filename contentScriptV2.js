(function () {
  if (window.__APPLYPILOT_CONTENT_SCRIPT_V2__) return;
  window.__APPLYPILOT_CONTENT_SCRIPT_V2__ = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const agent = window.ApplyPilotFormAgent;
    if (!agent) {
      sendResponse({ ok: false, error: "form-agent-not-loaded" });
      return false;
    }
    if (["APPLYPILOT_SCAN", "APPLYPILOT_SCAN_FRAME"].includes(message.type)) {
      agent.scanPage().then(sendResponse).catch((error) => respondError(error, sendResponse));
      return true;
    }
    if (["APPLYPILOT_FILL", "APPLYPILOT_FILL_FRAME"].includes(message.type)) {
      agent.runAgent(message.profile, message.fieldMemory || {}).then(sendResponse).catch((error) => respondError(error, sendResponse));
      return true;
    }
    if (["APPLYPILOT_LEARN", "APPLYPILOT_LEARN_FRAME"].includes(message.type)) {
      agent.learnFromPage(message.profile, message.fieldMemory || {}).then(sendResponse).catch((error) => respondError(error, sendResponse));
      return true;
    }
    return false;
  });

  function respondError(error, sendResponse) {
    console.error("ApplyPilot content script error", error);
    sendResponse({ ok: false, error: error?.message || String(error) });
  }
})();
