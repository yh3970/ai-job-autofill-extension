(function () {
  if (window.__APPLYPILOT_REPEATED_PROFILE_ADAPTER__) return;
  window.__APPLYPILOT_REPEATED_PROFILE_ADAPTER__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  const agent = window.ApplyPilotFormAgent;
  if (!scanner || !actionsApi || !agent) return;

  const originalRunAgent = agent.runAgent.bind(agent);

  const AMBIGUOUS_EDUCATION_LABELS = /^(?:学院|院系|系所|实验室|研究室|领域方向|研究方向|导师|指导教师|指导老师|导师姓名|成绩|排名|绩点|gpa|培养方式|学制)$/i;

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
        repeatedAmbiguousSkipped: fallback.ambiguousSkipped,
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
    const diagnostics = { ambiguousSkipped: 0 };

    planSection(actions, model.sections.education.rows, validItems(profile.education), "education", diagnostics);
    planSection(actions, model.sections.internship.rows, validItems(profile.experience), "experience", diagnostics);

    const result = await execute(actions);
    return { ...result, ambiguousSkipped: diagnostics.ambiguousSkipped };
  }

  function planSection(actions, rows, items, section, diagnostics) {
    rows.slice(0, items.length).forEach((row, itemIndex) => {
      const item = items[itemIndex];
      row.fields.forEach((field, fieldIndex) => {
        const mapped = section === "education"
          ? mapEducation(field, item, fieldIndex, row.fields, diagnostics)
          : mapExperience(field, item, fieldIndex, row.fields);
        if (!mapped || !hasValue(mapped.value)) return;
        if (alreadyFilled(field.element)) return;
        actions.push(toAction(field, mapped.value, `${section}.${itemIndex}.${mapped.key}`));
      });
    });
  }

  function mapEducation(field, item, index, group, diagnostics) {
    const label = ownFieldLabel(field);
    if (!label) return null;

    if (AMBIGUOUS_EDUCATION_LABELS.test(label)) {
      diagnostics.ambiguousSkipped += 1;
      return null;
    }

    if (/^(?:school(?: name)?|university(?: name)?|institution(?: name)?|college name|学校(?:名称)?|院校(?:名称)?|大学(?:名称)?|毕业院校)$/i.test(label)) {
      return { key: "school", value: item.school };
    }
    if (/^(?:degree|academic degree|学位)$/i.test(label)) {
      return { key: "degree", value: item.degree };
    }
    if (/^(?:education level|academic qualification|highest education|学历|学历类型)$/i.test(label)) {
      return { key: "degree", value: item.degree };
    }
    if (/^(?:major|major name|field of study|discipline|program|所学专业|专业|专业名称)$/i.test(label)) {
      return { key: "major", value: item.major };
    }
    if (/^(?:city|location|所在城市|城市|学校所在地)$/i.test(label)) {
      return { key: "city", value: item.city || item.location || "" };
    }
    if (/^(?:description|details|honors|courses|教育描述|教育详情|主修课程|荣誉|课程)$/i.test(label)) {
      return { key: "description", value: item.description };
    }
    return mapDate(field, item.start, item.end, index, group);
  }

  function mapExperience(field, item, index, group) {
    const label = ownFieldLabel(field);
    if (!label) return null;

    if (/^(?:company|company name|employer|organization|enterprise|企业名称|公司名称|公司|单位|机构|雇主)$/i.test(label)) {
      return { key: "company", value: item.company };
    }
    if (/^(?:title|position|role|job title|职位名称|职位|岗位|职务|角色)$/i.test(label)) {
      return { key: "title", value: item.title };
    }
    if (/^(?:description|responsibilities|achievements?|duties|work description|工作描述|工作内容|实习内容|职责|业绩|主要工作)$/i.test(label)) {
      return { key: "description", value: item.description };
    }
    if (field.control === "checkbox" && /^(?:至今|目前在职|present|current|currently working)$/i.test(label)) {
      return { key: "end.current", value: /至今|present|current/i.test(String(item.end || "")) };
    }
    return mapDate(field, item.start, item.end, index, group);
  }

  function mapDate(field, startValue, endValue, index, group) {
    const label = ownFieldLabel(field);
    const placeholder = cleanLabel(field.element.getAttribute("placeholder"));
    const text = `${label} ${placeholder}`.trim();
    const dateLike = /date|time|日期|时间|开始|结束|入学|毕业|任职|实习|^年$|^月$/i.test(text) || field.kind === "date";
    if (!dateLike) return null;

    const start = splitDate(startValue);
    const end = splitDate(endValue);
    if (/开始|入学|from|start|begin/i.test(text)) return { key: "start", value: dateValueForField(field, start) };
    if (/结束|毕业|to|end|finish/i.test(text)) return { key: "end", value: dateValueForField(field, end) };

    const dateFields = group.filter((candidate) => {
      const candidateText = `${ownFieldLabel(candidate)} ${cleanLabel(candidate.element.getAttribute("placeholder"))}`;
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
    return null;
  }

  function dateValueForField(field, date) {
    const text = `${ownFieldLabel(field)} ${cleanLabel(field.element.getAttribute("placeholder"))}`;
    if (/月|month/i.test(text)) return date.month;
    if (/年|year/i.test(text)) return date.year;
    return date.year && date.month ? `${date.year}-${String(date.month).padStart(2, "0")}` : date.year;
  }

  function ownFieldLabel(field) {
    const element = field.element;
    const explicit = scanner.getLabelText?.(element)
      || element.getAttribute("aria-label")
      || referencedText(element, "aria-labelledby")
      || element.getAttribute("placeholder")
      || element.getAttribute("name")
      || field.fieldTextNormalized
      || field.text
      || "";
    return cleanLabel(explicit);
  }

  function referencedText(element, attribute) {
    const root = element.getRootNode();
    return String(element.getAttribute(attribute) || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => root.getElementById?.(id)?.textContent || document.getElementById(id)?.textContent || "")
      .filter(Boolean)
      .join(" ");
  }

  function cleanLabel(value) {
    return String(value || "")
      .replace(/[＊*：:]+/g, " ")
      .replace(/请输入|请选择|please\s+(?:enter|select|choose)|required|必填/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
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
        label: ownFieldLabel(field),
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
