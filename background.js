const FRAME_COMMANDS = {
  APPLYPILOT_TAB_SCAN: "APPLYPILOT_SCAN_FRAME",
  APPLYPILOT_TAB_FILL: "APPLYPILOT_FILL_FRAME",
  APPLYPILOT_TAB_LEARN: "APPLYPILOT_LEARN_FRAME"
};

const MAX_MEMORY_ENTRIES = 1200;
const MAX_MONITOR_LOG_ENTRIES = 250;
let memoryWriteQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["profile", "fieldMemory", "memoryStats", "autofillMonitorLog"]);
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
      gender: "",
      birthDate: "",
      ethnicity: "",
      maritalStatus: "",
      politicalStatus: "",
      idType: "",
      idNumber: "",
      location: "",
      currentResidence: "",
      householdLocation: "",
      nativePlace: "",
      address: "",
      nationality: "",
      highestDegree: "",
      latestMajor: "",
      latestSchool: "",
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
      allowSensitiveAutofill: false,
      autoLearnCorrections: true,
      learnSensitiveFields: false
    }
  };

  if (!current.profile) {
    await chrome.storage.local.set({ profile: defaultProfile });
  } else {
    await chrome.storage.local.set({ profile: mergeDefaults(defaultProfile, current.profile) });
  }

  const initial = {};
  if (!current.fieldMemory) initial.fieldMemory = {};
  if (!current.memoryStats) initial.memoryStats = emptyMemoryStats();
  if (!current.autofillMonitorLog) initial.autofillMonitorLog = [];
  if (Object.keys(initial).length) await chrome.storage.local.set(initial);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "APPLYPILOT_MEMORY_UPSERT") {
    enqueueMemoryMutation(() => handleMemoryUpsert(message)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (message?.type === "APPLYPILOT_MONITOR_EVENT") {
    enqueueMemoryMutation(() => handleMonitorEvent(message.monitorEvent)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (message?.type === "APPLYPILOT_GET_MONITOR_STATS") {
    chrome.storage.local.get(["memoryStats", "autofillMonitorLog", "fieldMemory"]).then((stored) => {
      sendResponse({
        ok: true,
        stats: stored.memoryStats || emptyMemoryStats(),
        recentEvents: (stored.autofillMonitorLog || []).slice(-20).reverse(),
        memoryCount: Object.keys(stored.fieldMemory || {}).length
      });
    }).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

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

function enqueueMemoryMutation(task) {
  const run = memoryWriteQueue.then(task, task);
  memoryWriteQueue = run.catch(() => undefined);
  return run;
}

async function handleMemoryUpsert(message) {
  const entries = message.entries && typeof message.entries === "object" ? message.entries : {};
  const stored = await chrome.storage.local.get(["fieldMemory", "memoryStats", "autofillMonitorLog"]);
  const fieldMemory = { ...(stored.fieldMemory || {}) };
  const now = Date.now();

  for (const [key, entry] of Object.entries(entries)) {
    if (!key || !entry) continue;
    const previous = fieldMemory[key] || {};
    fieldMemory[key] = {
      ...previous,
      ...entry,
      createdAt: previous.createdAt || entry.createdAt || now,
      updatedAt: entry.updatedAt || now,
      seenCount: Number(previous.seenCount || 0) + 1
    };
  }

  const trimmedMemory = trimMemory(fieldMemory, MAX_MEMORY_ENTRIES);
  const stats = updateStats(stored.memoryStats || emptyMemoryStats(), message.monitorEvent, Object.keys(entries).length > 0);
  const log = appendMonitorEvent(stored.autofillMonitorLog || [], message.monitorEvent);
  await chrome.storage.local.set({ fieldMemory: trimmedMemory, memoryStats: stats, autofillMonitorLog: log });
  return { ok: true, saved: Object.keys(entries).length, stats, memoryCount: Object.keys(trimmedMemory).length };
}

async function handleMonitorEvent(event) {
  const stored = await chrome.storage.local.get(["memoryStats", "autofillMonitorLog"]);
  const stats = updateStats(stored.memoryStats || emptyMemoryStats(), event, false);
  const log = appendMonitorEvent(stored.autofillMonitorLog || [], event);
  await chrome.storage.local.set({ memoryStats: stats, autofillMonitorLog: log });
  return { ok: true, stats };
}

function updateStats(current, event, learned) {
  const stats = { ...emptyMemoryStats(), ...(current || {}) };
  const type = event?.eventType || "";
  if (learned) stats.totalLearned += 1;
  if (type === "corrected-autofill") stats.correctedAutofill += 1;
  if (type === "recovered-after-failure") stats.recoveredAfterFailure += 1;
  if (type === "manual-after-autofill") stats.manualAfterAutofill += 1;
  if (type === "autofill-failure") stats.failuresObserved += 1;
  if (type || learned) stats.lastUpdatedAt = event?.at || Date.now();
  return stats;
}

function appendMonitorEvent(log, event) {
  if (!event?.eventType) return log.slice(-MAX_MONITOR_LOG_ENTRIES);
  return [...log, { ...event, at: event.at || Date.now() }].slice(-MAX_MONITOR_LOG_ENTRIES);
}

function trimMemory(memory, limit) {
  const entries = Object.entries(memory);
  if (entries.length <= limit) return memory;
  return Object.fromEntries(entries
    .sort(([, left], [, right]) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
    .slice(0, limit));
}

function emptyMemoryStats() {
  return {
    totalLearned: 0,
    correctedAutofill: 0,
    recoveredAfterFailure: 0,
    manualAfterAutofill: 0,
    failuresObserved: 0,
    lastUpdatedAt: 0
  };
}

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

  const responses = frameCommand === "APPLYPILOT_LEARN_FRAME"
    ? await runLearnAcrossFrames(tabId, frames, payload)
    : await Promise.all(frames.map((frame) => sendFrameMessage(tabId, frame, payload)));

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

async function runLearnAcrossFrames(tabId, frames, payload) {
  const responses = [];
  let fieldMemory = { ...(payload.fieldMemory || {}) };
  for (const frame of frames) {
    const result = await sendFrameMessage(tabId, frame, { ...payload, fieldMemory });
    responses.push(result);
    if (result.response?.ok && result.response.fieldMemory) {
      fieldMemory = result.response.fieldMemory;
    }
  }
  return responses;
}

async function sendFrameMessage(tabId, frame, payload) {
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
    summary.labelledFields += number(response.diagnostics?.labelledFields);
    summary.unlabelledFields += number(response.diagnostics?.unlabelledFields);
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
    summary.labelledFields += number(response.diagnostics?.labelledFields);
    summary.unlabelledFields += number(response.diagnostics?.unlabelledFields);
    summary.actions += number(response.actions);
    summary.monitoringFrames += response.monitoring?.enabled ? 1 : 0;
    summary.pendingFailures += number(response.monitoring?.pendingFailures);
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
    monitoring: {
      enabled: summary.monitoringFrames > 0,
      pendingFailures: summary.pendingFailures
    },
    diagnostics: {
      ...summary,
      accessibleFrames: successful.length,
      totalFrames: allFrames.length,
      inaccessibleFrames: allFrames.length - successful.length
    },
    planSummary,
    uncertain: uncertain.slice(0, 50),
    debugRows: debugRows.slice(0, 180),
    frames: successful.map(frameSummary)
  };
}

async function aggregateLearn(successful, allFrames) {
  const fieldMemory = {};
  let learned = 0;
  successful.forEach((item) => {
    learned += number(item.response.learned);
    Object.assign(fieldMemory, item.response.fieldMemory || {});
  });
  await chrome.storage.local.set({ fieldMemory: trimMemory(fieldMemory, MAX_MEMORY_ENTRIES) });
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
    shadowFields: 0,
    labelledFields: 0,
    unlabelledFields: 0,
    monitoringFrames: 0,
    pendingFailures: 0
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
