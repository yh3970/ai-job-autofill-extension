(function () {
  if (window.__APPLYPILOT_REPEATED_PROFILE_ADAPTER__) return;
  window.__APPLYPILOT_REPEATED_PROFILE_ADAPTER__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  const agent = window.ApplyPilotFormAgent;
  if (!scanner || !actionsApi || !agent) return;

  const originalRunAgent = agent.runAgent.bind(agent);

  const AMBIGUOUS_EDUCATION_LABELS = /^(?:学院|院系|系所|学历类型|培养类型|培养方式|学习形式|实验室|研究室|领域方向|研究方向|导师|指导教师|指导老师|导师姓名|成绩|排名|绩点|gpa|学制)$/i;
  const SCHOOL_LABEL = /^(?:school(?: name)?|university(?: name)?|institution(?: name)?|college name|学校(?:名称)?|院校(?:名称)?|大学(?:名称)?|毕业院校)$/i;
  const DEGREE_LABEL = /^(?:degree|academic degree|education level|academic qualification|highest education|学位|学历|最高学历)$/i;
  const MAJOR_LABEL = /^(?:major|major name|field of study|discipline|program|所学专业|专业|专业名称)$/i;
  const EDUCATION_CITY_LABEL = /^(?:city|location|所在城市|城市|学校所在地)$/i;
  const EDUCATION_DESCRIPTION_LABEL = /^(?:description|details|honors|courses|教育描述|教育详情|主修课程|荣誉|课程)$/i;

  const COMPANY_LABEL = /^(?:company|company name|employer|organization|enterprise|企业名称|公司名称|公司|单位|机构|雇主)$/i;
  const TITLE_LABEL = /^(?:title|position|role|job title|职位名称|职位|岗位|职务|角色)$/i;
  const EXPERIENCE_DESCRIPTION_LABEL = /^(?:description|responsibilities|achievements?|duties|work description|工作描述|工作内容|实习内容|职责|业绩|主要工作)$/i;
  const PRESENT_LABEL = /^(?:至今|目前在职|present|current|currently working)$/i;
  const START_LABEL = /(?:开始|起始|入学|就读开始|任职开始|实习开始|from|start|begin)/i;
  const END_LABEL = /(?:结束|终止|毕业|任职结束|实习结束|to|end|finish)/i;
  const DATE_LABEL = /(?:起止时间|就读时间|在校时间|任职时间|实习时间|date|time|日期|时间|开始|结束|入学|毕业|任职|实习|^年$|^月$)/i;

  const KNOWN_LABELS = [
    "学校名称", "毕业院校", "专业名称", "所学专业", "最高学历", "教育详情", "教育描述", "主修课程",
    "企业名称", "公司名称", "职位名称", "工作描述", "工作内容", "实习内容", "主要工作",
    "起止时间", "就读时间", "在校时间", "开始时间", "结束时间", "入学时间", "毕业时间",
    "学院", "院系", "系所", "学历类型", "培养类型", "培养方式", "学习形式", "实验室", "研究室",
    "领域方向", "研究方向", "导师", "指导教师", "指导老师", "成绩", "排名", "绩点", "学制",
    "学校", "院校", "大学", "专业", "学历", "学位", "城市", "课程", "荣誉",
    "公司", "单位", "机构", "职位", "岗位", "职务", "角色", "职责", "业绩", "至今",
    "school name", "university name", "institution name", "college name", "field of study", "major name",
    "academic degree", "education level", "company name", "job title", "work description", "start date", "end date",
    "school", "university", "institution", "major", "degree", "company", "employer", "title", "position", "description"
  ].sort((left, right) => right.length - left.length);

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
        repeatedTargetsRefreshed: fallback.targetsRefreshed,
        failed: Number(base.diagnostics?.failed || 0) + fallback.failed
      },
      uncertain: [...(base.uncertain || []), ...fallback.failures].slice(0, 80),
      repeatedFallbackFailures: fallback.failures
    };
  };

  async function runRepeatedFallback(profile) {
    await scanner.waitForStableFields(1800);
    const model = scanner.understandPage();
    const actions = [];
    const diagnostics = { ambiguousSkipped: 0 };

    planSection(actions, model.sections.education.rows, validItems(profile.education), "education", diagnostics);
    planSection(actions, model.sections.internship.rows, validItems(profile.experience), "experience", diagnostics);

    const result = await execute(actions, profile);
    return { ...result, ambiguousSkipped: diagnostics.ambiguousSkipped };
  }

  function planSection(actions, rows, items, section, diagnostics) {
    rows.slice(0, items.length).forEach((row, itemIndex) => {
      const item = items[itemIndex];
      const occurrences = new Map();
      row.fields.forEach((field) => {
        const mapped = section === "education"
          ? mapEducation(field, item, row.fields, diagnostics)
          : mapExperience(field, item, row.fields);
        if (!mapped || !hasValue(mapped.value)) return;
        if (alreadyFilled(field.element)) return;

        const occurrence = occurrences.get(mapped.key) || 0;
        occurrences.set(mapped.key, occurrence + 1);
        actions.push(toAction(field, mapped.value, `${section}.${itemIndex}.${mapped.key}`, {
          section,
          itemIndex,
          key: mapped.key,
          occurrence
        }));
      });
    });
  }

  function mapEducation(field, item, group, diagnostics) {
    const key = identifyEducationKey(field, group, diagnostics);
    if (!key) return null;
    if (key === "school") return { key, value: item.school };
    if (key === "degree") return { key, value: item.degree };
    if (key === "major") return { key, value: item.major };
    if (key === "city") return { key, value: item.city || item.location || "" };
    if (key === "description") return { key, value: item.description };
    if (key === "start") return { key, value: dateValueForField(field, splitDate(item.start)) };
    if (key === "end") return { key, value: dateValueForField(field, splitDate(item.end)) };
    return null;
  }

  function mapExperience(field, item, group) {
    const key = identifyExperienceKey(field, group);
    if (!key) return null;
    if (key === "company") return { key, value: item.company };
    if (key === "title") return { key, value: item.title };
    if (key === "description") return { key, value: item.description };
    if (key === "end.current") return { key, value: /至今|present|current/i.test(String(item.end || "")) };
    if (key === "start") return { key, value: dateValueForField(field, splitDate(item.start)) };
    if (key === "end") return { key, value: dateValueForField(field, splitDate(item.end)) };
    return null;
  }

  function identifyEducationKey(field, group, diagnostics) {
    const label = ownFieldLabel(field);
    if (!label) return "";
    if (AMBIGUOUS_EDUCATION_LABELS.test(label)) {
      if (diagnostics) diagnostics.ambiguousSkipped += 1;
      return "";
    }
    if (SCHOOL_LABEL.test(label)) return "school";
    if (DEGREE_LABEL.test(label)) return "degree";
    if (MAJOR_LABEL.test(label)) return "major";
    if (EDUCATION_CITY_LABEL.test(label)) return "city";
    if (EDUCATION_DESCRIPTION_LABEL.test(label)) return "description";
    return identifyDateKey(field, group);
  }

  function identifyExperienceKey(field, group) {
    const label = ownFieldLabel(field);
    if (!label) return "";
    if (COMPANY_LABEL.test(label)) return "company";
    if (TITLE_LABEL.test(label)) return "title";
    if (EXPERIENCE_DESCRIPTION_LABEL.test(label)) return "description";
    if (field.control === "checkbox" && PRESENT_LABEL.test(label)) return "end.current";
    return identifyDateKey(field, group);
  }

  function identifyDateKey(field, group) {
    const label = ownFieldLabel(field);
    const placeholder = cleanLabel(field.element.getAttribute("placeholder"));
    const text = `${label} ${placeholder}`.trim();
    if (!DATE_LABEL.test(text) && field.kind !== "date") return "";
    if (START_LABEL.test(text) && !END_LABEL.test(text)) return "start";
    if (END_LABEL.test(text) && !START_LABEL.test(text)) return "end";

    const dateFields = group.filter((candidate) => isDateField(candidate));
    const position = dateFields.indexOf(field);
    if (position < 0) return "";
    if (dateFields.length >= 4) return position < 2 ? "start" : "end";
    if (dateFields.length === 2) return position === 0 ? "start" : "end";
    return "";
  }

  function isDateField(field) {
    const text = `${ownFieldLabel(field)} ${cleanLabel(field.element.getAttribute("placeholder"))}`;
    return DATE_LABEL.test(text) || field.kind === "date";
  }

  function dateValueForField(field, date) {
    const text = `${ownFieldLabel(field)} ${cleanLabel(field.element.getAttribute("placeholder"))}`;
    if (/月|month/i.test(text)) return date.month;
    if (/年|year/i.test(text)) return date.year;
    return date.year && date.month ? `${date.year}-${String(date.month).padStart(2, "0")}` : date.year;
  }

  function ownFieldLabel(field) {
    const element = field.element;
    const candidates = [
      scanner.getLabelText?.(element),
      element.getAttribute("aria-label"),
      referencedText(element, "aria-labelledby"),
      field.fieldTextNormalized,
      field.text,
      element.getAttribute("placeholder"),
      element.getAttribute("name")
    ].map(cleanLabel).filter(Boolean);

    for (const candidate of candidates) {
      const extracted = extractKnownLabel(candidate);
      if (extracted) return extracted;
    }
    return "";
  }

  function extractKnownLabel(value) {
    const cleaned = cleanLabel(value);
    if (!cleaned) return "";
    const exact = KNOWN_LABELS.find((label) => normalize(label) === normalize(cleaned));
    if (exact) return exact;

    const matches = KNOWN_LABELS
      .map((label) => ({ label, index: normalize(cleaned).indexOf(normalize(label)) }))
      .filter((entry) => entry.index >= 0)
      .sort((left, right) => left.index - right.index || right.label.length - left.label.length);
    if (!matches.length) return "";

    const first = matches[0];
    const distinctNearby = matches.find((entry) => entry.label !== first.label && entry.index <= first.index + first.label.length + 12);
    return distinctNearby ? "" : first.label;
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

  function toAction(field, value, source, locator) {
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
      locator,
      debug: {
        label: ownFieldLabel(field),
        matchedProfilePath: source,
        source: "repeated-profile-fallback"
      }
    };
  }

  async function execute(actions, profile) {
    let filled = 0;
    let failed = 0;
    let targetsRefreshed = 0;
    const failures = [];

    for (const action of dedupe(actions)) {
      const resolved = resolveCurrentTarget(action, profile);
      if (!resolved?.element) {
        failed += 1;
        failures.push({ label: action.debug?.label || action.source, reason: "repeated-target-not-found", value: preview(action.value) });
        continue;
      }
      if (resolved.refreshed) targetsRefreshed += 1;

      const currentValue = scanner.normalizeText(scanner.getDisplayFieldValue(resolved.element));
      if (currentValue && !isPlaceholderValue(currentValue)) {
        if (valueMatches(currentValue, action.value)) {
          filled += 1;
          continue;
        }
        failures.push({ label: resolved.label, reason: "existing-value-preserved", value: preview(action.value) });
        continue;
      }

      const liveAction = {
        ...action,
        fieldId: resolved.field.id,
        debug: { ...(action.debug || {}), label: resolved.label }
      };
      const result = await actionsApi.execute(liveAction, resolved.element);
      if (result === true || result?.ok) filled += 1;
      else {
        failed += 1;
        failures.push({
          label: resolved.label || action.source,
          reason: result?.reason || "repeated-action-failed",
          method: result?.method || "",
          value: preview(action.value)
        });
      }
      await scanner.sleep(140);
    }
    return { filled, failed, failures, planned: actions.length, targetsRefreshed };
  }

  function resolveCurrentTarget(action, profile) {
    const locator = action.locator;
    if (!locator) return null;

    const model = scanner.understandPage();
    const rows = locator.section === "education"
      ? model.sections.education.rows
      : model.sections.internship.rows;
    const row = rows[locator.itemIndex];
    if (!row) return null;

    const item = locator.section === "education"
      ? validItems(profile.education)[locator.itemIndex]
      : validItems(profile.experience)[locator.itemIndex];
    if (!item) return null;

    const matches = row.fields.filter((field) => {
      const key = locator.section === "education"
        ? identifyEducationKey(field, row.fields)
        : identifyExperienceKey(field, row.fields);
      return key === locator.key;
    });
    const field = matches[locator.occurrence] || null;
    if (!field) return null;

    return {
      field,
      element: field.element,
      label: ownFieldLabel(field),
      refreshed: field.id !== action.fieldId
    };
  }

  function alreadyFilled(element) {
    const value = scanner.normalizeText(scanner.getDisplayFieldValue(element));
    return Boolean(value) && !isPlaceholderValue(value);
  }

  function isPlaceholderValue(value) {
    return /^(请选择|--请选择--|请输入|年|月|please select|select|choose)$/.test(scanner.normalizeText(value));
  }

  function valueMatches(current, expected) {
    const left = scanner.normalizeText(current);
    const right = scanner.normalizeText(expected);
    return left === right || left.includes(right) || right.includes(left);
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
      const key = `${action.locator?.section}|${action.locator?.itemIndex}|${action.locator?.key}|${action.locator?.occurrence}|${action.type}|${scanner.normalizeText(action.value)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function preview(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }
})();
