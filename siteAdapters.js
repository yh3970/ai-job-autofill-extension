(function () {
  if (window.__APPLYPILOT_SITE_ADAPTERS__) return;
  window.__APPLYPILOT_SITE_ADAPTERS__ = true;

  const agent = window.ApplyPilotFormAgent;
  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  if (!agent || !scanner || !actionsApi) return;

  const originalRunAgent = agent.runAgent.bind(agent);

  agent.runAgent = async function runAgentWithSiteAdapter(profile, memory) {
    const baseResult = await originalRunAgent(profile, memory);
    if (!isDjiApplication()) return baseResult;

    const adapterResult = await runDjiAdapter(profile || {});
    return mergeResults(baseResult, adapterResult);
  };

  function isDjiApplication() {
    return location.hostname === "apply.careers.dji.com";
  }

  async function runDjiAdapter(profile) {
    await scanner.waitForStableFields(2600);

    await ensureRepeatRows({
      startNames: ["教育经历"],
      endNames: ["实习经历", "工作经历", "项目经验"],
      desiredCount: validItems(profile.education).length,
      anchorPattern: /学校名称|就读学校|学校|院校/i
    });

    await ensureRepeatRows({
      startNames: ["实习经历", "工作经历"],
      endNames: ["项目经验", "获奖经历", "语言能力"],
      desiredCount: validItems(profile.experience).length,
      anchorPattern: /公司名称|公司|单位|雇主/i
    });

    await scanner.waitForStableFields(1800);
    const model = scanner.understandPage();
    const planned = [];

    planKnownDjiDropdowns(planned, model.fields, profile);
    planRepeatedSection(planned, {
      fields: fieldsInNamedSection(model.fields, ["教育经历"], ["实习经历", "工作经历", "项目经验"]),
      items: validItems(profile.education),
      scalarMappings: [
        ["school", /学校名称|就读学校|学校|院校/i],
        ["degree", /学历|学位|degree/i],
        ["major", /专业名称|所学专业|专业/i]
      ],
      timePattern: /就读时间|入学时间|毕业时间|开始时间|结束时间|^年$|^月$/i,
      currentPattern: /至今|present|current/i,
      sectionName: "education"
    });

    planRepeatedSection(planned, {
      fields: fieldsInNamedSection(model.fields, ["实习经历", "工作经历"], ["项目经验", "获奖经历", "语言能力", "自我描述"]),
      items: validItems(profile.experience),
      scalarMappings: [
        ["company", /公司名称|公司|单位|雇主/i],
        ["title", /职位名称|职位|岗位|职务/i],
        ["description", /工作内容|工作职责|职责|实习内容|主要工作|描述/i]
      ],
      timePattern: /起止时间|任职时间|实习时间|开始时间|结束时间|^年$|^月$/i,
      currentPattern: /至今|present|current/i,
      sectionName: "experience"
    });

    const uniqueActions = dedupeActions(planned);
    const result = await executeActions(uniqueActions);
    return {
      ...result,
      planned: uniqueActions.length,
      adapter: "dji"
    };
  }

  async function ensureRepeatRows({ startNames, endNames, desiredCount, anchorPattern }) {
    if (!desiredCount || desiredCount < 2) return;

    for (let attempt = 0; attempt < desiredCount + 1; attempt += 1) {
      const model = scanner.understandPage();
      const sectionFields = fieldsInNamedSection(model.fields, startNames, endNames);
      const currentCount = sectionFields.filter((field) => anchorPattern.test(field.text)).length;
      if (currentCount >= desiredCount) return;

      const addButton = findSectionAddButton(startNames, endNames);
      if (!addButton) return;
      await actionsApi.clickElement(addButton);
      await scanner.sleep(450);
    }
  }

  function planKnownDjiDropdowns(actions, fields, profile) {
    const highestDegree = deriveHighestDegree(profile.education);
    addFirstMatching(actions, fields, /最高学历/i, highestDegree, "profile.education.highestDegree");
    addFirstMatching(actions, fields, /当前所在国家|所在国家|国籍/i, profile.personal?.nationality, "personal.nationality");
    addFirstMatching(actions, fields, /是否接受意向城市调剂|接受.*城市.*调剂|城市调剂/i, profile.relocation, "relocation");
    addFirstMatching(actions, fields, /工作许可|工作签证|签证状态/i, profile.workAuthorization, "workAuthorization");
    addFirstMatching(actions, fields, /签证担保|是否需要.*担保/i, profile.visaSponsorship, "visaSponsorship");
  }

  function addFirstMatching(actions, fields, pattern, value, source) {
    if (!hasValue(value)) return;
    const field = fields.find((candidate) => pattern.test(candidate.text));
    if (field) actions.push(toAction(field, value, source));
  }

  function planRepeatedSection(actions, config) {
    const { fields, items, scalarMappings, timePattern, currentPattern, sectionName } = config;
    if (!fields.length || !items.length) return;

    for (const [key, pattern] of scalarMappings) {
      const candidates = fields.filter((field) => pattern.test(field.text) && !isTimeField(field));
      candidates.slice(0, items.length).forEach((field, index) => {
        const value = items[index]?.[key];
        if (hasValue(value)) actions.push(toAction(field, value, `${sectionName}.${index}.${key}`));
      });
    }

    const dateFields = fields.filter((field) => {
      const ownText = normalize(field.text);
      return timePattern.test(ownText) || isYearMonthPlaceholder(field);
    });
    planDateControls(actions, dateFields, items, sectionName);

    const currentFields = fields.filter((field) => field.control === "checkbox" && currentPattern.test(field.text));
    currentFields.slice(0, items.length).forEach((field, index) => {
      const endValue = String(items[index]?.end || "");
      actions.push(toAction(field, /至今|present|current/i.test(endValue), `${sectionName}.${index}.end.current`));
    });
  }

  function planDateControls(actions, dateFields, items, sectionName) {
    if (!dateFields.length) return;
    const controlsPerItem = Math.max(1, Math.floor(dateFields.length / items.length));

    items.forEach((item, itemIndex) => {
      const chunk = dateFields.slice(itemIndex * controlsPerItem, (itemIndex + 1) * controlsPerItem);
      if (!chunk.length) return;

      const start = splitDate(item.start);
      const end = splitDate(item.end);
      const values = mapDateChunk(chunk, start, end);
      chunk.forEach((field, controlIndex) => {
        const value = values[controlIndex];
        if (hasValue(value)) actions.push(toAction(field, value, `${sectionName}.${itemIndex}.date.${controlIndex}`));
      });
    });
  }

  function mapDateChunk(chunk, start, end) {
    if (chunk.length >= 4) return [start.year, start.month, end.year, end.month, ...Array(chunk.length - 4).fill("")];
    if (chunk.length === 3) return [start.year || itemDate(start), start.month, itemDate(end)];
    if (chunk.length === 2) {
      const firstIsMonth = /月|month/i.test(chunk[0].text);
      const secondIsMonth = /月|month/i.test(chunk[1].text);
      if (firstIsMonth && secondIsMonth) return [start.month, end.month];
      return [itemDate(start), itemDate(end)];
    }
    return [itemDate(start) || itemDate(end)];
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
      value,
      source,
      element: field.element,
      debug: {
        label: field.text,
        matchedProfilePath: source,
        source: "dji-site-adapter"
      }
    };
  }

  async function executeActions(actions) {
    let filled = 0;
    let skippedExisting = 0;
    let failed = 0;
    const failures = [];

    for (const action of actions) {
      const element = action.element || scanner.findElementByApplyPilotId(action.fieldId);
      if (!element) {
        failed += 1;
        failures.push({ label: action.debug?.label || action.source, reason: "adapter-target-not-found", value: preview(action.value) });
        continue;
      }
      if (alreadyContainsValue(element, action.value)) {
        skippedExisting += 1;
        continue;
      }

      const result = await actionsApi.execute(action, element);
      if (result?.ok) filled += 1;
      else {
        failed += 1;
        failures.push({
          label: action.debug?.label || action.source,
          reason: result?.reason || "adapter-action-failed",
          method: result?.method || "",
          value: preview(action.value)
        });
      }
      await scanner.sleep(110);
    }

    return { filled, failed, skippedExisting, failures };
  }

  function fieldsInNamedSection(fields, startNames, endNames) {
    const start = findHeading(startNames);
    if (!start) {
      const target = startNames.some((name) => /教育/.test(name)) ? "education" : "internship";
      return fields.filter((field) => field.section === target);
    }
    const end = findFirstHeadingAfter(start, endNames);
    return fields.filter((field) => isAfter(field.element, start) && (!end || isBefore(field.element, end)));
  }

  function findSectionAddButton(startNames, endNames) {
    const start = findHeading(startNames);
    if (!start) return null;
    const end = findFirstHeadingAfter(start, endNames);
    return scanner.deepQueryAll("button, a, [role='button'], div, span")
      .filter(isVisible)
      .filter((element) => /^\+?\s*添加$|新增|add$/i.test(directText(element)))
      .find((element) => isAfter(element, start) && (!end || isBefore(element, end))) || null;
  }

  function findHeading(names) {
    const normalizedNames = names.map(normalize);
    return scanner.deepQueryAll("h1,h2,h3,h4,h5,h6,legend,[role='heading'],div,span,p")
      .filter(isVisible)
      .filter((element) => {
        const text = normalize(directText(element));
        return text.length > 0 && text.length <= 30 && normalizedNames.some((name) => text === name || text.startsWith(name));
      })[0] || null;
  }

  function findFirstHeadingAfter(start, names) {
    const candidates = names.map((name) => findHeading([name])).filter((element) => element && isAfter(element, start));
    return candidates.sort(compareDomOrder)[0] || null;
  }

  function compareDomOrder(a, b) {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function isAfter(node, reference) {
    if (!node || !reference) return false;
    return reference.contains(node) || Boolean(reference.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function isBefore(node, reference) {
    if (!node || !reference) return false;
    return Boolean(node.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function isTimeField(field) {
    return /时间|日期|^年$|^月$|start|end|from|to/i.test(field.text);
  }

  function isYearMonthPlaceholder(field) {
    const placeholder = normalize(field.element.getAttribute("placeholder"));
    return /^(年|月|year|month)$/.test(placeholder);
  }

  function alreadyContainsValue(element, value) {
    const expected = normalize(String(value ?? ""));
    if (!expected) return true;
    const directValue = normalize(scanner.getCurrentFieldValue(element));
    if (directValue && !/^(请选择|请输入|年|月|please select)$/.test(directValue)) {
      if (directValue === expected || directValue.includes(expected) || expected.includes(directValue)) return true;
    }
    const container = element.closest("[role='combobox'], [class*='select'], [class*='picker'], .form-item, .ant-form-item") || element.parentElement;
    const visibleText = normalize(container?.textContent || "");
    return visibleText && expected.length > 1 && (visibleText.includes(expected) || expected.includes(visibleText));
  }

  function deriveHighestDegree(education) {
    const degrees = validItems(education).map((item) => String(item.degree || "")).filter(Boolean);
    const ranks = [
      [/博士|phd|doctor/i, 5], [/硕士|master|msc|mba/i, 4],
      [/本科|学士|bachelor|bsc/i, 3], [/大专|专科|associate/i, 2], [/高中|high school/i, 1]
    ];
    return degrees.sort((a, b) => degreeRank(b, ranks) - degreeRank(a, ranks))[0] || "";
  }

  function degreeRank(value, ranks) {
    return ranks.find(([pattern]) => pattern.test(value))?.[1] || 0;
  }

  function splitDate(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/((?:19|20)\d{2})\D{0,3}(1[0-2]|0?[1-9])?/);
    return {
      year: match?.[1] || "",
      month: match?.[2] ? String(Number(match[2])) : "",
      present: /至今|present|current/i.test(text)
    };
  }

  function itemDate(parts) {
    if (!parts?.year) return "";
    return parts.month ? `${parts.year}-${String(parts.month).padStart(2, "0")}` : parts.year;
  }

  function dedupeActions(actions) {
    const seen = new Set();
    return actions.filter((action) => {
      const key = `${action.fieldId}|${action.type}|${String(action.value)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeResults(base, adapter) {
    const adapterFailures = adapter.failures || [];
    return {
      ...base,
      filled: Number(base.filled || 0) + Number(adapter.filled || 0),
      actions: Number(base.actions || 0) + Number(adapter.planned || 0),
      diagnostics: {
        ...(base.diagnostics || {}),
        djiAdapterFilled: adapter.filled || 0,
        djiAdapterFailed: adapter.failed || 0,
        djiAdapterSkippedExisting: adapter.skippedExisting || 0,
        failed: Number(base.diagnostics?.failed || 0) + Number(adapter.failed || 0)
      },
      uncertain: [...(base.uncertain || []), ...adapterFailures].slice(0, 50),
      adapterFailures
    };
  }

  function directText(element) {
    return Array.from(element.childNodes || [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() || String(element.getAttribute?.("aria-label") || element.title || "").trim();
  }

  function validItems(value) {
    return Array.isArray(value) ? value.filter((item) => item && Object.values(item).some(hasValue)) : [];
  }

  function hasValue(value) {
    return value !== null && value !== undefined && (typeof value === "boolean" || String(value).trim() !== "");
  }

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function preview(value) {
    const text = String(value ?? "").replace(/\s+/g, " ");
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }
})();
