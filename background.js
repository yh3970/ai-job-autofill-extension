const FRAME_COMMANDS = {
  APPLYPILOT_TAB_SCAN: "APPLYPILOT_SCAN_FRAME",
  APPLYPILOT_TAB_FILL: "APPLYPILOT_FILL_FRAME",
  APPLYPILOT_TAB_LEARN: "APPLYPILOT_LEARN_FRAME"
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["profile", "fieldMemory"]);
  const defaultProfile = {
    personal: {
      firstName: "",
      middleName: "",
      lastName: "",
      fullName: "",
      chineseName: "",
      preferredName: "",
      email: "",
      phone: "",
      location: "",
      address: "",
      nationality: "",
      linkedin: "",
      github: "",
      portfolio: ""
    },
    summary: "",
    workAuthorization: "",
    visaSponsorship: "",
    relocation: "",
    desiredSalary: "",
    noticePeriod: "",
    availabilityDate: "",
    education: [],
    experience: [],
    projects: [],
    certifications: [],
    languages: [],
    skills: [],
    resumeText: "",
    resumeFiles: [],
    preferences: {
      allowSensitiveAutofill: false
    }
  };

  if (!current.profile) {
    await chrome.storage.local.set({ profile: defaultProfile });
  } else {
    await chrome.storage.local.set({ profile: mergeDefaults(defaultProfile, current.profile) });
  }

  if (!current.fieldMemory) {
    await chrome.storage.local.set({ fieldMemory: {} });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const frameCommand = FRAME_COMMANDS[message?.type];
  if (!frameCommand) return false;

  runAcrossFrames(message.tabId, frameCommand, message)
    .then(sendResponse)
    .catch((error) => {
      console.error("ApplyPilot frame command failed", error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
});

async function runAcrossFrames(tabId, frameCommand, message) {
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: "missing-tab-id" };
  }

  const frames = await getFrames(tabId);
  const payload = {
    type: frameCommand,
    profile: message.profile,
    fieldMemory: message.fieldMemory || {}
  };

  const responses = await Promise.all(frames.map(async (frame) => {
    try {
      const response = await chrome.tabs.sendMessage(tabId, payload, { frameId: frame.frameId });
      return {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url || "",
        response
      };
    } catch (error) {
      return {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url || "",
        response: null,
        error: error?.message || String(error)
      };
    }
  }));

  const successful = responses.filter((item) => item.response?.ok);
  if (!successful.length) {
    return {
      ok: false,
      error: "no-accessible-form-frames",
      frameErrors: responses.filter((item) => item.error).map((item) => ({
        frameId: item.frameId,
        url: item.url,
        error: item.error
      }))
    };
  }

  if (frameCommand === "APPLYPILOT_SCAN_FRAME") {
    return aggregateScan(successful, responses);
  }
  if (frameCommand === "APPLYPILOT_FILL_FRAME") {
    return aggregateFill(successful, responses);
  }
  return aggregateLearn(successful, responses);
}

async function getFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (Array.isArray(frames) && frames.length) {
      return frames.map((frame) => ({
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url || ""
      }));
    }
  } catch (error) {
    console.warn("ApplyPilot could not enumerate frames", error);
  }
  return [{ frameId: 0, parentFrameId: -1, url: "" }];
}

function aggregateScan(successful, allFrames) {
  const summary = emptySummary();
  successful.forEach((item) => {
    const response = item.response;
    summary.scanned += number(response.count);
    summary.domFields += number(response.diagnostics?.domFields);
    summary.shadowFields += number(response.diagnostics?.shadowFields);
    if (item.frameId === 0) summary.topFrameFields += number(response.count);
    else summary.iframeFields += number(response.count);
  });

  return {
    ok: true,
    count: summary.scanned,
    diagnostics: {
      ...summary,
      accessibleFrames: successful.length,
      totalFrames: allFrames.length,
      inaccessibleFrames: allFrames.length - successful.length
    },
    frames: successful.map(frameSummary)
  };
}

function aggregateFill(successful, allFrames) {
  const summary = emptySummary();
  const uncertain = [];
  const debugRows = [];
  const planSummary = {};

  successful.forEach((item) => {
    const response = item.response;
    summary.scanned += number(response.scanned);
    summary.filled += number(response.filled);
    summary.matched += number(response.diagnostics?.matched);
    summary.suggestions += number(response.suggestions);
    summary.skipped += number(response.diagnostics?.skipped);
    summary.sensitiveSkipped += number(response.diagnostics?.sensitiveSkipped);
    summary.failed += number(response.diagnostics?.failed);
    summary.domFields += number(response.diagnostics?.domFields);
    summary.shadowFields += number(response.diagnostics?.shadowFields);
    summary.actions += number(response.actions);
    if (item.frameId === 0) summary.topFrameFields += number(response.scanned);
    else summary.iframeFields += number(response.scanned);

    for (const [key, value] of Object.entries(response.planSummary || {})) {
      planSummary[key] = number(planSummary[key]) + number(value);
    }

    (response.uncertain || []).slice(0, 20).forEach((entry) => {
      uncertain.push({ ...entry, frameId: item.frameId });
    });
    (response.debugRows || []).slice(0, 80).forEach((entry) => {
      debugRows.push({ ...entry, frameId: item.frameId });
    });
  });

  return {
    ok: true,
    mode: "multi-frame-agent",
    scanned: summary.scanned,
    filled: summary.filled,
    actions: summary.actions,
    suggestions: summary.suggestions,
    diagnostics: {
      ...summary,
      accessibleFrames: successful.length,
      totalFrames: allFrames.length,
      inaccessibleFrames: allFrames.length - successful.length
    },
    planSummary,
    uncertain: uncertain.slice(0, 40),
    debugRows: debugRows.slice(0, 160),
    frames: successful.map(frameSummary)
  };
}

function aggregateLearn(successful, allFrames) {
  const fieldMemory = {};
  let learned = 0;
  successful.forEach((item) => {
    learned += number(item.response.learned);
    Object.assign(fieldMemory, item.response.fieldMemory || {});
  });
  return {
    ok: true,
    learned,
    fieldMemory,
    accessibleFrames: successful.length,
    totalFrames: allFrames.length
  };
}

function frameSummary(item) {
  return {
    frameId: item.frameId,
    parentFrameId: item.parentFrameId,
    url: item.url,
    count: number(item.response?.count ?? item.response?.scanned),
    filled: number(item.response?.filled),
    shadowFields: number(item.response?.diagnostics?.shadowFields)
  };
}

function emptySummary() {
  return {
    scanned: 0,
    filled: 0,
    matched: 0,
    suggestions: 0,
    skipped: 0,
    sensitiveSkipped: 0,
    failed: 0,
    actions: 0,
    topFrameFields: 0,
    iframeFields: 0,
    domFields: 0,
    shadowFields: 0
  };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function mergeDefaults(defaults, current) {
  if (Array.isArray(defaults)) return Array.isArray(current) ? current : defaults;
  if (!defaults || typeof defaults !== "object") return current ?? defaults;
  const merged = { ...defaults, ...(current || {}) };
  Object.keys(defaults).forEach((key) => {
    merged[key] = mergeDefaults(defaults[key], current?.[key]);
  });
  return merged;
}
