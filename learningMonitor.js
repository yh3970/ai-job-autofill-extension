(function () {
  if (window.__APPLYPILOT_LEARNING_MONITOR__) return;
  window.__APPLYPILOT_LEARNING_MONITOR__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const matcher = window.ApplyPilotSemanticMatcher;
  const actionsApi = window.ApplyPilotFormActions;
  const agent = window.ApplyPilotFormAgent;
  if (!scanner || !matcher || !actionsApi || !agent) return;

  const SENSITIVE_PATTERNS = [
    /gender|sex\b|性别/i,
    /birth|birthday|dob|出生|生日/i,
    /race|ethnicity|ethnic|民族|种族|族裔/i,
    /marital|marriage|婚姻/i,
    /political|party affiliation|政治面貌/i,
    /id number|identity|身份证|证件号码|证件类型/i,
    /disability|disabled|残疾/i,
    /health|medical|illness|疾病|病史|健康/i,
    /criminal|conviction|felony|犯罪|刑事/i
  ];

  const state = {
    active: false,
    profile: null,
    attempts: new Map(),
    lastFocused: null,
    timers: new Map(),
    savedValues: new Map(),
    learnedThisSession: 0,
    startedAt: 0
  };

  const originalExecute = actionsApi.execute.bind(actionsApi);
  actionsApi.execute = async function monitoredExecute(action, element) {
    const field = safeDescribe(element);
    const fieldId = action.fieldId || field?.id || element?.getAttribute(scanner.AP_ID) || "";
    const beforeValue = element ? scanner.getDisplayFieldValue(element) : "";
    const result = await originalExecute(action, element);
    const ok = result === true || result?.ok === true;

    if (fieldId) {
      state.attempts.set(fieldId, {
        ok,
        expectedValue: action.value,
        beforeValue,
        reason: result?.reason || (ok ? "" : "action-failed"),
        method: result?.method || "",
        label: field?.text || action.debug?.label || "",
        section: field?.section || "profile",
        control: field?.control || "",
        at: Date.now()
      });
    }

    if (!ok && field) {
      recordMonitorEvent({
        eventType: "autofill-failure",
        field,
        expectedValue: action.value,
        reason: result?.reason || "action-failed",
        method: result?.method || ""
      });
    }
    return result;
  };

  const originalRunAgent = agent.runAgent.bind(agent);
  agent.runAgent = async function monitoredRunAgent(profile, memory) {
    state.active = true;
    state.profile = profile || {};
    state.attempts.clear();
    state.savedValues.clear();
    state.learnedThisSession = 0;
    state.startedAt = Date.now();

    const result = await originalRunAgent(profile, memory);
    return {
      ...result,
      monitoring: {
        enabled: isAutoLearningEnabled(),
        learnedThisSession: state.learnedThisSession,
        pendingFailures: Array.from(state.attempts.values()).filter((item) => !item.ok).length
      }
    };
  };

  document.addEventListener("focusin", (event) => {
    if (!event.isTrusted) return;
    const field = findInteractiveTarget(event.target);
    if (field) state.lastFocused = field;
  }, true);

  document.addEventListener("input", (event) => {
    if (!event.isTrusted) return;
    scheduleCapture(findInteractiveTarget(event.target), "trusted-input", 650);
  }, true);

  document.addEventListener("change", (event) => {
    if (!event.isTrusted) return;
    scheduleCapture(findInteractiveTarget(event.target), "trusted-change", 120);
  }, true);

  document.addEventListener("blur", (event) => {
    if (!event.isTrusted) return;
    scheduleCapture(findInteractiveTarget(event.target), "trusted-blur", 60);
  }, true);

  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !state.active) return;
    const option = event.target?.closest?.([
      "[role='option']", "option", "[class*='option']", "[class*='menu-item']",
      "[class*='dropdown-item']", "li", "label"
    ].join(","));
    if (option && state.lastFocused) scheduleCapture(state.lastFocused, "trusted-option-click", 260);
  }, true);

  function scheduleCapture(element, trigger, delay) {
    if (!state.active || !element || !isAutoLearningEnabled()) return;
    const id = scanner.ensureApplyPilotId(element, "monitor");
    clearTimeout(state.timers.get(id));
    state.timers.set(id, window.setTimeout(() => {
      state.timers.delete(id);
      captureUserValue(element, trigger).catch((error) => console.warn("ApplyPilot learning monitor failed", error));
    }, delay));
  }

  async function captureUserValue(element, trigger) {
    if (!element?.isConnected || !state.active || !isAutoLearningEnabled()) return;
    const field = safeDescribe(element);
    if (!field || !field.text || isUnsupportedField(element)) return;
    if (isSensitiveField(field) && !canLearnSensitiveFields()) return;

    const value = scanner.getDisplayFieldValue(element);
    if (!hasUsefulValue(value)) return;

    const attempt = state.attempts.get(field.id);
    const currentNormalized = normalizeValue(value);
    const expectedNormalized = normalizeValue(attempt?.expectedValue);
    let eventType = "manual-after-autofill";

    if (attempt?.ok) {
      if (currentNormalized === expectedNormalized) return;
      eventType = "corrected-autofill";
    } else if (attempt && !attempt.ok) {
      eventType = "recovered-after-failure";
    }

    const saveKey = `${scanner.getLabelMemoryKey(element)}|${currentNormalized}`;
    if (state.savedValues.get(field.id) === saveKey) return;
    state.savedValues.set(field.id, saveKey);

    const profilePath = inferProfilePath(state.profile, value);
    const section = field.section === "internship" ? "experience" : field.section;
    const entry = matcher.createMemoryEntry(field, value, profilePath, section);
    const canonicalLabel = scanner.canonicalizeLabel(field.text);
    Object.assign(entry, {
      learnedBy: "automatic-monitor",
      learningReason: eventType,
      trigger,
      hostname: location.hostname,
      pagePath: location.pathname,
      fieldName: element.getAttribute("name") || "",
      fieldId: element.id || "",
      control: field.control,
      aliases: [field.text, field.fieldTextNormalized, canonicalLabel].filter(Boolean),
      expectedValue: attempt?.expectedValue ?? "",
      failureReason: attempt?.reason || "",
      updatedAt: Date.now()
    });

    const universalKey = `universal_${scanner.hashText(`${canonicalLabel}|${section}|${field.control}`)}`;
    const entries = {
      [scanner.getFieldSignature(element)]: entry,
      [scanner.getLabelMemoryKey(element)]: entry,
      [universalKey]: entry
    };

    const response = await chrome.runtime.sendMessage({
      type: "APPLYPILOT_MEMORY_UPSERT",
      entries,
      monitorEvent: {
        eventType,
        label: field.text,
        value: preview(value),
        expectedValue: preview(attempt?.expectedValue),
        reason: attempt?.reason || "",
        hostname: location.hostname,
        pagePath: location.pathname,
        at: Date.now()
      }
    }).catch(() => null);

    if (response?.ok) state.learnedThisSession += 1;
  }

  function recordMonitorEvent({ eventType, field, expectedValue, reason, method }) {
    chrome.runtime.sendMessage({
      type: "APPLYPILOT_MONITOR_EVENT",
      monitorEvent: {
        eventType,
        label: field.text,
        expectedValue: preview(expectedValue),
        reason,
        method,
        hostname: location.hostname,
        pagePath: location.pathname,
        at: Date.now()
      }
    }).catch(() => null);
  }

  function safeDescribe(element) {
    try {
      return element ? scanner.describeField(element, 0) : null;
    } catch (error) {
      return null;
    }
  }

  function findInteractiveTarget(target) {
    if (!(target instanceof Element)) return null;
    if (target.matches(scanner.FIELD_SELECTOR)) return target;
    const wrapper = target.closest("[role='combobox'], [role='radio'], [role='checkbox'], [class*='select'], [class*='picker'], label");
    if (!wrapper) return null;
    if (wrapper.matches(scanner.FIELD_SELECTOR)) return wrapper;
    return wrapper.querySelector("input:not([type='hidden']), textarea, select, [contenteditable='true'], [role='combobox'], [role='radio'], [role='checkbox']") || state.lastFocused;
  }

  function inferProfilePath(profile, expectedValue) {
    const expected = normalizeValue(expectedValue);
    if (!expected || !profile) return "";
    const matches = [];

    walkProfile(profile, "", (path, value) => {
      if (!path || /resumeText|apiKey|preferences|resumeFiles/.test(path)) return;
      if (normalizeValue(value) === expected) matches.push(path);
    });

    return matches.sort((left, right) => profilePathPriority(left) - profilePathPriority(right))[0] || "";
  }

  function walkProfile(value, path, visitor) {
    if (value === null || value === undefined) return;
    if (["string", "number", "boolean"].includes(typeof value)) {
      visitor(path, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walkProfile(item, path ? `${path}.${index}` : String(index), visitor));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => walkProfile(child, path ? `${path}.${key}` : key, visitor));
    }
  }

  function profilePathPriority(path) {
    if (path.startsWith("personal.")) return 1;
    if (/^(workAuthorization|visaSponsorship|relocation|desiredSalary|noticePeriod|availabilityDate)$/.test(path)) return 2;
    if (path.startsWith("education.")) return 3;
    if (path.startsWith("experience.")) return 4;
    return 9;
  }

  function isAutoLearningEnabled() {
    return state.profile?.preferences?.autoLearnCorrections !== false;
  }

  function canLearnSensitiveFields() {
    return state.profile?.preferences?.learnSensitiveFields === true;
  }

  function isSensitiveField(field) {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(field.fieldTextNormalized || field.text || ""));
  }

  function isUnsupportedField(element) {
    const type = String(element.getAttribute("type") || "").toLowerCase();
    return ["password", "file", "hidden", "submit", "button"].includes(type);
  }

  function hasUsefulValue(value) {
    const text = String(value ?? "").trim();
    return Boolean(text) && !/^(请选择|--请选择--|请输入|年|月|please select|select|choose)$/i.test(text);
  }

  function normalizeValue(value) {
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function preview(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  }

  window.ApplyPilotLearningMonitor = {
    getState() {
      return {
        active: state.active,
        attempts: state.attempts.size,
        learnedThisSession: state.learnedThisSession,
        pendingFailures: Array.from(state.attempts.values()).filter((item) => !item.ok).length
      };
    }
  };
})();
