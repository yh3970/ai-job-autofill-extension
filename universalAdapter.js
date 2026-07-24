(function () {
  if (window.__APPLYPILOT_UNIVERSAL_ADAPTER__) return;
  window.__APPLYPILOT_UNIVERSAL_ADAPTER__ = true;

  const agent = window.ApplyPilotFormAgent;
  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  if (!agent || !scanner || !actionsApi) return;

  const SCALAR_MAPPINGS = [
    ["personal.email", /e-?mail|私人邮箱|个人邮箱|电子邮件|邮箱/i],
    ["personal.phone", /mobile|phone|telephone|手机号码|手机号|联系电话|电话/i],
    ["personal.fullName", /full name|legal name|candidate name|applicant name|^姓名$|姓名/i],
    ["personal.gender", /gender|sex\b|^性别$/i],
    ["personal.birthDate", /date of birth|birth date|birthday|dob|出生日期|生日/i],
    ["personal.ethnicity", /ethnicity|ethnic group|^民族$/i],
    ["personal.maritalStatus", /marital status|marriage status|婚姻状况|婚姻状态/i],
    ["personal.politicalStatus", /political status|political affiliation|政治面貌/i],
    ["personal.idType", /id type|identity document type|document type|证件类型/i],
    ["personal.idNumber", /id number|identity number|document number|证件号码|身份证号/i],
    ["personal.nationality", /nationality|citizenship|country.?region|国籍|国家.?地区/i],
    ["personal.currentResidence", /current residence|current address|现居住地|现居住址|当前居住地/i],
    ["personal.householdLocation", /household registration|registered residence|hukou|户口所在地|户籍所在地|户籍/i],
    ["personal.nativePlace", /native place|place of origin|籍贯/i],
    ["personal.location", /current location|location|所在地|所在城市|城市/i],
    ["personal.address", /mailing address|street address|通讯地址|详细地址|地址/i],
    ["personal.highestDegree", /highest degree|highest education|education level|最高学历|^学历$|^学位$/i],
    ["personal.latestMajor", /^major$|field of study|所学专业|^专业$/i],
    ["personal.latestSchool", /latest school|graduated school|毕业院校|最高院校/i],
    ["personal.linkedin", /linkedin|领英/i],
    ["personal.github", /github/i],
    ["personal.portfolio", /portfolio|personal website|作品集|个人网站/i],
    ["workAuthorization", /work authorization|work permit|visa status|工作许可|工作签证/i],
    ["visaSponsorship", /visa sponsorship|need sponsorship|签证担保|是否需要担保/i],
    ["relocation", /relocation|willing to relocate|接受.*调剂|接受搬迁|异地/i],
    ["desiredSalary", /expected salary|salary expectation|期望薪资|薪资要求/i],
    ["noticePeriod", /notice period|time to join|到岗时间|通知期/i],
    ["availabilityDate", /available date|earliest start|可入职日期|开始工作/i],
    ["summary", /personal summary|profile summary|cover letter|个人简介|自我介绍|求职信/i]
  ];

  const SENSITIVE_PATTERNS = [
    /gender|sex\b|性别/i,
    /birth|birthday|dob|出生|生日/i,
    /ethnicity|民族|种族|族裔/i,
    /marital|婚姻/i,
    /political|政治面貌/i,
    /id number|identity|身份证|证件号码|证件类型/i,
    /health|medical|疾病|健康/i,
    /criminal|犯罪|刑事/i
  ];

  const originalRunAgent = agent.runAgent.bind(agent);
  agent.runAgent = async function runWithUniversalAdapter(profile, memory) {
    const base = await originalRunAgent(profile, memory);
    const universal = await runUniversalAdapter(profile || {});
    return mergeResults(base, universal);
  };

  async function runUniversalAdapter(profile) {
    await scanner.waitForStableFields(1800);
    const model = scanner.understandPage();
    const actions = [];

    const enrichedProfile = buildEnrichedProfile(profile);
    planScalarActions(actions, model.fields, enrichedProfile, profile.preferences || {});
    planRepeatedActions(actions, model.sections.education.fields, validItems(profile.education), "education");
    planRepeatedActions(actions, model.sections.internship.fields, validItems(profile.experience), "experience");

    return executeActions(dedupeActions(actions));
  }

  function buildEnrichedProfile(profile) {
    const education = validItems(profile.education);
    const latest = education[0] || {};
    const highestDegree = profile.personal?.highestDegree || deriveHighestDegree(education);
    return {
      ...profile,
      personal: {
        ...(profile.personal || {}),
        highestDegree,
        latestMajor: profile.personal?.latestMajor || latest.major || "",
        latestSchool: profile.personal?.latestSchool || latest.school || "",
        currentResidence: profile.personal?.currentResidence || profile.personal?.location || ""
      }
    };
  }

  function planScalarActions(actions, fields, profile, preferences) {
    for (const [path, pattern] of SCALAR_MAPPINGS) {
      const value = getPath(profile, path);
      if (!hasValue(value)) continue;
      const candidates = fields.filter((field) => pattern.test(field.fieldTextNormalized || field.text));
      for (const field of candidates) {
        if (isRepeatedSection(field.section)) continue;
        if (isSensitive(field) && !preferences.allowSensitiveAutofill) continue;
        actions.push(toAction(field, value, path));
      }
    }
  }

  function planRepeatedActions(actions, fields, items, sectionName) {
    if (!fields.length || !items.length) return;
    const anchorPattern = sectionName === "education"
      ? /school|university|college|institution|学校|院校|大学/i
      : /company|employer|organization|公司|单位|机构/i;
    const groups = groupFields(fields, anchorPattern);

    groups.slice(0, items.length).forEach((group, itemIndex) => {
      const item = items[itemIndex];
      group.forEach((field, fieldIndex) => {
        const mapped = sectionName === "education"
          ? mapEducationField(field, item, fieldIndex, group)
          : mapExperienceField(field, item, fieldIndex, group);
        if (mapped && hasValue(mapped.value)) actions.push(toAction(field, mapped.value, `${sectionName}.${itemIndex}.${mapped.key}`));
      });
    });
  }

  function groupFields(fields, anchorPattern) {
    const groups = [];
    let current = [];
    let currentHasAnchor = false;

    for (const field of fields) {
      const isAnchor = anchorPattern.test(field.fieldTextNormalized || field.text);
      if (isAnchor && currentHasAnchor && current.length) {
        groups.push(current);
        current = [];
        currentHasAnchor = false;
      }
      current.push(field);
      if (isAnchor) currentHasAnchor = true;
    }
    if (current.length) groups.push(current);
    return groups;
  }

  function mapEducationField(field, item, index, group) {
    const text = fieldText(field);
    if (/school|university|college|institution|学校|院校|大学/i.test(text)) return { key: "school", value: item.school };
    if (/degree|qualification|education level|学历|学位/i.test(text)) return { key: "degree", value: item.degree };
    if (/major|field of study|discipline|专业/i.test(text)) return { key: "major", value: item.major };
    if (/description|detail|honors|courses|描述|详情|荣誉|课程/i.test(text)) return { key: "description", value: item.description };
    return mapDateField(field, item.start, item.end, index, group);
  }

  function mapExperienceField(field, item, index, group) {
    const text = fieldText(field);
    if (/company|employer|organization|公司|单位|机构/i.test(text)) return { key: "company", value: item.company };
    if (/title|position|role|job title|职位|岗位|职务/i.test(text)) return { key: "title", value: item.title };
    if (/description|responsibilities|achievement|duties|工作内容|实习内容|职责|业绩|描述/i.test(text)) return { key: "description", value: item.description };
    if (field.control === "checkbox" && /至今|present|current/i.test(text)) {
      return { key: "end.current", value: /至今|present|current/i.test(String(item.end || "")) };
    }
    return mapDateField(field, item.start, item.end, index, group);
  }

  function mapDateField(field, startValue, endValue, index, group) {
    const text = fieldText(field);
    if (!/date|time|日期|时间|开始|结束|入学|毕业|任职|实习|^年$|^月$/i.test(text) && field.kind !== "date") return null;

    const dateFields = group.filter((candidate) => {
      const candidateText = fieldText(candidate);
      return /date|time|日期|时间|开始|结束|入学|毕业|任职|实习|^年$|^月$/i.test(candidateText) || candidate.kind === "date";
    });
    const position = dateFields.indexOf(field);
    const start = splitDate(startValue);
    const end = splitDate(endValue);

    if (/开始|入学|from|start|begin/i.test(text)) {
      return { key: "start", value: partForField(field, start) };
    }
    if (/结束|毕业|to|end|finish/i.test(text)) {
      return { key: "end", value: partForField(field, end) };
    }

    if (dateFields.length >= 4) {
      const values = [start.year, start.month, end.year, end.month];
      return { key: position < 2 ? "start" : "end", value: values[position] || "" };
    }
    if (dateFields.length === 2) {
      return position === 0
        ? { key: "start", value: partForField(field, start) }
        : { key: "end", value: partForField(field, end) };
    }
    return { key: "start", value: partForField(field, start) };
  }

  function partForField(field, date) {
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
        source: "universal-adapter"
      }
    };
  }

  async function executeActions(actions) {
    let filled = 0;
    let failed = 0;
    let skippedExisting = 0;
    const failures = [];

    for (const action of actions) {
      const element = action.element || scanner.findElementByApplyPilotId(action.fieldId);
      if (!element) {
        failed += 1;
        failures.push({ label: action.debug?.label || action.source, reason: "universal-target-not-found", value: preview(action.value) });
        continue;
      }
      if (alreadyContainsValue(element, action.value)) {
        skippedExisting += 1;
        continue;
      }

      const result = await actionsApi.execute(action, element);
      if (result === true || result?.ok) filled += 1;
      else {
        failed += 1;
        failures.push({
          label: action.debug?.label || action.source,
          reason: result?.reason || "universal-action-failed",
          method: result?.method || "",
          value: preview(action.value)
        });
      }
      await scanner.sleep(90);
    }

    return { filled, failed, skippedExisting, failures, planned: actions.length };
  }

  function alreadyContainsValue(element, value) {
    const expected = normalize(value);
    if (!expected) return true;
    const actual = normalize(scanner.getDisplayFieldValue(element));
    if (!actual || /^(请选择|请输入|年|月|please select)$/.test(actual)) return false;
    return actual === expected || actual.includes(expected) || expected.includes(actual);
  }

  function dedupeActions(actions) {
    const seen = new Set();
    return actions.filter((action) => {
      const key = `${action.fieldId}|${action.type}|${normalize(action.value)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeResults(base, universal) {
    return {
      ...base,
      filled: Number(base.filled || 0) + Number(universal.filled || 0),
      actions: Number(base.actions || 0) + Number(universal.planned || 0),
      diagnostics: {
        ...(base.diagnostics || {}),
        universalFilled: universal.filled || 0,
        universalFailed: universal.failed || 0,
        universalSkippedExisting: universal.skippedExisting || 0,
        failed: Number(base.diagnostics?.failed || 0) + Number(universal.failed || 0)
      },
      uncertain: [...(base.uncertain || []), ...(universal.failures || [])].slice(0, 60),
      universalFailures: universal.failures || []
    };
  }

  function deriveHighestDegree(education) {
    const degrees = validItems(education).map((item) => String(item.degree || "")).filter(Boolean);
    const ranks = [
      [/博士|phd|doctor/i, 5], [/硕士|master|msc|mba/i, 4],
      [/本科|学士|bachelor|bsc/i, 3], [/大专|专科|associate/i, 2], [/高中|high school/i, 1]
    ];
    return degrees.sort((left, right) => degreeRank(right, ranks) - degreeRank(left, ranks))[0] || "";
  }

  function degreeRank(value, ranks) {
    return ranks.find(([pattern]) => pattern.test(value))?.[1] || 0;
  }

  function splitDate(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/((?:19|20)\d{2})\D{0,3}(1[0-2]|0?[1-9])?/);
    return {
      year: match?.[1] || "",
      month: match?.[2] ? String(Number(match[2])) : ""
    };
  }

  function fieldText(field) {
    return `${field.fieldTextNormalized || field.text || ""} ${field.sectionText || ""}`;
  }

  function isSensitive(field) {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(field.fieldTextNormalized || field.text || ""));
  }

  function isRepeatedSection(section) {
    return section === "education" || section === "internship";
  }

  function getPath(source, path) {
    return path.split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : "", source) ?? "";
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
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }
})();
