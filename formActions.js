(function () {
  if (window.ApplyPilotFormActions) return;

  const scanner = window.ApplyPilotFormScanner;
  const WAIT_MS = 220;
  const REQUEST_EVENT = "__applypilot_main_action_v1";
  const RESULT_EVENT = "__applypilot_main_result_v1";

  async function execute(action, element) {
    const mainWorldResult = await executeInMainWorld(action, element);
    if (mainWorldResult?.ok) return mainWorldResult;

    const isolatedOk = await executeIsolated(action, element);
    if (isolatedOk) {
      return { ok: true, method: "isolated-fallback", bridgeReason: mainWorldResult?.reason || "" };
    }
    return {
      ok: false,
      reason: mainWorldResult?.reason || "isolated-action-failed",
      method: mainWorldResult?.method || "none"
    };
  }

  async function executeInMainWorld(action, element) {
    const requestId = `ap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      requestId,
      type: action.type,
      fieldId: action.fieldId || element?.getAttribute(scanner.AP_ID) || "",
      targetId: action.targetId || "",
      value: action.value,
      fieldLabel: action.debug?.label || scanner.getElementText(element)
    };

    return new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish({ ok: false, reason: "main-world-bridge-timeout" }), 2400);

      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        document.removeEventListener(RESULT_EVENT, onResult);
        resolve(result);
      }

      function onResult(event) {
        try {
          const result = JSON.parse(String(event.detail || "{}"));
          if (result.requestId !== requestId) return;
          finish(result);
        } catch (error) {
          finish({ ok: false, reason: "main-world-result-invalid" });
        }
      }

      document.addEventListener(RESULT_EVENT, onResult);
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify(payload) }));
    });
  }

  async function executeIsolated(action, element) {
    if (action.type === "click") return clickElement(element);
    if (action.type === "inputText") return inputText(element, action.value);
    if (action.type === "selectOption") return selectOption(element, action.value);
    if (action.type === "selectDate") return selectDate(element, action.value);
    if (action.type === "setChecked") return setChecked(element, action.value);
    if (action.type === "selectRadio") return selectRadio(element, action.value);
    return false;
  }

  async function inputText(element, value) {
    await clickElement(element);
    const text = String(value ?? "");
    const editable = findEditable(element) || element;
    const tag = editable.tagName.toLowerCase();
    if (editable.isContentEditable || (editable.getAttribute("role") === "textbox" && !["input", "textarea"].includes(tag))) {
      editable.textContent = text;
      dispatchFullEvents(editable, text);
      await scanner.sleep(30);
      return scanner.normalizeText(editable.textContent) === scanner.normalizeText(text);
    }
    if (["textarea", "input"].includes(tag)) {
      setNativeValue(editable, text);
      dispatchFullEvents(editable, text);
      await scanner.sleep(40);
      return scanner.normalizeText(editable.value) === scanner.normalizeText(text);
    }
    return false;
  }

  async function selectOption(element, value) {
    await clickElement(element);
    const expected = scanner.normalizeText(value);
    if (element.tagName.toLowerCase() === "select") {
      const option = Array.from(element.options).find((item) => optionMatches(item.value, item.textContent, expected));
      if (!option) return false;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      if (descriptor?.set) descriptor.set.call(element, option.value);
      else element.value = option.value;
      dispatchFullEvents(element, option.value);
      return element.value === option.value;
    }
    await scanner.sleep(WAIT_MS);
    const option = findOpenOption(value);
    if (option) {
      await clickElement(option);
      return true;
    }
    return inputText(element, value);
  }

  async function selectDate(element, value) {
    const normalized = normalizeDate(value);
    const editable = findEditable(element) || element;
    if (editable.tagName.toLowerCase() === "input") {
      await clickElement(editable);
      setNativeValue(editable, normalized);
      dispatchFullEvents(editable, normalized);
      return scanner.normalizeText(editable.value) === scanner.normalizeText(normalized);
    }
    return inputText(editable, normalized);
  }

  async function setChecked(element, value) {
    const desired = parseBoolean(value);
    if (desired === null) return false;
    const control = findCheckable(element) || element;
    if (scanner.getCheckedState(control) === desired) return true;
    await clickElement(scanner.getClickableProxy(control) || control);
    await scanner.sleep(50);
    if (scanner.getCheckedState(control) === desired) return true;
    if (control instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
      if (descriptor?.set) descriptor.set.call(control, desired);
      else control.checked = desired;
    } else {
      control.setAttribute("aria-checked", String(desired));
    }
    dispatchFullEvents(control, String(desired));
    return scanner.getCheckedState(control) === desired;
  }

  async function selectRadio(element, value) {
    const expected = scanner.normalizeText(value);
    const option = scanner.getRadioGroup(element).find((item) => {
      const valueText = scanner.normalizeText(item.value);
      const labelText = scanner.normalizeText([scanner.getLabelText(item), item.getAttribute("aria-label")].filter(Boolean).join(" "));
      return optionTextMatches(valueText, labelText, expected);
    });
    if (!option) return false;
    const control = findCheckable(option) || option;
    if (scanner.getCheckedState(control)) return true;
    await clickElement(scanner.getClickableProxy(control) || control);
    await scanner.sleep(50);
    return scanner.getCheckedState(control);
  }

  async function clickElement(element) {
    if (!element) return false;
    try {
      element.scrollIntoView?.({ block: "center", inline: "nearest" });
      element.focus?.();
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
      element.click?.();
      await scanner.sleep(40);
      return true;
    } catch (error) {
      console.warn("ApplyPilot click failed", error);
      return false;
    }
  }

  function findEditable(element) {
    if (element?.matches?.("input, textarea, [contenteditable='true']")) return element;
    return element?.querySelector?.("input:not([type='hidden']), textarea, [contenteditable='true']") || null;
  }

  function findCheckable(element) {
    if (element?.matches?.("input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='radio']")) return element;
    return element?.querySelector?.("input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='radio']") || null;
  }

  function findOpenOption(value) {
    const expected = scanner.normalizeText(value);
    return scanner.deepQueryAll([
      "[role='option']", ".ant-select-item-option", ".el-select-dropdown__item",
      ".arco-select-option", ".semi-select-option", ".t-select-option",
      ".select2-results__option", "[class*='select-option']", "[class*='dropdown-item']",
      "[class*='menu-item']", "[class*='option-item']", "li"
    ].join(",")).filter(isVisible).find((option) => optionMatches(option.getAttribute("data-value"), option.innerText || option.textContent, expected));
  }

  function setNativeValue(element, value) {
    const prototype = element.tagName.toLowerCase() === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function dispatchFullEvents(element, value) {
    element.dispatchEvent(new FocusEvent("focus", { bubbles: true, composed: true }));
    try {
      element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true, inputType: "insertText", data: String(value ?? "") }));
      element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: String(value ?? "") }));
    } catch (error) {
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true, composed: true }));
  }

  function optionMatches(value, text, expected) {
    return optionTextMatches(scanner.normalizeText(value), scanner.normalizeText(text), expected);
  }

  function optionTextMatches(valueText, labelText, expected) {
    if (!expected) return false;
    if (valueText === expected || labelText === expected) return true;
    const desiredBoolean = parseBoolean(expected);
    if (desiredBoolean !== null) {
      const valueBoolean = parseBoolean(valueText);
      const labelBoolean = parseBoolean(labelText);
      if (valueBoolean !== null) return valueBoolean === desiredBoolean;
      if (labelBoolean !== null) return labelBoolean === desiredBoolean;
      return false;
    }
    if (expected.length <= 3) {
      const tokens = `${valueText} ${labelText}`.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
      return tokens.includes(expected);
    }
    return labelText.includes(expected) || expected.includes(labelText) || valueText.includes(expected);
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = scanner.normalizeText(value);
    if (/^(true|yes|y|1|是|有|同意|接受|需要|愿意|至今|present|current)$/.test(normalized)) return true;
    if (/^(false|no|n|0|否|无|不同意|不接受|不需要|不愿意)$/.test(normalized)) return false;
    return null;
  }

  function normalizeDate(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/(19|20)\d{2}[-/.年]\d{1,2}([-/.月]\d{1,2})?/);
    return match ? match[0].replace(/[年月/.]/g, "-").replace(/日/g, "").replace(/-+$/, "") : text;
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  window.ApplyPilotFormActions = { execute, inputText, selectOption, selectDate, setChecked, selectRadio, clickElement };
})();
