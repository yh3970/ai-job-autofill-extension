(function () {
  if (window.ApplyPilotFormActions) return;

  const scanner = window.ApplyPilotFormScanner;
  const WAIT_MS = 220;

  async function execute(action, element) {
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
    const tag = element.tagName.toLowerCase();
    if (element.isContentEditable || (element.getAttribute("role") === "textbox" && !["input", "textarea"].includes(tag))) {
      element.textContent = text;
      dispatchFullEvents(element, text);
      await scanner.sleep(30);
      return scanner.normalizeText(element.textContent) === scanner.normalizeText(text);
    }
    if (["textarea", "input"].includes(tag)) {
      setNativeValue(element, text);
      dispatchFullEvents(element, text);
      await scanner.sleep(30);
      return scanner.normalizeText(element.value) === scanner.normalizeText(text);
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
    if (element.tagName.toLowerCase() === "input") {
      await clickElement(element);
      setNativeValue(element, normalized);
      dispatchFullEvents(element, normalized);
      return scanner.normalizeText(element.value) === scanner.normalizeText(normalized);
    }
    return inputText(element, normalized);
  }

  async function setChecked(element, value) {
    const desired = parseBoolean(value);
    if (desired === null) return false;
    if (scanner.getCheckedState(element) === desired) return true;
    await clickElement(scanner.getClickableProxy(element) || element);
    await scanner.sleep(40);
    if (scanner.getCheckedState(element) === desired) return true;
    if (element instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
      if (descriptor?.set) descriptor.set.call(element, desired);
      else element.checked = desired;
    } else {
      element.setAttribute("aria-checked", String(desired));
    }
    dispatchFullEvents(element, String(desired));
    return scanner.getCheckedState(element) === desired;
  }

  async function selectRadio(element, value) {
    const expected = scanner.normalizeText(value);
    const option = scanner.getRadioGroup(element).find((item) => {
      const valueText = scanner.normalizeText(item.value);
      const labelText = scanner.normalizeText([scanner.getLabelText(item), item.getAttribute("aria-label")].filter(Boolean).join(" "));
      return optionTextMatches(valueText, labelText, expected);
    });
    if (!option) return false;
    if (scanner.getCheckedState(option)) return true;
    await clickElement(scanner.getClickableProxy(option) || option);
    await scanner.sleep(40);
    return scanner.getCheckedState(option);
  }

  async function clickElement(element) {
    if (!element) return false;
    try {
      element.scrollIntoView?.({ block: "center", inline: "nearest" });
      element.focus?.();
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      element.click?.();
      await scanner.sleep(40);
      return true;
    } catch (error) {
      console.warn("ApplyPilot click failed", error);
      return false;
    }
  }

  function findOpenOption(value) {
    const expected = scanner.normalizeText(value);
    return scanner.deepQueryAll([
      "[role='option']", ".ant-select-item-option", ".el-select-dropdown__item",
      ".select2-results__option", "[class*='option']", "li"
    ].join(",")).filter(isVisible).find((option) => optionMatches(option.getAttribute("data-value"), option.innerText || option.textContent, expected));
  }

  function setNativeValue(element, value) {
    const prototype = element.tagName.toLowerCase() === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function dispatchFullEvents(element, value) {
    element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    try {
      element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: String(value ?? "") }));
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value ?? "") }));
    } catch (error) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
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
    if (/^(true|yes|y|1|是|同意|接受|需要|愿意)$/.test(normalized)) return true;
    if (/^(false|no|n|0|否|不同意|不接受|不需要|不愿意)$/.test(normalized)) return false;
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
