(function () {
  if (window.__APPLYPILOT_LEGACY_SECTION_ADAPTER__) return;
  window.__APPLYPILOT_LEGACY_SECTION_ADAPTER__ = true;

  const scanner = window.ApplyPilotFormScanner;
  if (!scanner) return;

  const originalGetInteractiveFields = scanner.getInteractiveFields.bind(scanner);
  const originalUnderstandPage = scanner.understandPage.bind(scanner);

  const EDUCATION_MARKER = /^(?:\*\s*)?(?:教育经历|教育背景|学历经历|学习经历|education(?:\s+background)?)(?:\s*[（(]?\d+[）)]?)?$/i;
  const EXPERIENCE_MARKER = /^(?:\*\s*)?(?:工作经历(?:\s*[/／]\s*实习经历)?|实习经历|工作经验|任职经历|职业经历|employment(?:\s+history)?|work\s+experience|internship)(?:\s*[（(]?\d+[）)]?)?$/i;
  const START_PATTERN = /^(?:开始时间|起始时间|入学时间|任职开始|实习开始|start(?:\s+date)?|from)$/i;
  const EDUCATION_ANCHOR = /school|university|college|institution|学校|院校|大学/i;
  const EXPERIENCE_ANCHOR = /company|employer|organization|企业名称|公司|单位|雇主|机构/i;
  const FIELD_SELECTOR = scanner.FIELD_SELECTOR || [
    "input", "textarea", "select", "[contenteditable='true']", "[role='textbox']",
    "[role='combobox']", "[role='checkbox']", "[role='radio']", "[aria-haspopup='listbox']"
  ].join(",");

  scanner.getInteractiveFields = function getInteractiveFieldsWithReadonlyPickers() {
    const original = originalGetInteractiveFields();
    const extra = scanner.deepQueryAll("input[readonly], textarea[readonly]")
      .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true")
      .filter(isVisible)
      .filter(looksLikeInteractiveReadonly);
    return Array.from(new Set([...original, ...extra]));
  };

  scanner.understandPage = function understandLegacyAndModernPage() {
    const base = originalUnderstandPage();
    const markers = collectSectionMarkers();
    const fields = scanner.getInteractiveFields().map((element, index) => {
      const field = scanner.describeField(element, index);
      const inferred = inferSection(element, markers);
      if (inferred) {
        field.section = inferred;
        field.sectionText = inferred === "education" ? "education" : "work experience";
        field.normalizedText = scanner.normalizeText(`${field.text} ${field.sectionText}`);
      }
      return field;
    });

    const educationFields = fields.filter((field) => field.section === "education");
    const experienceFields = fields.filter((field) => field.section === "internship");
    return {
      fields,
      sections: {
        basic: fields.filter((field) => field.section === "basic"),
        education: { fields: educationFields, rows: buildRows(educationFields, "education") },
        internship: { fields: experienceFields, rows: buildRows(experienceFields, "internship") },
        longText: fields.filter((field) => field.section === "longText")
      },
      addButtons: base.addButtons || []
    };
  };

  function collectSectionMarkers() {
    const selector = [
      "h1", "h2", "h3", "h4", "h5", "h6", "legend", "[role='heading']",
      ".section-title", ".card-title", ".panel-title", ".title", "[class*='title']",
      "div", "span", "p", "a", "td", "th"
    ].join(",");

    return scanner.deepQueryAll(selector).map((element) => {
      const text = clean(getOwnText(element));
      const section = EDUCATION_MARKER.test(text)
        ? "education"
        : EXPERIENCE_MARKER.test(text)
          ? "internship"
          : "";
      return section && isVisible(element) && !element.querySelector(FIELD_SELECTOR)
        ? { element, section, text }
        : null;
    }).filter(Boolean);
  }

  function inferSection(element, markers) {
    const repeatHeading = findRepeatHeading(element);
    if (repeatHeading) return repeatHeading;

    let winner = null;
    for (const marker of markers) {
      if (marker.element.getRootNode() !== element.getRootNode()) continue;
      if (marker.element === element || marker.element.contains(element)) {
        winner = marker;
        continue;
      }
      const relation = marker.element.compareDocumentPosition(element);
      if (relation & Node.DOCUMENT_POSITION_FOLLOWING) winner = marker;
    }
    return winner?.section || "";
  }

  function findRepeatHeading(element) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
      const directText = Array.from(current.children || [])
        .filter((child) => !child.querySelector?.(FIELD_SELECTOR))
        .map((child) => clean(getOwnText(child)))
        .filter(Boolean)
        .join(" ");
      if (EDUCATION_MARKER.test(directText)) return "education";
      if (EXPERIENCE_MARKER.test(directText)) return "internship";
    }
    return "";
  }

  function buildRows(fields, section) {
    if (!fields.length) return [];

    const repeatGroups = new Map();
    fields.forEach((field) => {
      if (!field.rowKey || !field.rowKey.startsWith("repeat-")) return;
      if (!repeatGroups.has(field.rowKey)) repeatGroups.set(field.rowKey, []);
      repeatGroups.get(field.rowKey).push(field);
    });
    if (repeatGroups.size) {
      return Array.from(repeatGroups.entries()).map(([id, rowFields]) => ({ id, fields: rowFields }));
    }

    const startFields = fields.filter((field) => START_PATTERN.test(primaryLabel(field)));
    if (startFields.length) return splitAtAnchors(fields, (field) => START_PATTERN.test(primaryLabel(field)), section);

    const fallback = section === "education" ? EDUCATION_ANCHOR : EXPERIENCE_ANCHOR;
    return splitAtAnchors(fields, (field) => fallback.test(field.fieldTextNormalized || field.text || ""), section);
  }

  function splitAtAnchors(fields, isAnchor, section) {
    const rows = [];
    let current = [];
    for (const field of fields) {
      if (isAnchor(field) && current.length) {
        rows.push({ id: `legacy-${section}-${rows.length}`, fields: current });
        current = [];
      }
      current.push(field);
    }
    if (current.length) rows.push({ id: `legacy-${section}-${rows.length}`, fields: current });
    return rows;
  }

  function primaryLabel(field) {
    return clean(String(field.text || "").split(/\s{2,}|\|/)[0]);
  }

  function looksLikeInteractiveReadonly(element) {
    const type = String(element.getAttribute("type") || "").toLowerCase();
    const text = scanner.normalizeText([
      scanner.getElementText(element), element.getAttribute("placeholder"), element.className,
      element.parentElement?.className
    ].filter(Boolean).join(" "));
    return ["date", "month", "datetime-local"].includes(type)
      || Boolean(element.getAttribute("aria-haspopup"))
      || /date|time|日期|时间|开始|结束|出生|picker|calendar|select|cascader/.test(text);
  }

  function getOwnText(element) {
    return Array.from(element.childNodes || [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ");
  }

  function clean(value) {
    return String(value || "").replace(/[＊*：:]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }
})();
