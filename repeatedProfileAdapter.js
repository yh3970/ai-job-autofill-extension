(function () {
  if (window.__APPLYPILOT_REPEATED_PROFILE_ADAPTER__) return;
  window.__APPLYPILOT_REPEATED_PROFILE_ADAPTER__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  const agent = window.ApplyPilotFormAgent;
  if (!scanner || !actionsApi || !agent) return;

  const originalRunAgent = agent.runAgent.bind(agent);

  agent.runAgent = async function runWithRepeatedProfileFallback(profile, memory) {
    const base = await originalRunAgent(profile, memory);
    const fallback = await runRepeatedFallback(profile || {});
    return {
      ...base,
      filled: Number(base.filled || 0) + fallback.filled,
      actions: Number(base.actions || 0) + fallback.planned,
      diagnostics: {
        ...(base.diagnostics || {}),
        repeatedFallbackFilled: fallback.filled,
        repeatedFallbackFailed: fallback.failed,
        failed: Number(base.diagnostics?.failed || 0) + fallback.failed
      },
      uncertain: [...(base.uncertain || []), ...fallback.failures].slice(0, 80),
      repeatedFallbackFailures: fallback.failures
    };
  };

  async function runRepeatedFallback(profile) {
    await scanner.waitForStableFields(1600);
    const model = scanner.understandPage();
    const actions = [];

    planSection(actions, model.sections.education.rows, validItems(profile.education), "education");
    planSection(actions, model.sections.internship.rows, validItems(profile.experience), "experience");

    return execute(actions);
  }

  function planSection(actions, rows, items, section) {
    rows.slice(0, items.length).forEach((row, itemIndex) => {
      const item = items[itemIndex];
      row.fields.forEach((field, fieldIndex) => {
        const mapped = section === "education"
          ? mapEducation(field, item, fieldIndex, row.fields)
          : mapExperience(field, item, fieldIndex, row.fields);
        if (!mapped || !hasValue(mapped.value)) return;
        if (alreadyFilled(field.element)) return;
        actions.push(toAction(field, mapped.value, `${section}.${itemIndex}.${mapped.key}`));
      });
    });
  }

  function mapEducation(field, item, index, group) {
    const text = fieldText(field);
    if (/school|university|college|institution|学校|院校|大学/i.test(text)) return { key: "school", value: item.school };
    if (/degree|qualification|education level|学位/i.test(text)) return { key: "degree", value: item.degree };
    if (/education|academic qualification|学历/i.test(text)) return { key: "degree", value: item.degree };
    if (/major|field of study|discipline|所学专业|专业/i.test(text)) return { key: "major", value: item.major };
    if (/city|城市|所在城市/i.test(text)) return { key: "city", value: item.city || item.location || "" };
    if (/description|detail|honors|courses|描述|详情|荣誉|课程/i.test(text)) return { key: "description", value: item.description };
    return mapDate(field, item.start, item.end, index, group);
  }

  function mapExperience(field, item, index, group) {
    const text = fieldText(field);
    if (/company|employer|organization|enterprise|企业名称|公司名称|公司|单位|机构|雇主/i.test(text)) return { key: "company", value: item.company };
    if (/title|position|role|job title|职位名称|职位|岗位|职务|角色/i.test(text)) return { key: "title", value: item.title };
    if (/description|responsibilities|achievement|duties|工作描述|工作内容|实习内容|职责|业绩|描述/i.test(text)) return { key: "description", value: item.description };
    if (field.control === "checkbox" && /至今|present|current/i.test(text)) {
      return { key: "end.current", value: /至今|present|current/i.test(String(item.end || "")) };
    }
    return mapDate(field, item.start, item.end, index, group);
  }

  function mapDate(field, startValue, endValue, index, group) {
    const text = fieldText(field);
    const dateLike = /date|time|日期|时间|开始|结束|入学|毕业|任职|实习|^年$|^月$/i.test(text) || field.kind === "date";
    if (!dateLike) return null;

    const start = splitDate(startValue);
    const end = splitDate(endValue);
    if (/开始|入学|from|start|begin/i.test(text)) return { key: "start", value: dateValueForField(field, start) };
    if (/结束|毕业|to|end|finish/i.test(text)) return { key: "end", value: dateValueForField(field, end) };

    const dateFields = group.filter((candidate) => {
      const candidateText = fieldText(candidate);
      return /date|time|日期|时间|开始|结束|入学|毕业|任职|实习|^年$|^月$/i.test(candidateText) || candidate.kind === "date";
    });
    const position = dateFields.indexOf(field);
    if (dateFields.length >= 4) {
      const values = [start.year, start.month, end.year, end.month];
      return { key: position < 2 ? "start" : "end", value: values[position] || "" };
    }
    if (dateFields.length === 2) {
      return position === 0
        ? { key: "start", value: dateValueForField(field, start) }
        : { key: "end", value: dateValueForField(field, end) };
    }
    return { key: index === 0 ? "start" : "end", value: index === 0 ? dateValueForField(field, start) : dateValueForField(field, end) };
  }

  function dateValueForField(field, date) {
    const text = fieldText(field);
    const placeholder = scanner.normalizeText(field.element.getAttribute("placeholder"));
    if (/月|month/i.test(`${text} ${placeholder}`)) return date.month;
    if (/年|year/i.test(`${text} ${placeholder}`)) return date.year;
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
      value,
      source,
      element: field.element,
      debug: {
        label: field.text,
        matchedProfilePath: source,
        source: "repeated-profile-fallback"
      }
    };
  }

  async function execute(actions) {
    let filled = 0;
    let failed = 0;
    const failures = [];
    for (const action of dedupe(actions)) {
      const element = action.element || scanner.findElementByApplyPilotId(action.fieldId);
      if (!element) {
        failed += 1;
        failures.push({ label: action.debug?.label || action.source, reason: "repeated-target-not-found", value: preview(action.value) });
        continue;
      }
      const result = await actionsApi.execute(action, element);
      if (result === true || result?.ok) filled += 1;
      else {
        failed += 1;
        failures.push({
          label: action.debug?.label || action.source,
          reason: result?.reason || "repeated-action-failed",
          method: result?.method || "",
          value: preview(action.value)
        });
      }
      await scanner.sleep(90);
    }
    return { filled, failed, failures, planned: actions.length };
  }

  function alreadyFilled(element) {
    const value = scanner.normalizeText(scanner.getDisplayFieldValue(element));
    return Boolean(value) && !/^(请选择|--请选择--|请输入|年|月|please select|select|choose)$/.test(value);
  }

  function fieldText(field) {
    return `${field.fieldTextNormalized || field.text || ""} ${field.sectionText || ""}`;
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

  function preview(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }
})();
