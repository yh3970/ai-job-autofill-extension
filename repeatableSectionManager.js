(function () {
  if (window.__APPLYPILOT_REPEATABLE_SECTION_MANAGER__) return;
  window.__APPLYPILOT_REPEATABLE_SECTION_MANAGER__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  const agent = window.ApplyPilotFormAgent;
  if (!scanner || !actionsApi || !agent) return;

  const originalRunAgent = agent.runAgent.bind(agent);
  const FIELD_SELECTOR = [
    "input", "textarea", "select", "[contenteditable='true']", "[role='textbox']",
    "[role='combobox']", "[role='checkbox']", "[role='radio']", "[aria-haspopup='listbox']"
  ].join(",");

  const CONFIG = {
    education: {
      profileKey: "education",
      sectionPattern: /教育经历|教育背景|学历经历|学习经历|education(?:\s+background)?/i,
      addPattern: /(?:增加更多|新增|添加|增加|add|new|create).{0,10}(?:教育经历|教育背景|学历经历|education)|(?:教育经历|教育背景|学历经历|education).{0,10}(?:增加更多|新增|添加|增加|add|new|create)/i,
      anchorPattern: /school|university|college|institution|学校|院校|大学/i
    },
    experience: {
      profileKey: "experience",
      sectionPattern: /工作经历|实习经历|工作经验|任职经历|职业经历|employment|work\s+experience|internship/i,
      addPattern: /(?:增加更多|新增|添加|增加|add|new|create).{0,12}(?:工作经历|实习经历|工作经验|employment|work\s+experience|internship)|(?:工作经历|实习经历|工作经验|employment|work\s+experience|internship).{0,12}(?:增加更多|新增|添加|增加|add|new|create)/i,
      anchorPattern: /company|employer|organization|enterprise|企业名称|公司名称|公司|单位|机构|雇主/i
    },
    projects: {
      profileKey: "projects",
      sectionPattern: /项目经历|项目经验|代表项目|project(?:\s+experience)?/i,
      addPattern: /(?:增加更多|新增|添加|增加|add|new|create).{0,10}(?:项目经历|项目经验|project)|(?:项目经历|项目经验|project).{0,10}(?:增加更多|新增|添加|增加|add|new|create)/i,
      anchorPattern: /project\s*name|项目名称|项目名/i
    }
  };

  const RESET_SECTION_PATTERN = /个人基本信息|个人信息|基本信息|求职意向|家庭关系|家庭成员|候选人附件|附件|语言能力|获奖经历|证书|论文|作品|personal(?:\s+information)?|basic(?:\s+information)?|job\s+preference|family|attachments?|languages?|awards?|certificates?/i;

  agent.runAgent = async function runWithRepeatableSectionManagement(profile, memory) {
    const expansion = await ensureRepeatableRows(profile || {});
    const base = await originalRunAgent(profile, memory);
    const projects = await fillProjectRows(profile?.projects || []);

    return {
      ...base,
      filled: Number(base.filled || 0) + projects.filled,
      actions: Number(base.actions || 0) + expansion.clicks + projects.actions,
      diagnostics: {
        ...(base.diagnostics || {}),
        repeatRowsAdded: expansion.added,
        educationRowsAdded: expansion.byType.education,
        experienceRowsAdded: expansion.byType.experience,
        projectRowsAdded: expansion.byType.projects,
        repeatAddFailed: expansion.failed,
        projectProfileFilled: projects.filled,
        projectProfileFailed: projects.failed,
        failed: Number(base.diagnostics?.failed || 0) + expansion.failed + projects.failed
      },
      uncertain: [
        ...(base.uncertain || []),
        ...expansion.failures,
        ...projects.failures
      ].slice(0, 100)
    };
  };

  async function ensureRepeatableRows(profile) {
    const result = {
      added: 0,
      clicks: 0,
      failed: 0,
      byType: { education: 0, experience: 0, projects: 0 },
      failures: []
    };

    for (const type of ["education", "experience", "projects"]) {
      const config = CONFIG[type];
      const desired = validItems(profile?.[config.profileKey]).length;
      if (desired <= 0) continue;

      let current = countRows(type);
      let guard = 0;
      while (current < desired && guard < Math.min(desired + 2, 12)) {
        guard += 1;
        const button = findAddButton(type);
        if (!button) {
          result.failed += 1;
          result.failures.push({
            reason: `repeat-add-button-not-found-${type}`,
            label: sectionName(type),
            expectedRows: desired,
            currentRows: current
          });
          break;
        }

        const previous = current;
        const clicked = await actionsApi.clickElement(button);
        result.clicks += 1;
        if (!clicked) {
          result.failed += 1;
          result.failures.push({ reason: `repeat-add-click-failed-${type}`, label: buttonText(button) || sectionName(type) });
          break;
        }

        const increased = await waitForRowIncrease(type, previous, 2800);
        current = countRows(type);
        if (!increased && current <= previous) {
          result.failed += 1;
          result.failures.push({
            reason: `repeat-row-not-created-${type}`,
            label: buttonText(button) || sectionName(type),
            expectedRows: desired,
            currentRows: current
          });
          break;
        }

        const delta = Math.max(1, current - previous);
        result.added += delta;
        result.byType[type] += delta;
        await scanner.sleep(160);
      }
    }
    return result;
  }

  function countRows(type) {
    const config = CONFIG[type];
    const model = scanner.understandPage();
    let modelRows = 0;
    let sectionFields = [];

    if (type === "education") {
      modelRows = model.sections.education?.rows?.length || 0;
      sectionFields = model.sections.education?.fields || [];
    } else if (type === "experience") {
      modelRows = model.sections.internship?.rows?.length || 0;
      sectionFields = model.sections.internship?.fields || [];
    } else {
      sectionFields = collectFieldsForSection(type);
    }

    const anchorCount = sectionFields.filter((field) => config.anchorPattern.test(field.fieldTextNormalized || field.text || "")).length;
    const numberedHeadings = countNumberedSectionHeadings(type);
    const startCount = sectionFields.filter((field) => /^(开始时间|起始时间|入学时间|任职开始|实习开始|项目开始|start(?:\s+date)?|from)$/i.test(primaryLabel(field))).length;

    return Math.max(modelRows, anchorCount, numberedHeadings, startCount, sectionFields.length ? 1 : 0);
  }

  function countNumberedSectionHeadings(type) {
    const config = CONFIG[type];
    const seen = new Set();
    scanner.deepQueryAll("h1,h2,h3,h4,h5,h6,legend,[role='heading'],.title,[class*='title'],div,span,p")
      .filter(isVisible)
      .forEach((element) => {
        const text = clean(getOwnText(element) || element.textContent || "");
        if (!config.sectionPattern.test(text)) return;
        const number = text.match(/[（(]?\s*(\d+)\s*[）)]?/)?.[1];
        if (number) seen.add(number);
      });
    return seen.size;
  }

  function findAddButton(type) {
    const config = CONFIG[type];
    const candidates = scanner.deepQueryAll([
      "button", "a", "[role='button']", "input[type='button']", "[onclick]",
      "[class*='add']", "[class*='Add']", "[class*='more']", "[class*='More']"
    ].join(",")).filter((element) => {
      if (!isVisible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
      if (element.querySelector?.(FIELD_SELECTOR)) return false;
      const text = buttonText(element);
      if (!text || text.length > 100 || /删除|移除|保存|提交|完成|关闭|delete|remove|save|submit|finish|close/i.test(text)) return false;
      return config.addPattern.test(text);
    });

    if (candidates.length) return candidates[0];

    return scanner.deepQueryAll("button,a,[role='button'],input[type='button'],[onclick]")
      .filter(isVisible)
      .find((element) => {
        const text = buttonText(element);
        if (!/^(?:\+\s*)?(?:添加|新增|增加|add|new|create)(?:\s*\+)?$/i.test(text)) return false;
        return config.sectionPattern.test(nearestSectionText(element));
      }) || null;
  }

  async function waitForRowIncrease(type, previous, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await scanner.sleep(140);
      if (countRows(type) > previous) return true;
    }
    return false;
  }

  async function fillProjectRows(projects) {
    const items = validItems(projects);
    if (!items.length) return { filled: 0, failed: 0, actions: 0, failures: [] };

    await scanner.waitForStableFields(1600);
    const rows = buildProjectRows(collectFieldsForSection("projects"));
    const planned = [];

    rows.slice(0, items.length).forEach((row, index) => {
      const item = items[index];
      row.fields.forEach((field) => {
        if (alreadyFilled(field.element)) return;
        const mapped = mapProjectField(field, item, row.fields);
        if (!mapped || !hasValue(mapped.value)) return;
        planned.push(toAction(field, mapped.value, `projects.${index}.${mapped.key}`));
      });
    });

    let filled = 0;
    let failed = 0;
    const failures = [];
    for (const action of dedupe(planned)) {
      const result = await actionsApi.execute(action, action.element);
      if (result === true || result?.ok) filled += 1;
      else {
        failed += 1;
        failures.push({
          reason: result?.reason || "project-action-failed",
          label: action.debug?.label || action.source,
          value: preview(action.value),
          method: result?.method || ""
        });
      }
      await scanner.sleep(90);
    }
    return { filled, failed, actions: planned.length, failures };
  }

  function collectFieldsForSection(type) {
    const config = CONFIG[type];
    const markers = collectSectionMarkers();
    return scanner.getInteractiveFields().map((element, index) => scanner.describeField(element, index))
      .filter((field) => inferSection(field.element, markers) === type)
      .filter((field) => !RESET_SECTION_PATTERN.test(field.sectionText || ""));
  }

  function collectSectionMarkers() {
    const markerPatterns = [
      ["education", CONFIG.education.sectionPattern],
      ["experience", CONFIG.experience.sectionPattern],
      ["projects", CONFIG.projects.sectionPattern],
      ["reset", RESET_SECTION_PATTERN]
    ];
    return scanner.deepQueryAll("h1,h2,h3,h4,h5,h6,legend,[role='heading'],.section-title,.card-title,.panel-title,.title,[class*='title'],div,span,p,a,td,th")
      .map((element) => {
        if (!isVisible(element) || element.querySelector?.(FIELD_SELECTOR)) return null;
        const text = clean(getOwnText(element));
        if (!text || text.length > 80) return null;
        const match = markerPatterns.find(([, pattern]) => pattern.test(text));
        return match ? { element, type: match[0], text } : null;
      }).filter(Boolean);
  }

  function inferSection(element, markers) {
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
    return winner?.type === "reset" ? "" : winner?.type || "";
  }

  function buildProjectRows(fields) {
    if (!fields.length) return [];
    const grouped = new Map();
    fields.forEach((field) => {
      if (!field.rowKey || !field.rowKey.startsWith("repeat-")) return;
      if (!grouped.has(field.rowKey)) grouped.set(field.rowKey, []);
      grouped.get(field.rowKey).push(field);
    });
    if (grouped.size) return Array.from(grouped.entries()).map(([id, rowFields]) => ({ id, fields: rowFields }));

    const startAnchors = fields.filter((field) => /^(开始时间|起始时间|项目开始|start(?:\s+date)?|from)$/i.test(primaryLabel(field)));
    const anchorPattern = startAnchors.length ? /^(开始时间|起始时间|项目开始|start(?:\s+date)?|from)$/i : CONFIG.projects.anchorPattern;
    const rows = [];
    let current = [];
    fields.forEach((field) => {
      const text = startAnchors.length ? primaryLabel(field) : field.fieldTextNormalized;
      if (anchorPattern.test(text) && current.length) {
        rows.push({ id: `project-${rows.length}`, fields: current });
        current = [];
      }
      current.push(field);
    });
    if (current.length) rows.push({ id: `project-${rows.length}`, fields: current });
    return rows;
  }

  function mapProjectField(field, item, group) {
    const text = `${field.fieldTextNormalized || field.text || ""} ${field.sectionText || ""}`;
    if (/project\s*name|项目名称|项目名/i.test(text)) return { key: "name", value: item.name };
    if (/project\s*role|role|position|担任角色|项目角色|角色|职位/i.test(text)) return { key: "role", value: item.role };
    if (/project\s*(?:description|details)|项目描述|项目内容|项目职责|项目成果|描述|内容|职责|成果/i.test(text)) return { key: "description", value: item.description };
    if (/project\s*(?:url|link)|项目链接|链接|网址|url/i.test(text)) return { key: "url", value: item.url };
    return mapDateField(field, item.start, item.end, group);
  }

  function mapDateField(field, startValue, endValue, group) {
    const text = `${field.fieldTextNormalized || field.text || ""} ${field.element.getAttribute("placeholder") || ""}`;
    const isDate = field.kind === "date" || /date|time|日期|时间|开始|结束|^年$|^月$/i.test(text);
    if (!isDate) return null;
    const start = splitDate(startValue);
    const end = splitDate(endValue);
    if (/开始|from|start|begin/i.test(text)) return { key: "start", value: formatDateForField(field, start) };
    if (/结束|to|end|finish/i.test(text)) return { key: "end", value: formatDateForField(field, end) };

    const dateFields = group.filter((candidate) => candidate.kind === "date" || /date|time|日期|时间|开始|结束|^年$|^月$/i.test(candidate.fieldTextNormalized || ""));
    const position = dateFields.indexOf(field);
    if (dateFields.length >= 4) {
      const values = [start.year, start.month, end.year, end.month];
      return { key: position < 2 ? "start" : "end", value: values[position] || "" };
    }
    return position === 0
      ? { key: "start", value: formatDateForField(field, start) }
      : { key: "end", value: formatDateForField(field, end) };
  }

  function formatDateForField(field, date) {
    const text = `${field.fieldTextNormalized || ""} ${field.element.getAttribute("placeholder") || ""}`;
    if (/月|month/i.test(text)) return date.month;
    if (/年|year/i.test(text)) return date.year;
    return date.year && date.month ? `${date.year}-${String(date.month).padStart(2, "0")}` : date.year;
  }

  function toAction(field, value, source) {
    let type = "inputText";
    if (field.control === "checkbox") type = "setChecked";
    else if (field.control === "radio") type = "selectRadio";
    else if (["native-select", "custom-select"].includes(field.control)) type = "selectOption";
    else if (field.kind === "date") type = "selectDate";
    return {
      type,
      fieldId: field.id,
      element: field.element,
      value,
      source,
      debug: { label: field.text, matchedProfilePath: source, source: "project-profile-manager" }
    };
  }

  function nearestSectionText(element) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const heading = current.querySelector?.("h1,h2,h3,h4,h5,h6,legend,[role='heading'],.section-title,.card-title,.panel-title,.title,[class*='title']");
      const text = clean(heading?.textContent || "");
      if (text) return text;
    }
    return "";
  }

  function buttonText(element) {
    return clean(element.innerText || element.value || element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "");
  }

  function primaryLabel(field) {
    return clean(String(field.text || "").split(/\s{2,}|\|/)[0]);
  }

  function getOwnText(element) {
    return Array.from(element.childNodes || [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ");
  }

  function alreadyFilled(element) {
    const value = scanner.normalizeText(scanner.getDisplayFieldValue(element));
    return Boolean(value) && !/^(请选择|--请选择--|请输入|年|月|please select|select|choose)$/.test(value);
  }

  function splitDate(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/((?:19|20)\d{2})\D{0,3}(1[0-2]|0?[1-9])?/);
    return { year: match?.[1] || "", month: match?.[2] ? String(Number(match[2])) : "" };
  }

  function validItems(value) {
    return Array.isArray(value) ? value.filter((item) => item && Object.values(item).some(hasValue)) : [];
  }

  function hasValue(value) {
    return value !== null && value !== undefined && (typeof value === "boolean" || String(value).trim() !== "");
  }

  function dedupe(actions) {
    const seen = new Set();
    return actions.filter((action) => {
      const key = `${action.fieldId}|${action.type}|${scanner.normalizeText(action.value)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

  function preview(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }

  function sectionName(type) {
    return type === "education" ? "教育经历" : type === "experience" ? "工作/实习经历" : "项目经历";
  }
})();
