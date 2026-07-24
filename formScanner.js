(function () {
  if (window.ApplyPilotFormScanner) return;

  const AP_ID = "data-applypilot-id";
  const FIELD_SELECTOR = [
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='combobox']",
    "[role='checkbox']",
    "[role='radio']",
    "[aria-haspopup='listbox']"
  ].join(",");

  const SECTION_PATTERNS = {
    education: [/education|academic|school|university|college/i, /教育|学历|学校|院校|大学/],
    internship: [/internship|intern|experience|employment|work history|career/i, /实习|工作经历|工作|职业|经历/],
    longText: [/cover letter|summary|statement|motivation|why|introduction|description/i, /求职信|自我介绍|个人简介|动机|为什么|描述/]
  };

  function understandPage() {
    const fields = getInteractiveFields().map((element, index) => describeField(element, index));
    const sections = {
      basic: fields.filter((field) => field.section === "basic"),
      education: buildArraySection(fields, "education"),
      internship: buildArraySection(fields, "internship"),
      longText: fields.filter((field) => field.section === "longText")
    };
    return { fields, sections, addButtons: findAddButtons() };
  }

  function getInteractiveFields() {
    return deepQueryAll(FIELD_SELECTOR).filter((element) => {
      const type = getFieldType(element);
      const role = element.getAttribute("role");
      if (element.disabled || element.readOnly || element.getAttribute("aria-disabled") === "true") return false;
      if (["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type)) return false;
      if (["combobox", "textbox"].includes(role) && element.querySelector("input, textarea, select")) return false;
      return isVisible(element) || isVisible(getClickableProxy(element));
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
      normalizedText: normalizeText(`${text} ${sectionText}`),
      sectionText: normalizeText(sectionText),
      section: classifySection(`${text} ${sectionText}`),
      control: getControlType(element),
      kind: getFieldKind(element, text),
      options: getFieldOptions(element),
      rowKey: getRowKey(element),
      rootType: element.getRootNode() instanceof ShadowRoot ? "shadow" : "dom",
      element
    };
  }

  function buildArraySection(fields, sectionType) {
    const grouped = new Map();
    fields.filter((field) => field.section === sectionType).forEach((field) => {
      const key = field.rowKey || field.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(field);
    });
    const rows = Array.from(grouped.entries()).map(([id, rowFields]) => ({ id, fields: rowFields }));
    return { fields: fields.filter((field) => field.section === sectionType), rows };
  }

  function findAddButtons() {
    return deepQueryAll("button, a, [role='button'], input[type='button']")
      .filter(isVisible)
      .map((element, index) => {
        const text = normalizeText(element.innerText || element.value || element.getAttribute("aria-label") || element.title || "");
        return { id: ensureApplyPilotId(element, `button-${index}`), element, text, type: classifyAddButton(text) };
      })
      .filter((item) => /add|new|create|\+|添加|新增|增加/.test(item.text));
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

  async function waitForStableFields(timeout = 3000) {
    const start = Date.now();
    let previousSignature = "";
    let stableRounds = 0;
    while (Date.now() - start < timeout) {
      const fields = getInteractiveFields();
      const signature = fields.map((field) => [field.tagName, field.name, field.id, field.getAttribute("role")].join(":" )).join("|");
      if (signature === previousSignature) stableRounds += 1;
      else {
        previousSignature = signature;
        stableRounds = 0;
      }
      const elapsed = Date.now() - start;
      if (fields.length > 0 && stableRounds >= 3) return fields.length;
      if (fields.length === 0 && elapsed >= 1800 && stableRounds >= 4) return 0;
      await sleep(200);
    }
    return getInteractiveFields().length;
  }

  async function waitForRows(section, minRows, timeout = 1400) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (understandPage().sections[section].rows.length >= minRows) return true;
      await sleep(100);
    }
    return false;
  }

  function deepQueryAll(selector, root = document) {
    const results = [];
    const roots = [root];
    const visited = new Set();
    while (roots.length) {
      const currentRoot = roots.shift();
      if (!currentRoot || visited.has(currentRoot)) continue;
      visited.add(currentRoot);
      try {
        results.push(...Array.from(currentRoot.querySelectorAll(selector)));
        currentRoot.querySelectorAll("*").forEach((element) => {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        });
      } catch (error) {
        console.debug("ApplyPilot skipped inaccessible root", error);
      }
    }
    return Array.from(new Set(results));
  }

  function findElementByApplyPilotId(id) {
    if (!id) return null;
    return deepQueryAll(`[${AP_ID}="${cssEscape(id)}"]`)[0] || null;
  }

  function getElementText(element) {
    return uniqueText([
      getLabelText(element),
      getAriaLabelledByText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.getAttribute("autocomplete"),
      element.getAttribute("title"),
      getLocalQuestionText(element)
    ]).join(" ").slice(0, 500);
  }

  function getLocalQuestionText(element) {
    const container = element.closest("[data-question], .question, .field, .form-group, .ant-form-item, .el-form-item");
    if (!container) return "";
    const label = container.querySelector("label, .ant-form-item-label, .el-form-item__label, .form-label, [class*='label']");
    return label ? label.textContent || "" : "";
  }

  function getSectionText(element) {
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 7) {
      if (current.matches("fieldset, section, article, form, [class*='section'], [class*='card'], [class*='panel']")) {
        const heading = findContainerHeading(current);
        if (heading) return heading;
      }
      current = current.parentElement;
      depth += 1;
    }
    return "";
  }

  function findContainerHeading(container) {
    for (const child of Array.from(container.children || [])) {
      if (child.matches?.("legend,h1,h2,h3,h4,[role='heading'],.section-title,.card-title")) return child.textContent || "";
      const nested = child.querySelector?.(":scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > [role='heading']");
      if (nested) return nested.textContent || "";
    }
    return "";
  }

  function getLabelText(element) {
    const root = element.getRootNode();
    if (element.id) {
      const selector = `label[for="${cssEscape(element.id)}"]`;
      const label = root.querySelector?.(selector) || document.querySelector(selector);
      if (label) return label.textContent || "";
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return wrappingLabel.textContent || "";
    return element.parentElement?.querySelector?.(":scope > label")?.textContent || "";
  }

  function getAriaLabelledByText(element) {
    const ids = String(element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const root = element.getRootNode();
    return ids.map((id) => root.getElementById?.(id)?.textContent || document.getElementById(id)?.textContent || "").filter(Boolean).join(" ");
  }

  function getRowKey(element) {
    const row = element.closest([
      "tr", "fieldset", "[data-row]", "[data-index]",
      "[data-testid*='education']", "[data-testid*='experience']",
      "[class*='education'][class*='item']", "[class*='experience'][class*='item']",
      "[class*='employment'][class*='item']", "[class*='entry']", "[class*='repeat']"
    ].join(","));
    return row ? ensureApplyPilotId(row, "row") : "";
  }

  function getControlType(element) {
    const type = getFieldType(element);
    const role = element.getAttribute("role");
    if (type === "checkbox" || role === "checkbox") return "checkbox";
    if (type === "radio" || role === "radio") return "radio";
    if (element.tagName.toLowerCase() === "select") return "native-select";
    if (role === "combobox" || element.getAttribute("aria-haspopup") === "listbox") return "custom-select";
    if (element.isContentEditable) return "contenteditable";
    return "text";
  }

  function getFieldKind(element, text) {
    const type = getFieldType(element);
    if (["date", "month", "datetime-local"].includes(type) || /date|日期|时间|start|end/i.test(text)) return "date";
    return type || "text";
  }

  function getFieldType(element) {
    return String(element.getAttribute("type") || element.tagName || "").toLowerCase();
  }

  function getFieldOptions(element) {
    if (element.tagName.toLowerCase() === "select") {
      return Array.from(element.options).map((option) => normalizeText(option.textContent || option.value)).filter(Boolean).slice(0, 50);
    }
    if (getControlType(element) === "radio") {
      return getRadioGroup(element).map((item) => normalizeText(`${item.value || ""} ${getLabelText(item)}`)).filter(Boolean).slice(0, 30);
    }
    return [];
  }

  function getRadioGroup(element) {
    const name = element.getAttribute("name");
    if (name) return deepQueryAll(`input[type='radio'][name="${cssEscape(name)}"], [role='radio'][name="${cssEscape(name)}"]`);
    const container = element.closest("fieldset, [role='radiogroup'], .radio-group, [class*='radio-group']");
    return container ? Array.from(container.querySelectorAll("input[type='radio'], [role='radio']")) : [element];
  }

  function getClickableProxy(element) {
    if (!element) return null;
    if (element.id) {
      const root = element.getRootNode();
      const label = root.querySelector?.(`label[for="${cssEscape(element.id)}"]`) || document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return label;
    }
    return element.closest("label") || element;
  }

  function getCurrentFieldValue(element) {
    if (element.isContentEditable) return String(element.textContent || "").trim();
    if (["checkbox", "radio"].includes(getControlType(element))) return getCheckedState(element) ? String(element.value || "true") : "";
    return String(element.value || element.textContent || "").trim();
  }

  function getCheckedState(element) {
    if ("checked" in element) return Boolean(element.checked);
    return element.getAttribute("aria-checked") === "true";
  }

  function getFieldSignature(element) {
    return hashText(normalizeText([location.hostname, element.name, element.id, getElementText(element)].filter(Boolean).join("|")));
  }

  function getLabelMemoryKey(element) {
    return `label_${hashText(normalizeText(getElementText(element)).replace(/[^\p{L}\p{N}]+/gu, " "))}`;
  }

  function ensureApplyPilotId(element, prefix) {
    if (!element.getAttribute(AP_ID)) element.setAttribute(AP_ID, `${prefix}-${Math.random().toString(36).slice(2, 10)}`);
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

  function summarizeDiagnostics(model) {
    const shadowFields = model.fields.filter((field) => field.rootType === "shadow").length;
    return { domFields: model.fields.length - shadowFields, shadowFields, isTopFrame: window.top === window, frameUrl: location.href };
  }

  function uniqueText(values) {
    const seen = new Set();
    return values.map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
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
    if (window.CSS && CSS.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.ApplyPilotFormScanner = {
    AP_ID,
    understandPage,
    getInteractiveFields,
    describeField,
    waitForStableFields,
    waitForRows,
    deepQueryAll,
    findElementByApplyPilotId,
    getElementText,
    getLabelText,
    getControlType,
    getCurrentFieldValue,
    getCheckedState,
    getClickableProxy,
    getRadioGroup,
    getFieldSignature,
    getLabelMemoryKey,
    summarizeSections,
    summarizeDiagnostics,
    normalizeText,
    cssEscape,
    sleep
  };
})();
