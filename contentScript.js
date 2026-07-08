(function () {
  const AP_ID = "data-applypilot-id";
  const WAIT_MS = 220;

  const SECTION_PATTERNS = {
    basic: [
      /basic|personal|contact|candidate|applicant/i,
      /\u57fa\u672c|\u4e2a\u4eba|\u8054\u7cfb|\u7533\u8bf7\u4eba|\u5019\u9009\u4eba/
    ],
    education: [
      /education|academic|school|university|college/i,
      /\u6559\u80b2|\u5b66\u5386|\u5b66\u6821|\u9662\u6821|\u5927\u5b66/
    ],
    internship: [
      /internship|intern|experience|employment|work history|career/i,
      /\u5b9e\u4e60|\u5de5\u4f5c\u7ecf\u5386|\u5de5\u4f5c|\u804c\u4e1a|\u7ecf\u5386/
    ],
    longText: [
      /cover letter|summary|statement|motivation|why|introduction|description/i,
      /\u6c42\u804c\u4fe1|\u81ea\u6211\u4ecb\u7ecd|\u4e2a\u4eba\u7b80\u4ecb|\u52a8\u673a|\u4e3a\u4ec0\u4e48|\u63cf\u8ff0/
    ]
  };

  const FIELD_PATTERNS = [
    ["personal.email", /e-?mail|email address|\u90ae\u7bb1|\u7535\u5b50\u90ae\u4ef6/i],
    ["personal.phone", /phone|mobile|telephone|tel|\u7535\u8bdd|\u624b\u673a/i],
    ["personal.firstName", /first name|given name|\u540d$/i],
    ["personal.middleName", /middle name/i],
    ["personal.lastName", /last name|family name|surname|\u59d3$/i],
    ["personal.fullName", /full name|^name$|applicant name|\u59d3\u540d|\u540d\u5b57/i],
    ["personal.chineseName", /chinese name|\u4e2d\u6587\u540d/i],
    ["personal.preferredName", /preferred name|nickname|\u5e38\u7528\u540d|\u82f1\u6587\u540d/i],
    ["personal.location", /current location|location|city|\u6240\u5728\u5730|\u57ce\u5e02/i],
    ["personal.address", /address|street|\u5730\u5740/i],
    ["personal.nationality", /nationality|citizenship|\u56fd\u7c4d/i],
    ["personal.linkedin", /linkedin|\u9886\u82f1/i],
    ["personal.github", /github/i],
    ["personal.portfolio", /portfolio|website|personal site|\u4f5c\u54c1\u96c6|\u4e2a\u4eba\u7f51\u7ad9/i],
    ["summary", /summary|cover letter|about you|motivation|why|\u81ea\u6211\u4ecb\u7ecd|\u4e2a\u4eba\u7b80\u4ecb|\u6c42\u804c\u4fe1/i],
    ["skillsText", /skill|technology|tech stack|\u6280\u80fd|\u6280\u672f/i],
    ["languagesText", /language|\u8bed\u8a00/i],
    ["certificationsText", /certification|certificate|license|\u8bc1\u4e66|\u8d44\u683c/i],
    ["workAuthorization", /work authorization|authorized to work|visa|\u5de5\u4f5c\u8bb8\u53ef|\u7b7e\u8bc1/i],
    ["visaSponsorship", /sponsorship|visa sponsorship|\u7b7e\u8bc1\u62c5\u4fdd/i],
    ["relocation", /relocat|willing to move|\u642c\u8fc1|\u5f02\u5730/i],
    ["desiredSalary", /salary|compensation|\u85aa\u8d44|\u671f\u671b\u85aa\u8d44/i],
    ["noticePeriod", /notice period|\u5230\u5c97|\u5165\u804c\u65f6\u95f4/i],
    ["availabilityDate", /available date|start date|\u53ef\u5165\u804c\u65e5\u671f|\u5f00\u59cb\u5de5\u4f5c/i]
  ];

  const EDUCATION_PATTERNS = [
    ["school", /school|university|college|institution|\u5b66\u6821|\u9662\u6821|\u5927\u5b66/i],
    ["degree", /degree|qualification|\u5b66\u4f4d|\u5b66\u5386/i],
    ["major", /major|field of study|discipline|\u4e13\u4e1a/i],
    ["start", /start|from|begin|\u5f00\u59cb/i],
    ["end", /end|to|graduation|\u7ed3\u675f|\u6bd5\u4e1a/i],
    ["description", /description|detail|\u63cf\u8ff0|\u8be6\u60c5/i]
  ];

  const EXPERIENCE_PATTERNS = [
    ["company", /company|employer|organization|\u516c\u53f8|\u5355\u4f4d|\u673a\u6784/i],
    ["title", /title|position|role|job|\u804c\u4f4d|\u5c97\u4f4d|\u89d2\u8272/i],
    ["start", /start|from|begin|\u5f00\u59cb/i],
    ["end", /end|to|finish|\u7ed3\u675f/i],
    ["description", /description|responsibilities|achievement|detail|\u5de5\u4f5c\u5185\u5bb9|\u804c\u8d23|\u63cf\u8ff0/i]
  ];

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "APPLYPILOT_SCAN") {
      scanPage().then(sendResponse);
      return true;
    }
    if (message.type === "APPLYPILOT_FILL") {
      runAgent(message.profile, message.fieldMemory || {}).then(sendResponse);
      return true;
    }
    if (message.type === "APPLYPILOT_LEARN") {
      learnFromPage(message.profile, message.fieldMemory || {}).then(sendResponse);
      return true;
    }
  });

  async function scanPage() {
    const model = understandPage();
    return {
      ok: true,
      count: model.fields.length,
      sections: summarizeSections(model),
      addButtons: model.addButtons.map((button) => ({ type: button.type, text: button.text }))
    };
  }

  async function runAgent(profile, memory) {
    const firstModel = understandPage();
    const rowPlan = planRowPreparation(firstModel, profile);
    const rowResult = await executePlan(rowPlan, profile);
    const readyModel = understandPage();
    const fillPlan = planFillActions(readyModel, profile, memory);
    const fillResult = await executePlan(fillPlan, profile);
    const finalModel = understandPage();
    return {
      ok: true,
      mode: "agent",
      scanned: firstModel.fields.length,
      filled: fillResult.filled,
      actions: rowResult.actions + fillResult.actions,
      sections: summarizeSections(finalModel),
      uncertain: [...rowResult.uncertain, ...fillResult.uncertain].slice(0, 20),
      planSummary: summarizePlan([...rowPlan, ...fillPlan])
    };
  }

  function understandPage() {
    const fields = getInteractiveFields().map((element, index) => describeField(element, index));
    const sections = {
      basic: fields.filter((field) => field.section === "basic"),
      education: buildArraySection(fields, "education"),
      internship: buildArraySection(fields, "internship"),
      longText: fields.filter((field) => field.section === "longText")
    };
    const addButtons = findAddButtons();
    return { fields, sections, addButtons };
  }

  function planRowPreparation(model, profile) {
    const actions = [];
    const educationItems = Array.isArray(profile?.education) ? profile.education.filter(hasAnyValue) : [];
    const experienceItems = Array.isArray(profile?.experience) ? profile.experience.filter(hasAnyValue) : [];

    appendAddRowActions(actions, model, "education", educationItems.length);
    appendAddRowActions(actions, model, "internship", experienceItems.length);
    if (actions.length) actions.push({ type: "waitForRender", reason: "after-row-planning", ms: WAIT_MS });
    return actions;
  }

  function planFillActions(model, profile, memory) {
    const actions = [];
    const educationItems = Array.isArray(profile?.education) ? profile.education.filter(hasAnyValue) : [];
    const experienceItems = Array.isArray(profile?.experience) ? profile.experience.filter(hasAnyValue) : [];

    for (const field of model.sections.basic) {
      const candidate = getProfileCandidate(field, profile, memory);
      if (candidate.value) actions.push(fillAction(field, candidate.value, candidate.source));
    }

    appendArrayFillActions(actions, model.sections.education.rows, educationItems, EDUCATION_PATTERNS, "education");
    appendArrayFillActions(actions, model.sections.internship.rows, experienceItems, EXPERIENCE_PATTERNS, "experience");

    for (const field of model.sections.longText) {
      const candidate = getProfileCandidate(field, profile, memory, "summary");
      if (candidate.value) actions.push(fillAction(field, candidate.value, candidate.source));
    }

    for (const field of model.fields) {
      if (actions.some((action) => action.fieldId === field.id)) continue;
      const candidate = getProfileCandidate(field, profile, memory);
      if (candidate.value) actions.push(fillAction(field, candidate.value, candidate.source));
    }

    return actions;
  }

  function appendAddRowActions(actions, model, type, neededCount) {
    if (!neededCount) return;
    const section = model.sections[type];
    const missing = Math.max(0, neededCount - section.rows.length);
    const button = model.addButtons.find((item) => item.type === type) || model.addButtons.find((item) => item.type === "unknown");
    for (let index = 0; index < missing; index += 1) {
      if (!button) {
        actions.push({ type: "needsUser", reason: `missing-add-${type}-button`, section: type });
        break;
      }
      actions.push({ type: "click", targetId: button.id, reason: `add-${type}-row` });
      actions.push({ type: "waitForRows", section: type, minRows: section.rows.length + index + 1, ms: 1200 });
    }
  }

  function appendArrayFillActions(actions, rows, items, patterns, sourceName) {
    rows.slice(0, items.length).forEach((row, index) => {
      const item = items[index];
      for (const field of row.fields) {
        const key = matchItemKey(field, patterns);
        if (!key || !item[key]) continue;
        actions.push(fillAction(field, item[key], `${sourceName}.${index}.${key}`, row.id));
      }
    });
  }

  function fillAction(field, value, source, rowId) {
    if (field.control === "native-select" || field.control === "custom-select") {
      return { type: "selectOption", fieldId: field.id, value, source, rowId };
    }
    if (field.kind === "date") {
      return { type: "selectDate", fieldId: field.id, value, source, rowId };
    }
    return { type: "inputText", fieldId: field.id, value, source, rowId };
  }

  async function executePlan(plan, profile) {
    let model = understandPage();
    let filled = 0;
    let actions = 0;
    const uncertain = [];

    for (const action of plan) {
      if (action.type === "refreshModel") {
        model = understandPage();
        continue;
      }
      if (action.type === "waitForRender") {
        await sleep(action.ms || WAIT_MS);
        continue;
      }
      if (action.type === "waitForRows") {
        await waitForRows(action.section, action.minRows, action.ms || 1200);
        model = understandPage();
        continue;
      }
      if (action.type === "needsUser") {
        uncertain.push(action);
        continue;
      }

      const element = document.querySelector(`[${AP_ID}="${cssEscape(action.fieldId || action.targetId)}"]`);
      if (!element) {
        uncertain.push({ ...action, reason: "target-not-found" });
        continue;
      }

      let ok = false;
      if (action.type === "click") ok = await clickElement(element);
      if (action.type === "inputText") ok = await inputText(element, action.value);
      if (action.type === "selectOption") ok = await selectOption(element, action.value);
      if (action.type === "selectDate") ok = await selectDate(element, action.value);

      actions += 1;
      if (ok && action.type !== "click") filled += 1;
      if (!ok) uncertain.push({ ...action, label: getElementText(element), reason: "action-failed" });
      await sleep(60);
    }

    return { filled, actions, uncertain };
  }

  async function learnFromPage(profile, memory) {
    const fields = getInteractiveFields();
    const updated = { ...memory };
    let learned = 0;

    for (const field of fields) {
      const value = getCurrentFieldValue(field);
      if (!value) continue;
      const described = describeField(field, learned);
      const label = normalizeText(getElementText(field));
      const entry = window.ApplyPilotSemanticMatcher?.createMemoryEntry(described, value, "", described.section) ||
        { type: "literal", value, label, section: described.section, updatedAt: Date.now() };
      updated[getFieldSignature(field)] = entry;
      updated[getLabelMemoryKey(field)] = entry;
      learned += 1;
    }

    await chrome.storage.local.set({ fieldMemory: updated });
    return { ok: true, learned, fieldMemory: updated };
  }

  function getInteractiveFields() {
    return Array.from(document.querySelectorAll([
      "input",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[role='combobox']"
    ].join(","))).filter((element) => {
      const type = getFieldType(element);
      return isVisible(element) && !element.disabled && !element.readOnly &&
        !["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type);
    });
  }

  function describeField(element, index) {
    const id = ensureApplyPilotId(element, `field-${index}`);
    const text = getElementText(element);
    const sectionText = getSectionText(element);
    return {
      id,
      text,
      fieldTextNormalized: normalizeText(text),
      normalizedText: normalizeText(`${sectionText} ${text}`),
      section: classifySection(`${sectionText} ${text}`),
      control: getControlType(element),
      kind: getFieldKind(element, text),
      rowKey: getRowKey(element),
      element
    };
  }

  function buildArraySection(fields, sectionType) {
    const sectionFields = fields.filter((field) => field.section === sectionType);
    const grouped = new Map();
    for (const field of sectionFields) {
      const key = field.rowKey || field.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(field);
    }
    const rows = Array.from(grouped.entries()).map(([id, rowFields]) => ({ id, fields: rowFields }));
    return { fields: sectionFields, rows };
  }

  function findAddButtons() {
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button'], input[type='button']"))
      .filter(isVisible)
      .map((element, index) => {
        const text = normalizeText(element.innerText || element.value || element.getAttribute("aria-label") || element.title || "");
        const id = ensureApplyPilotId(element, `button-${index}`);
        return { id, element, text, type: classifyAddButton(text) };
      });
    return candidates.filter((item) => /add|new|create|\+|\u6dfb\u52a0|\u65b0\u589e|\u589e\u52a0/.test(item.text));
  }

  function classifyAddButton(text) {
    if (SECTION_PATTERNS.education.some((pattern) => pattern.test(text))) return "education";
    if (SECTION_PATTERNS.internship.some((pattern) => pattern.test(text))) return "internship";
    return "unknown";
  }

  function classifySection(text) {
    const normalized = normalizeText(text);
    if (SECTION_PATTERNS.education.some((pattern) => pattern.test(normalized))) return "education";
    if (SECTION_PATTERNS.internship.some((pattern) => pattern.test(normalized))) return "internship";
    if (SECTION_PATTERNS.longText.some((pattern) => pattern.test(normalized))) return "longText";
    return "basic";
  }

  function matchProfilePath(field, memory) {
    const semanticMatch = window.ApplyPilotSemanticMatcher?.matchProfileField(field, memory);
    if (semanticMatch?.key) return semanticMatch.key;
    const memoryEntry = memory[getFieldSignature(field.element)] || memory[getLabelMemoryKey(field.element)];
    if (memoryEntry?.profilePath) return memoryEntry.profilePath;
    for (const [path, pattern] of FIELD_PATTERNS) {
      if (pattern.test(field.fieldTextNormalized) || pattern.test(field.normalizedText)) return path;
    }
    return "";
  }

  function getProfileCandidate(field, profile, memory, fallbackPath = "") {
    const semanticMatch = window.ApplyPilotSemanticMatcher?.matchProfileField(field, memory);
    if (semanticMatch?.value) return { value: semanticMatch.value, source: "memory" };
    if (semanticMatch?.key) return { value: getProfileValue(profile, semanticMatch.key), source: semanticMatch.key };
    const path = matchProfilePath(field, memory) || fallbackPath;
    return path ? { value: getProfileValue(profile, path), source: path } : { value: "", source: "" };
  }

  function matchItemKey(field, patterns) {
    const section = field.section === "education" ? "education" : "experience";
    const semanticMatch = window.ApplyPilotSemanticMatcher?.matchArrayField(field, section);
    if (semanticMatch?.key) return semanticMatch.key;
    for (const [key, pattern] of patterns) {
      if (pattern.test(field.fieldTextNormalized)) return key;
    }
    return "";
  }

  async function inputText(element, value) {
    await clickElement(element);
    const text = String(value || "");
    const tag = element.tagName.toLowerCase();
    if (element.isContentEditable) {
      element.textContent = text;
      dispatchFullEvents(element, text);
      return true;
    }
    if (tag === "textarea" || tag === "input") {
      setNativeValue(element, text);
      dispatchFullEvents(element, text);
      return true;
    }
    setNativeValue(element, text);
    dispatchFullEvents(element, text);
    return true;
  }

  async function selectOption(element, value) {
    await clickElement(element);
    const normalized = normalizeText(value);

    if (element.tagName.toLowerCase() === "select") {
      const option = Array.from(element.options).find((item) => {
        const text = normalizeText(`${item.value} ${item.textContent}`);
        return text === normalized || text.includes(normalized) || normalized.includes(text);
      });
      if (!option) return false;
      element.selectedIndex = option.index;
      dispatchFullEvents(element, option.value);
      return true;
    }

    await sleep(WAIT_MS);
    const option = findOpenOption(value);
    if (option) {
      await clickElement(option);
      return true;
    }

    return inputText(element, value);
  }

  async function selectDate(element, value) {
    await clickElement(element);
    return inputText(element, normalizeDate(value));
  }

  async function clickElement(element) {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.focus?.();
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.click?.();
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(40);
    return true;
  }

  function findOpenOption(value) {
    const normalized = normalizeText(value);
    const options = Array.from(document.querySelectorAll([
      "[role='option']",
      ".ant-select-item-option",
      ".el-select-dropdown__item",
      ".select2-results__option",
      "[class*='option']",
      "li"
    ].join(","))).filter(isVisible);
    return options.find((option) => {
      const text = normalizeText(option.innerText || option.textContent || "");
      return text === normalized || text.includes(normalized) || normalized.includes(text);
    });
  }

  async function waitForRows(section, minRows, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const model = understandPage();
      if (model.sections[section].rows.length >= minRows) return true;
      await sleep(100);
    }
    return false;
  }

  function setNativeValue(element, value) {
    const prototype = element.tagName.toLowerCase() === "textarea"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function dispatchFullEvents(element, value) {
    element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: String(value || "") }));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value || "") }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  }

  function getProfileValue(profile, path) {
    if (!profile) return "";
    const derived = {
      skillsText: Array.isArray(profile.skills) ? profile.skills.join(", ") : "",
      languagesText: Array.isArray(profile.languages) ? profile.languages.join(", ") : "",
      certificationsText: Array.isArray(profile.certifications) ? profile.certifications.join(", ") : ""
    };
    if (Object.prototype.hasOwnProperty.call(derived, path)) return derived[path];
    return path.split(".").reduce((value, key) => (value ? value[key] : ""), profile) || "";
  }

  function getElementText(element) {
    const attrs = [
      getLabelText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.name,
      element.id,
      element.getAttribute("autocomplete"),
      element.closest("[data-question], .question, .field, .form-group, .ant-form-item, .el-form-item, label")?.textContent
    ];
    return attrs.filter(Boolean).join(" ");
  }

  function getSectionText(element) {
    const container = element.closest("fieldset, section, article, form, [class*='section'], [class*='card'], [class*='panel']");
    return container ? (container.querySelector("legend,h1,h2,h3,h4")?.textContent || container.textContent || "") : "";
  }

  function getLabelText(element) {
    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return label.textContent || "";
    }
    const wrappingLabel = element.closest("label");
    return wrappingLabel ? wrappingLabel.textContent || "" : "";
  }

  function getRowKey(element) {
    const row = element.closest("tr, li, fieldset, [data-row], [class*='row'], [class*='item'], [class*='entry']");
    return row ? ensureApplyPilotId(row, "row") : "";
  }

  function getControlType(element) {
    if (element.tagName.toLowerCase() === "select") return "native-select";
    if (element.getAttribute("role") === "combobox" || element.getAttribute("aria-haspopup") === "listbox") return "custom-select";
    return "text";
  }

  function getFieldKind(element, text) {
    const type = getFieldType(element);
    if (type === "date" || /date|\u65e5\u671f|\u65f6\u95f4|start|end/i.test(text)) return "date";
    return type || "text";
  }

  function getFieldType(element) {
    return String(element.getAttribute("type") || element.tagName || "").toLowerCase();
  }

  function getCurrentFieldValue(element) {
    if (element.isContentEditable) return element.textContent.trim();
    if (getFieldType(element) === "checkbox") return element.checked ? "true" : "";
    if (getFieldType(element) === "radio") return element.checked ? element.value : "";
    return String(element.value || element.textContent || "").trim();
  }

  function getFieldSignature(element) {
    return hashText(normalizeText([location.hostname, element.name, element.id, getElementText(element)].filter(Boolean).join("|")));
  }

  function getLabelMemoryKey(element) {
    return `label_${hashText(normalizeText(getElementText(element)).replace(/[^\p{L}\p{N}]+/gu, " "))}`;
  }

  function ensureApplyPilotId(element, prefix) {
    if (!element.getAttribute(AP_ID)) {
      element.setAttribute(AP_ID, `${prefix}-${Math.random().toString(36).slice(2, 10)}`);
    }
    return element.getAttribute(AP_ID);
  }

  function summarizeSections(model) {
    return {
      basicFields: model.sections.basic.length,
      educationRows: model.sections.education.rows.length,
      educationFields: model.sections.education.fields.length,
      internshipRows: model.sections.internship.rows.length,
      internshipFields: model.sections.internship.fields.length,
      longTextFields: model.sections.longText.length
    };
  }

  function summarizePlan(plan) {
    return plan.reduce((summary, action) => {
      summary[action.type] = (summary[action.type] || 0) + 1;
      return summary;
    }, {});
  }

  function hasAnyValue(item) {
    return item && Object.values(item).some((value) => String(value || "").trim());
  }

  function normalizeDate(value) {
    const text = String(value || "").trim();
    const match = text.match(/(19|20)\d{2}[-/.年]\d{1,2}([-/.月]\d{1,2})?/);
    return match ? match[0].replace(/[年月/.]/g, "-").replace(/日/g, "") : text;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function hashText(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return `f_${Math.abs(hash)}`;
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
