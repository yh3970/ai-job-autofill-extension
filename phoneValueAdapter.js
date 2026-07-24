(function () {
  if (window.__APPLYPILOT_PHONE_VALUE_ADAPTER__) return;
  window.__APPLYPILOT_PHONE_VALUE_ADAPTER__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  if (!scanner || !actionsApi) return;

  const originalExecute = actionsApi.execute.bind(actionsApi);

  actionsApi.execute = async function executeWithPhoneAdaptation(action, element) {
    if (!isPhoneAction(action, element)) {
      return originalExecute(action, element);
    }

    const fieldText = scanner.normalizeText([
      action.debug?.label,
      scanner.getElementText(element),
      element?.getAttribute?.("name"),
      element?.id
    ].filter(Boolean).join(" "));
    const control = scanner.getControlType(element);
    const phone = String(action.value ?? "").trim();

    if (isAreaCodeField(fieldText, control)) {
      const areaValue = deriveAreaValue(phone);
      if (!areaValue) {
        return { ok: true, method: "phone-area-unknown-skip" };
      }

      const current = scanner.normalizeText(scanner.getDisplayFieldValue(element));
      if (selectionMatchesArea(current, areaValue)) {
        return { ok: true, method: "phone-area-already-selected" };
      }

      return originalExecute({
        ...action,
        type: "selectOption",
        value: areaValue,
        debug: {
          ...(action.debug || {}),
          label: action.debug?.label || scanner.getElementText(element),
          phoneAdaptedFrom: phone
        }
      }, element);
    }

    const localNumber = deriveLocalNumber(phone);
    return originalExecute({
      ...action,
      value: localNumber || phone,
      debug: {
        ...(action.debug || {}),
        label: action.debug?.label || scanner.getElementText(element),
        phoneAdaptedFrom: phone
      }
    }, element);
  };

  function isPhoneAction(action, element) {
    const source = String(action?.source || action?.debug?.matchedProfilePath || "");
    if (source === "personal.phone" || source.endsWith(".phone")) return true;
    const text = scanner.normalizeText([
      action?.debug?.label,
      element ? scanner.getElementText(element) : "",
      element?.getAttribute?.("name"),
      element?.id
    ].filter(Boolean).join(" "));
    return /phone|mobile|telephone|手机号码|手机号|联系电话|电话/.test(text);
  }

  function isAreaCodeField(text, control) {
    if (/mobile\s*area|phone\s*area|country\s*code|dial(?:ing)?\s*code|area\s*code|国家代码|国家区号|电话区号|手机区号|国际区号/.test(text)) return true;
    return ["native-select", "custom-select"].includes(control) && /phone|mobile|手机|电话/.test(text);
  }

  function deriveAreaValue(phone) {
    const compact = String(phone || "").replace(/[\s()-]/g, "");
    if (/^(?:\+?86|0086)/.test(compact)) return "中国大陆";
    if (/^(?:\+?852|00852)/.test(compact)) return "中国香港";
    if (/^(?:\+?853|00853)/.test(compact)) return "中国澳门";
    if (/^(?:\+?886|00886)/.test(compact)) return "中国台湾";
    if (/^(?:\+?44|0044)/.test(compact)) return "英国";
    if (/^(?:\+?1|001)/.test(compact)) return "美国";
    return "";
  }

  function deriveLocalNumber(phone) {
    let compact = String(phone || "").replace(/[\s()-]/g, "");
    compact = compact.replace(/^00/, "+");
    for (const prefix of ["+86", "+852", "+853", "+886", "+44", "+1"]) {
      if (compact.startsWith(prefix)) return compact.slice(prefix.length);
    }
    return compact;
  }

  function selectionMatchesArea(current, expected) {
    if (!current || /请选择|please select/.test(current)) return false;
    const aliases = {
      "中国大陆": ["中国大陆", "中国", "+86", "86", "mainland china", "china"],
      "中国香港": ["中国香港", "香港", "+852", "852", "hong kong"],
      "中国澳门": ["中国澳门", "澳门", "+853", "853", "macao", "macau"],
      "中国台湾": ["中国台湾", "台湾", "+886", "886", "taiwan"],
      "英国": ["英国", "+44", "44", "united kingdom", "uk"],
      "美国": ["美国", "+1", "1", "united states", "usa"]
    };
    return (aliases[expected] || [expected]).some((alias) => current.includes(scanner.normalizeText(alias)));
  }
})();
