(function () {
  if (window.__APPLYPILOT_FIELD_SAFETY_GUARD__) return;
  window.__APPLYPILOT_FIELD_SAFETY_GUARD__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  if (!scanner || !actionsApi) return;

  const originalExecute = actionsApi.execute.bind(actionsApi);

  const RULES = [
    rule(/^education\.\d+\.school$/, /^(?:school(?: name)?|university(?: name)?|institution(?: name)?|college name|学校(?:名称)?|院校(?:名称)?|大学(?:名称)?|毕业院校)$/i),
    rule(/^education\.\d+\.degree$/, /^(?:degree|academic degree|education level|academic qualification|highest education|学位|学历|学历类型)$/i),
    rule(/^education\.\d+\.major$/, /^(?:major|major name|field of study|discipline|program|所学专业|专业|专业名称)$/i),
    rule(/^education\.\d+\.city$/, /^(?:city|location|所在城市|城市|学校所在地)$/i),
    rule(/^education\.\d+\.description$/, /^(?:description|details|honors|courses|教育描述|教育详情|主修课程|荣誉|课程)$/i),
    rule(/^education\.\d+\.(?:start|end)$/, DATE_LABEL),

    rule(/^experience\.\d+\.company$/, /^(?:company|company name|employer|organization|enterprise|企业名称|公司名称|公司|单位|机构|雇主)$/i),
    rule(/^experience\.\d+\.title$/, /^(?:title|position|role|job title|职位名称|职位|岗位|职务|角色)$/i),
    rule(/^experience\.\d+\.description$/, /^(?:description|responsibilities|achievements?|duties|work description|工作描述|工作内容|实习内容|职责|业绩|主要工作)$/i),
    rule(/^experience\.\d+\.(?:start|end(?:\.current)?)$/, /^(?:开始时间|起始时间|任职开始|实习开始|结束时间|终止时间|任职结束|实习结束|至今|目前在职|start(?: date)?|end(?: date)?|from|to|present|current)$/i),

    rule(/^projects\.\d+\.name$/, /^(?:project name|项目名称|项目名)$/i),
    rule(/^projects\.\d+\.role$/, /^(?:project role|role|position|担任角色|项目角色|角色|职位)$/i),
    rule(/^projects\.\d+\.description$/, /^(?:project description|project details|项目描述|项目内容|项目职责|项目成果|描述|内容|职责|成果)$/i),
    rule(/^projects\.\d+\.url$/, /^(?:project url|project link|项目链接|链接|网址|url)$/i),
    rule(/^projects\.\d+\.(?:start|end)$/, DATE_LABEL),

    rule(/^personal\.email$/, /^(?:email|email address|private email|personal email|e-mail|邮箱|私人邮箱|个人邮箱|电子邮件)$/i),
    rule(/^personal\.phone$/, /^(?:phone|mobile|telephone|contact number|mobile number|mobile area|country code|dialing code|电话号码|手机号|手机号码|联系电话|电话|国家区号|手机区号|电话区号)$/i),
    rule(/^personal\.(?:fullName|chineseName|preferredName)$/, /^(?:full name|legal name|candidate name|applicant name|name|姓名|全名|中文名|中文姓名|常用名|英文名)$/i),
    rule(/^personal\.firstName$/, /^(?:first name|given name|forename|名|名字)$/i),
    rule(/^personal\.lastName$/, /^(?:last name|family name|surname|姓)$/i),
    rule(/^personal\.(?:latestSchool)$/, /^(?:school|university|college|学校|毕业院校|院校)$/i),
    rule(/^personal\.(?:latestMajor)$/, /^(?:major|field of study|专业|所学专业)$/i),
    rule(/^personal\.(?:highestDegree)$/, /^(?:highest degree|highest education|education level|academic degree|最高学历|学历|学位)$/i)
  ];

  actionsApi.execute = async function executeWithFieldSafety(action, element) {
    if (!action || action.type === "click") return originalExecute(action, element);

    const source = String(action.source || action.debug?.matchedProfilePath || "");
    const matchedRule = RULES.find((entry) => entry.source.test(source));
    if (!matchedRule) return originalExecute(action, element);

    const label = ownFieldLabel(element, action);
    if (!label || !matchedRule.label.test(label)) {
      return {
        ok: false,
        reason: "profile-path-field-mismatch",
        method: "field-safety-guard",
        source,
        label
      };
    }
    return originalExecute(action, element);
  };

  function rule(source, label) {
    return { source, label };
  }

  function ownFieldLabel(element, action) {
    if (!element) return "";
    const value = scanner.getLabelText?.(element)
      || element.getAttribute?.("aria-label")
      || referencedText(element, "aria-labelledby")
      || element.getAttribute?.("placeholder")
      || element.getAttribute?.("name")
      || action.debug?.label
      || "";
    return clean(value);
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

  function clean(value) {
    return String(value || "")
      .replace(/[＊*：:]+/g, " ")
      .replace(/请输入|请选择|please\s+(?:enter|select|choose)|required|必填/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const DATE_LABEL = /^(?:开始时间|起始时间|入学时间|就读开始|项目开始|任职开始|实习开始|结束时间|终止时间|毕业时间|项目结束|任职结束|实习结束|start(?: date)?|end(?: date)?|from|to|begin|finish|date|日期|时间|年|月)$/i;
})();
