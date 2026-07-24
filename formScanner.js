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
    internship: [/internship|intern|experience|employment|work history|career/i, /实习|工作经历|工作经验|任职经历|职业经历/],
    longText: [/cover letter|summary|statement|motivation|why|introduction|description/i, /求职信|自我介绍|个人简介|动机|为什么|描述/]
  };

  const HEADING_SELECTOR = "legend,h1,h2,h3,h4,h5,h6,[role='heading'],.section-title,.card-title,.panel-title,.title,[class*='title']";

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
    const sectionFields = fields.filter((field) => field.section === sectionType);
    if (!sectionFields.length) return { fields: [], rows: [] };

    const repeatGroups = new Map();
    sectionFields.forEach((field) => {
      if (!field.rowKey || !field.rowKey.startsWith("repeat-")) return;
      if (!repeatGroups.has(field.rowKey)) repeatGroups.set(field.rowKey, []);
      repeatGroups.get(field.rowKey).push(field);
    });

    if (repeatGroups.size) {
      return {
        fields: sectionFields,
        rows: Array.from(repeatGroups.entries()).map(([id, rowFields]) => ({ id, fields: rowFields }))
      };
    }

    return { fields: sectionFields, rows: inferSequentialRows(sectionFields, sectionType) };
  }

  function inferSequentialRows(fields, sectionType) {
    const anchor = sectionType === "education"
      ? /school|university|college|institution|学校|院校|大学/i
      : /company|employer|organization|单位|公司|雇主|机构/i;
    const rows = [];
    let current = [];

    fields.forEach((field) => {
      if (anchor.test(field.fieldTextNormalized) && current.length) {
        rows.push({ id: `sequence-${sectionType}-${rows.length}`, fields: current });
        current = [];
      }
      current.push(field);
    });
    if (current.length) rows.push({ id: `sequence-${sectionType}-${rows.length}`, fields: current });
    return rows;
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
      getAriaDescribedByText(element),
      getTableLabelText(element),
      getDefinitionLabelText(element),
      getAdjacentLabelText(element),
      getLocalQuestionText(element),
      element.getAttribute("data-label"),
      element.getAttribute("data-title"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      humanizeIdentifier(element.getAttribute("name")),
      humanizeIdentifier(element.id),
      element.getAttribute("autocomplete"),
      element.getAttribute("title")
    ]).join(" ").slice(0, 700);
  }

  function getLocalQuestionText(element) {
    const container = element.closest([
      "[data-question]", ".question", ".field", ".form-group", ".form-item", ".control-group",
      ".ant-form-item", ".el-form-item", ".layui-form-item", ".ui-form-item", ".resume-form-item",
      "[class*='formItem']", "[class*='form-item']", "[class*='field-item']"
    ].join(","));
    if (!container) return "";
    const label = container.querySelector([
      "label", ".ant-form-item-label", ".el-form-item__label", ".layui-form-label", ".control-label",
      ".form-label", "[class*='label']", "[class*='Label']"
    ].join(","));
    return cleanLabelText(label?.textContent || "");
  }

  function getTableLabelText(element) {
    const cell = element.closest("td, th");
    if (!cell) return "";
    const texts = [];
    let sibling = cell.previousElementSibling;
    let inspected = 0;
    while (sibling && inspected < 2) {
      if (!sibling.querySelector(FIELD_SELECTOR)) {
        const text = cleanLabelText(sibling.textContent || "");
        if (text && text.length <= 80) texts.unshift(text);
      }
      sibling = sibling.previousElementSibling;
      inspected += 1;
    }
    if (texts.length) return texts.join(" ");

    const row = cell.closest("tr");
    if (!row) return "";
    const cells = Array.from(row.children || []);
    const index = cells.indexOf(cell);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = cells[cursor];
      if (candidate.querySelector(FIELD_SELECTOR)) continue;
      const text = cleanLabelText(candidate.textContent || "");
      if (text && text.length <= 80) return text;
    }
    return "";
  }

  function getDefinitionLabelText(element) {
    const dd = element.closest("dd");
    if (dd?.previousElementSibling?.matches("dt")) return cleanLabelText(dd.previousElementSibling.textContent || "");
    return "";
  }

  function getAdjacentLabelText(element) {
    const candidates = [];
    const parent = element.parentElement;
    if (element.previousElementSibling) candidates.push(element.previousElementSibling);
    if (parent?.previousElementSibling) candidates.push(parent.previousElementSibling);
    if (parent) {
      Array.from(parent.children || []).forEach((child) => {
        if (child === element || child.contains(element)) return;
        if (child.matches?.("label,.label,.field-name,.item-name,[class*='label'],[class*='name']")) candidates.push(child);
      });
    }
    return candidates.map((candidate) => cleanLabelText(candidate.textContent || ""))
      .find((text) => text && text.length <= 80 && !/请选择|请输入|select|choose/i.test(text)) || "";
  }

  function getSectionText(element) {
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 8) {
      if (current.matches("fieldset, section, article, form, [class*='section'], [class*='card'], [class*='panel'], [class*='resume']")) {
        const heading = findContainerHeading(current);
        if (heading) return heading;
      }
      current = current.parentElement;
      depth += 1;
    }
    return findPreviousHeading(element);
  }

  function findContainerHeading(container) {
    for (const child of Array.from(container.children || [])) {
      if (child.matches?.(HEADING_SELECTOR)) {
        const text = cleanLabelText(child.textContent || "");
        if (text && text.length <= 100) return text;
      }
      const nested = child.querySelector?.(`:scope > ${HEADING_SELECTOR}`);
      if (nested) {
        const text = cleanLabelText(nested.textContent || "");
        if (text && text.length <= 100) return text;
      }
    }
    return "";
  }

  function findPreviousHeading(element) {
    let node = element;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      let previous = node.previousElementSibling;
      let inspected = 0;
      while (previous && inspected < 8) {
        const heading = previous.matches?.(HEADING_SELECTOR) ? previous : previous.querySelector?.(HEADING_SELECTOR);
        if (heading) {
          const text = cleanLabelText(heading.textContent || "");
          if (text && text.length <= 100) return text;
        }
        const direct = cleanLabelText(previous.textContent || "");
        if (direct && direct.length <= 40 && /信息|经历|意向|关系|附件|education|experience|profile/i.test(direct)) return direct;
        previous = previous.previousElementSibling;
        inspected += 1;
      }
    }
    return "";
  }

  function getLabelText(element) {
    const root = element.getRootNode();
    if (element.id) {
      const selector = `label[for="${cssEscape(element.id)}"]`;
      const label = root.querySelector?.(selector) || document.querySelector(selector);
      if (label) return cleanLabelText(label.textContent || "");
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return cleanLabelText(wrappingLabel.textContent || "");
    return cleanLabelText(element.parentElement?.querySelector?.(":scope > label")?.textContent || "");
  }

  function getAriaLabelledByText(element) {
    return getReferencedText(element, "aria-labelledby");
  }

  function getAriaDescribedByText(element) {
    return getReferencedText(element, "aria-describedby");
  }

  function getReferencedText(element, attribute) {
    const ids = String(element.getAttribute(attribute) || "").split(/\s+/).filter(Boolean);
    const root = element.getRootNode();
    return ids.map((id) => root.getElementById?.(id)?.textContent || document.getElementById(id)?.textContent || "")
      .map(cleanLabelText).filter(Boolean).join(" ");
  }

  function getRowKey(element) {
    const repeat = findRepeatContainer(element);
    if (repeat) return `repeat-${ensureApplyPilotId(repeat, "row")}`;
    const row = element.closest("tr, [data-row]");
    return row ? `table-${ensureApplyPilotId(row, "row")}` : "";
  }

  function findRepeatContainer(element) {
    const selector = [
      "[data-repeat-index]", "[data-index]", "[data-row-index]",
      "[data-testid*='education']", "[data-testid*='experience']",
      "[class*='education'][class*='item']", "[class*='experience'][class*='item']",
      "[class*='employment'][class*='item']", "[class*='work'][class*='item']",
      "[class*='resume'][class*='item']", "[class*='entry']", "[class*='repeat']"
    ].join(",");
    const direct = element.closest(selector);
    if (direct) return direct;

    let current = element.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const heading = current.querySelector?.(HEADING_SELECTOR);
      const text = cleanLabelText(heading?.textContent || "");
      if (/教育经历\s*[（(]?\d+|工作经历\s*[（(]?\d+|实习经历\s*[（(]?\d+|education\s*\d+|experience\s*\d+/i.test(text)) return current;
    }
    return null;
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
    if (["date", "month", "datetime-local"].includes(type) || /date|日期|时间|出生|start|end/i.test(text)) return "date";
    return type || "text";
  }

  function getFieldType(element) {
    return String(element.getAttribute("type") || element.tagName || "").toLowerCase();
  }

  function getFieldOptions(element) {
    if (element.tagName.toLowerCase() === "select") {
      return Array.from(element.options).map((option) => normalizeText(option.textContent || option.value)).filter(Boolean).slice(0, 80);
    }
    if (getControlType(element) === "radio") {
      return getRadioGroup(element).map((item) => normalizeText(`${item.value || ""} ${getLabelText(item)}`)).filter(Boolean).slice(0, 40);
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
    if (element.tagName.toLowerCase() === "select") {
      return String(element.selectedOptions?.[0]?.textContent || element.value || "").trim();
    }
    return String(element.value || element.textContent || "").trim();
  }

  function getDisplayFieldValue(element) {
    const direct = getCurrentFieldValue(element);
    if (direct && !isPlaceholderValue(direct)) return direct;
    const container = element.closest("[role='combobox'], [class*='select'], [class*='picker'], .form-item, .ant-form-item, .el-form-item") || element.parentElement;
    if (!container) return direct;
    const selected = container.querySelector("[class*='selected'], [class*='selection-item'], [class*='selector'], [title]");
    const text = cleanLabelText(selected?.getAttribute?.("title") || selected?.textContent || "");
    return isPlaceholderValue(text) ? "" : text;
  }

  function isPlaceholderValue(value) {
    return /^(请选择|--请选择--|请输入|年|月|please select|select|choose)$/i.test(normalizeText(value));
  }

  function getCheckedState(element) {
    if ("checked" in element) return Boolean(element.checked);
    return element.getAttribute("aria-checked") === "true";
  }

  function getFieldSignature(element) {
    return hashText(normalizeText([location.hostname, element.name, element.id, getElementText(element)].filter(Boolean).join("|")));
  }

  function getLabelMemoryKey(element) {
    return `label_${hashText(canonicalizeLabel(getElementText(element)))}`;
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
    const labelledFields = model.fields.filter((field) => canonicalizeLabel(field.text).length >= 2).length;
    return {
      domFields: model.fields.length - shadowFields,
      shadowFields,
      labelledFields,
      unlabelledFields: model.fields.length - labelledFields,
      isTopFrame: window.top === window,
      frameUrl: location.href
    };
  }

  function uniqueText(values) {
    const seen = new Set();
    return values.map((value) => cleanLabelText(value)).filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function cleanLabelText(value) {
    return String(value || "")
      .replace(/[＊*]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[:：\-—\s]+|[:：\-—\s]+$/g, "")
      .trim();
  }

  function humanizeIdentifier(value) {
    const text = String(value || "").trim();
    if (!text || /^\d+$/.test(text) || text.length > 90) return "";
    return text
      .replace(/[_.\-\[\]]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\d+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalizeLabel(value) {
    return normalizeText(value)
      .replace(/请输入|请选择|please|enter|select|choose|必填|required/g, " ")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
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
    FIELD_SELECTOR,
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
    getDisplayFieldValue,
    getCheckedState,
    getClickableProxy,
    getRadioGroup,
    getFieldSignature,
    getLabelMemoryKey,
    ensureApplyPilotId,
    summarizeSections,
    summarizeDiagnostics,
    canonicalizeLabel,
    hashText,
    isVisible,
    normalizeText,
    cssEscape,
    sleep
  };
})();
