(function () {
  if (window.ApplyPilotFormAgent) return;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  const AUTO_FILL_THRESHOLD = 0.85;
  const SUGGEST_THRESHOLD = 0.55;

  const SENSITIVE_PATTERNS = [
    /gender|sex\b|性别/i, /race|ethnicity|ethnic|种族|族裔/i,
    /disability|disabled|残疾/i, /veteran|退伍军人/i,
    /religion|religious|宗教/i, /political|party affiliation|政治/i,
    /equal opportunity|eeo|diversity survey|平等就业|平等机会/i,
    /health|medical|illness|健康|疾病|病史/i,
    /criminal|conviction|felony|background check|犯罪|刑事/i
  ];

  const FIELD_PATTERNS = [
    ["personal.email", /e-?mail|email address|邮箱|电子邮件/i],
    ["personal.phone", /phone|mobile|telephone|contact number|手机号|电话|手机/i],
    ["personal.firstName", /first name|given name|forename|^名$/i],
    ["personal.middleName", /middle name|middle initial/i],
    ["personal.lastName", /last name|family name|surname|^姓$/i],
    ["personal.fullName", /full name|legal name|^name$|applicant name|姓名|名字/i],
    ["personal.chineseName", /chinese name|中文名|中文姓名/i],
    ["personal.preferredName", /preferred name|nickname|常用名|英文名/i],
    ["personal.location", /current location|location|city|所在地|城市|居住地/i],
    ["personal.address", /address|street|mailing address|地址|通讯地址/i],
    ["personal.nationality", /nationality|citizenship|国籍/i],
    ["personal.linkedin", /linkedin|领英/i], ["personal.github", /github/i],
    ["personal.portfolio", /portfolio|website|personal site|作品集|个人网站/i],
    ["visaSponsorship", /sponsorship|visa sponsorship|签证担保|需要担保/i],
    ["workAuthorization", /work authorization|authorized to work|work permit|visa status|工作许可|工作签证/i],
    ["summary", /summary|cover letter|about you|motivation|why|自我介绍|个人简介|求职信/i],
    ["skillsText", /skills?|technology|tech stack|技能|技术/i],
    ["languagesText", /languages?|语言/i],
    ["certificationsText", /certification|certificate|license|证书|资格/i],
    ["relocation", /relocat|willing to move|搬迁|异地|调动/i],
    ["desiredSalary", /salary|compensation|薪资|期望薪资/i],
    ["noticePeriod", /notice period|time to join|到岗|入职时间|通知期/i],
    ["availabilityDate", /available date|earliest start|可入职日期|开始工作/i]
  ];

  const AUTOCOMPLETE_PATHS = {
    email: "personal.email", tel: "personal.phone", name: "personal.fullName",
    "given-name": "personal.firstName", "additional-name": "personal.middleName",
    "family-name": "personal.lastName", "street-address": "personal.address",
    "address-line1": "personal.address", "address-level2": "personal.location",
    country: "personal.nationality", "country-name": "personal.nationality", url: "personal.portfolio"
  };

  const EDUCATION_PATTERNS = [
    ["school", /school|university|college|institution|学校|院校|大学/i],
    ["degree", /degree|qualification|education level|学位|学历/i],
    ["major", /major|field of study|discipline|专业/i],
    ["start", /start|from|begin|开始|入学/i], ["end", /end|to|graduation|结束|毕业/i],
    ["description", /description|detail|honors|courses|描述|详情|荣誉|课程/i]
  ];

  const EXPERIENCE_PATTERNS = [
    ["company", /company|employer|organization|公司|单位|机构/i],
    ["title", /title|position|role|job title|职位|岗位|角色/i],
    ["start", /start|from|begin|开始/i], ["end", /end|to|finish|结束/i],
    ["description", /description|responsibilities|achievement|duties|工作内容|职责|描述|业绩/i]
  ];

  async function scanPage() {
    await scanner.waitForStableFields();
    const model = scanner.understandPage();
    return {
      ok: true,
      count: model.fields.length,
      sections: scanner.summarizeSections(model),
      diagnostics: scanner.summarizeDiagnostics(model),
      addButtons: model.addButtons.map((button) => ({ type: button.type, text: button.text }))
    };
  }

  async function runAgent(profile, memory) {
    await scanner.waitForStableFields();
    const firstModel = scanner.understandPage();
    const rowPlan = planRows(firstModel, profile);
    const rowResult = await executePlan(rowPlan);
    await scanner.waitForStableFields(1800);
    const readyModel = scanner.understandPage();
    const fillPlan = planFields(readyModel, profile, memory);
    const fillResult = await executePlan(fillPlan);
    const finalModel = scanner.understandPage();
    const debugRows = fillPlan.filter((action) => action.debug).map((action) => action.debug);
    return {
      ok: true,
      mode: "frame-agent",
      scanned: firstModel.fields.length,
      filled: fillResult.filled,
      actions: rowResult.actions + fillResult.actions,
      sections: scanner.summarizeSections(finalModel),
      diagnostics: {
        ...scanner.summarizeDiagnostics(finalModel),
        ...summarizeDebugRows(debugRows),
        failed: fillResult.failed
      },
      uncertain: [...rowResult.uncertain, ...fillResult.uncertain].slice(0, 30),
      suggestions: fillResult.suggestions,
      planSummary: summarizePlan([...rowPlan, ...fillPlan]),
      debugRows
    };
  }

  function planRows(model, profile) {
    const plan = [];
    appendAddRows(plan, model, "education", validItems(profile?.education).length);
    appendAddRows(plan, model, "internship", validItems(profile?.experience).length);
    if (plan.length) plan.push({ type: "waitForRender", ms: 220 });
    return plan;
  }

  function appendAddRows(plan, model, type, needed) {
    if (!needed) return;
    const missing = Math.max(0, needed - model.sections[type].rows.length);
    const button = model.addButtons.find((item) => item.type === type) || model.addButtons.find((item) => item.type === "unknown");
    for (let index = 0; index < missing; index += 1) {
      if (!button) {
        plan.push({ type: "needsUser", reason: `missing-add-${type}-button`, section: type });
        return;
      }
      plan.push({ type: "click", targetId: button.id, reason: `add-${type}-row` });
      plan.push({ type: "waitForRows", section: type, minRows: model.sections[type].rows.length + index + 1, ms: 1400 });
    }
  }

  function planFields(model, profile, memory) {
    const plan = [];
    model.sections.basic.forEach((field) => plan.push(buildAction(field, getCandidate(field, profile, memory), profile)));
    appendArrayActions(plan, model.sections.education.rows, validItems(profile?.education), EDUCATION_PATTERNS, "education", memory, profile);
    appendArrayActions(plan, model.sections.internship.rows, validItems(profile?.experience), EXPERIENCE_PATTERNS, "experience", memory, profile);
    model.sections.longText.forEach((field) => plan.push(buildAction(field, getCandidate(field, profile, memory, "summary"), profile)));
    model.fields.forEach((field) => {
      if (!plan.some((action) => action.fieldId === field.id)) plan.push(buildAction(field, getCandidate(field, profile, memory), profile));
    });
    return plan.filter(Boolean);
  }

  function appendArrayActions(plan, rows, items, patterns, sourceName, memory, profile) {
    rows.slice(0, items.length).forEach((row, index) => {
      row.fields.forEach((field) => {
        const match = matchArrayKey(field, patterns, memory);
        const value = match.key ? items[index][match.key] : "";
        if (!hasValue(value)) return;
        plan.push(buildAction(field, {
          value, source: `${sourceName}.${index}.${match.key}`,
          matchedProfilePath: `${sourceName}.${index}.${match.key}`,
          score: match.score, confidence: match.score,
          matchSource: match.source, reason: match.reason
        }, profile, row.id));
      });
    });
  }

  function getCandidate(field, profile, memory, fallbackPath = "") {
    const semantic = window.ApplyPilotSemanticMatcher?.matchProfileField(field, memory);
    if (semantic?.source === "memory") {
      const value = semantic.value || getProfileValue(profile, semantic.key);
      if (hasValue(value)) return candidate(value, semantic.key || "memory", "memory", semantic.score, "semantic-memory-match");
    }
    const exactPath = matchAutocomplete(field.element) || matchRule(field);
    if (exactPath) {
      const value = getProfileValue(profile, exactPath);
      if (hasValue(value)) return candidate(value, exactPath, "rule", 0.92, "deterministic-field-match");
    }
    if (semantic?.key) {
      const value = semantic.value || getProfileValue(profile, semantic.key);
      if (hasValue(value)) return candidate(value, semantic.key, semantic.source || "semantic", semantic.score, "local-semantic-concept-match");
    }
    if (fallbackPath) return candidate(getProfileValue(profile, fallbackPath), fallbackPath, "fallback", 0.56, "fallback-profile-field");
    return candidate("", "", "skipped", 0, "no-match");
  }

  function candidate(value, path, source, score, reason) {
    return { value, source: path || "skipped", matchedProfilePath: path || "", matchSource: source, score: Number(score || 0), confidence: Number(score || 0), reason };
  }

  function matchRule(field) {
    for (const [path, pattern] of FIELD_PATTERNS) if (pattern.test(field.fieldTextNormalized)) return path;
    return "";
  }

  function matchAutocomplete(element) {
    const tokens = scanner.normalizeText(element.getAttribute("autocomplete")).split(" ").filter(Boolean);
    return tokens.map((token) => AUTOCOMPLETE_PATHS[token]).find(Boolean) || "";
  }

  function matchArrayKey(field, patterns, memory) {
    const section = field.section === "education" ? "education" : "experience";
    const semantic = window.ApplyPilotSemanticMatcher?.matchArrayField(field, section, memory);
    if (semantic?.source === "memory" && semantic.key) return { key: semantic.key, score: semantic.score || 0.9, source: "memory", reason: "array-memory-match" };
    for (const [key, pattern] of patterns) if (pattern.test(field.fieldTextNormalized)) return { key, score: 0.92, source: "rule", reason: "array-rule-match" };
    if (semantic?.key) return { key: semantic.key, score: semantic.score || 0, source: semantic.source || "semantic", reason: "array-semantic-match" };
    return { key: "", score: 0, source: "skipped", reason: "array-no-match" };
  }

  function buildAction(field, candidateValue, profile, rowId) {
    const debug = debugRow(field, candidateValue);
    if (isSensitive(field) && !profile?.preferences?.allowSensitiveAutofill) return debugOnly(field, candidateValue, debug, "sensitive-field-requires-explicit-preference");
    if (!hasValue(candidateValue.value)) return debugOnly(field, candidateValue, debug, "no-value");
    if (candidateValue.score < SUGGEST_THRESHOLD) return debugOnly(field, candidateValue, debug, "low-confidence");
    const base = fillAction(field, candidateValue.value, candidateValue.source, rowId);
    if (candidateValue.score < AUTO_FILL_THRESHOLD) {
      return { ...base, type: "suggest", suggestedType: base.type, debug: { ...debug, fillAction: "suggest", reason: "medium-confidence" } };
    }
    return { ...base, debug: { ...debug, fillAction: "fill", reason: "high-confidence" } };
  }

  function debugOnly(field, candidateValue, debug, reason) {
    return { type: "debugOnly", fieldId: field.id, value: candidateValue.value ?? "", source: candidateValue.source, debug: { ...debug, fillAction: "skip", reason } };
  }

  function fillAction(field, value, source, rowId) {
    if (field.control === "checkbox") return { type: "setChecked", fieldId: field.id, value, source, rowId };
    if (field.control === "radio") return { type: "selectRadio", fieldId: field.id, value, source, rowId };
    if (["native-select", "custom-select"].includes(field.control)) return { type: "selectOption", fieldId: field.id, value, source, rowId };
    if (field.kind === "date") return { type: "selectDate", fieldId: field.id, value, source, rowId };
    return { type: "inputText", fieldId: field.id, value, source, rowId };
  }

  async function executePlan(plan) {
    let filled = 0;
    let actions = 0;
    let suggestions = 0;
    let failed = 0;
    const uncertain = [];
    for (const action of plan) {
      if (action.type === "waitForRender") { await scanner.sleep(action.ms || 220); continue; }
      if (action.type === "waitForRows") { await scanner.waitForRows(action.section, action.minRows, action.ms); continue; }
      if (action.type === "needsUser") { uncertain.push(action); continue; }
      if (action.type === "debugOnly") continue;
      const element = scanner.findElementByApplyPilotId(action.fieldId || action.targetId);
      if (!element) { failed += 1; uncertain.push({ ...action, reason: "target-not-found" }); continue; }
      if (action.type === "suggest") {
        addSuggestion(element, action);
        suggestions += 1;
        actions += 1;
        continue;
      }
      const ok = await actionsApi.execute(action, element);
      actions += 1;
      if (ok && action.type !== "click") filled += 1;
      if (!ok) { failed += 1; uncertain.push({ ...action, label: scanner.getElementText(element), reason: "action-failed" }); }
      await scanner.sleep(70);
    }
    return { filled, actions, suggestions, failed, uncertain };
  }

  function addSuggestion(element, action) {
    const panel = getSuggestionPanel();
    const item = document.createElement("div");
    item.className = "applypilot-suggestion";
    item.innerHTML = `<div><strong>${escapeHtml(action.debug?.label || "Field")}</strong></div><div>Suggested: <code>${escapeHtml(preview(action.value))}</code></div><div>Score: ${escapeHtml(action.debug?.score || "")}</div><button type="button">Apply</button>`;
    item.querySelector("button").addEventListener("click", async () => {
      await actionsApi.execute({ ...action, type: action.suggestedType || "inputText" }, element);
      item.remove();
    });
    panel.appendChild(item);
  }

  function getSuggestionPanel() {
    let panel = document.querySelector("#applypilot-suggestion-panel");
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "applypilot-suggestion-panel";
    panel.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;max-height:50vh;overflow:auto;background:#fff;border:1px solid #cfd6e4;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px;font:13px system-ui;color:#17202a;";
    panel.innerHTML = "<strong>ApplyPilot suggestions</strong>";
    document.documentElement.appendChild(panel);
    return panel;
  }

  async function learnFromPage(profile, memory) {
    await scanner.waitForStableFields();
    const updated = { ...memory };
    let learned = 0;
    for (const element of scanner.getInteractiveFields()) {
      const value = scanner.getCurrentFieldValue(element);
      if (!value) continue;
      const field = scanner.describeField(element, learned);
      const match = getCandidate(field, profile, memory);
      let profilePath = scanner.normalizeText(match.value) === scanner.normalizeText(value) ? match.matchedProfilePath : "";
      let section = field.section;
      if (field.section === "education") profilePath = matchArrayKey(field, EDUCATION_PATTERNS, memory).key || profilePath;
      if (field.section === "internship") { profilePath = matchArrayKey(field, EXPERIENCE_PATTERNS, memory).key || profilePath; section = "experience"; }
      if (!window.confirm(`ApplyPilot memory\n\nSave this answer for future similar questions?\n\nQuestion: ${scanner.getElementText(element)}\nAnswer: ${preview(value)}`)) continue;
      const entry = window.ApplyPilotSemanticMatcher?.createMemoryEntry(field, value, profilePath, section) || { type: "literal", value, label: scanner.getElementText(element), section, updatedAt: Date.now() };
      updated[scanner.getFieldSignature(element)] = entry;
      updated[scanner.getLabelMemoryKey(element)] = entry;
      learned += 1;
    }
    await chrome.storage.local.set({ fieldMemory: updated });
    return { ok: true, learned, fieldMemory: updated };
  }

  function getProfileValue(profile, path) {
    if (!profile || !path) return "";
    const derived = {
      skillsText: Array.isArray(profile.skills) ? profile.skills.join(", ") : "",
      languagesText: Array.isArray(profile.languages) ? profile.languages.join(", ") : "",
      certificationsText: Array.isArray(profile.certifications) ? profile.certifications.join(", ") : ""
    };
    if (Object.prototype.hasOwnProperty.call(derived, path)) return derived[path];
    return path.split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : "", profile) ?? "";
  }

  function isSensitive(field) {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(field.fieldTextNormalized));
  }

  function debugRow(field, candidateValue) {
    return {
      selector: field.element.id ? `#${field.element.id}` : field.element.tagName.toLowerCase(),
      label: String(field.text || "").slice(0, 120), nearbyText: String(field.normalizedText || "").slice(0, 160),
      rootType: field.rootType, control: field.control,
      matchedProfilePath: candidateValue.matchedProfilePath || "", valuePreview: preview(candidateValue.value),
      score: Number(candidateValue.score || 0).toFixed(2), confidence: Number(candidateValue.confidence || 0).toFixed(2),
      source: candidateValue.matchSource || candidateValue.source || "skipped", fillAction: "skip", reason: candidateValue.reason || ""
    };
  }

  function summarizeDebugRows(rows) {
    return rows.reduce((summary, row) => {
      if (row.matchedProfilePath && row.valuePreview) summary.matched += 1;
      if (row.fillAction === "skip") summary.skipped += 1;
      if (row.reason === "sensitive-field-requires-explicit-preference") summary.sensitiveSkipped += 1;
      return summary;
    }, { matched: 0, skipped: 0, sensitiveSkipped: 0 });
  }

  function summarizePlan(plan) {
    return plan.reduce((summary, action) => { summary[action.type] = (summary[action.type] || 0) + 1; return summary; }, {});
  }

  function validItems(value) {
    return Array.isArray(value) ? value.filter((item) => item && Object.values(item).some((entry) => String(entry ?? "").trim())) : [];
  }

  function hasValue(value) {
    return value !== null && value !== undefined && (typeof value === "boolean" || String(value).trim() !== "");
  }

  function preview(value) {
    const text = String(value ?? "").replace(/\s+/g, " ");
    return text.length > 80 ? `${text.slice(0, 79)}...` : text;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  window.ApplyPilotFormAgent = { scanPage, runAgent, learnFromPage };
})();
