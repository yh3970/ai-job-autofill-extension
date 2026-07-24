(function () {
  if (window.__APPLYPILOT_MAIN_WORLD_BRIDGE__) return;
  window.__APPLYPILOT_MAIN_WORLD_BRIDGE__ = true;

  const REQUEST_EVENT = "__applypilot_main_action_v1";
  const RESULT_EVENT = "__applypilot_main_result_v1";
  const AP_ID = "data-applypilot-id";

  document.addEventListener(REQUEST_EVENT, async (event) => {
    let payload = null;
    try {
      payload = JSON.parse(String(event.detail || "{}"));
      const result = await applyAction(payload);
      emitResult(payload.requestId, result);
    } catch (error) {
      emitResult(payload?.requestId || "", { ok: false, reason: error?.message || String(error) });
    }
  });

  async function applyAction(payload) {
    const element = findByApplyPilotId(payload.fieldId || payload.targetId);
    if (!element) return { ok: false, reason: "main-world-target-not-found" };

    if (payload.type === "click") {
      clickElement(element);
      return { ok: true, method: "main-world-click" };
    }
    if (payload.type === "inputText") return setText(element, payload.value);
    if (payload.type === "selectOption") return selectOption(element, payload.value, payload.fieldLabel || "");
    if (payload.type === "selectDate") return setText(element, normalizeDate(payload.value));
    if (payload.type === "setChecked") return setChecked(element, payload.value);
    if (payload.type === "selectRadio") return selectRadio(element, payload.value);
    return { ok: false, reason: "unsupported-main-world-action" };
  }

  async function setText(element, value) {
    const text = String(value ?? "");
    const editable = findEditable(element) || element;
    clickElement(editable);

    if (editable.isContentEditable) {
      editable.textContent = text;
      dispatchValueEvents(editable, text);
      await wait(80);
      return normalize(editable.textContent) === normalize(text)
        ? { ok: true, method: "main-world-contenteditable" }
        : { ok: false, reason: "main-world-contenteditable-rejected" };
    }

    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      const previous = editable.value;
      setNativeValue(editable, text);
      resetReactValueTracker(editable, previous);
      dispatchValueEvents(editable, text);
      await wait(100);
      if (normalize(editable.value) === normalize(text)) {
        return { ok: true, method: "main-world-native-setter" };
      }

      editable.focus();
      try {
        editable.select?.();
        document.execCommand("insertText", false, text);
      } catch (error) {
        // Native setter remains the primary path.
      }
      dispatchValueEvents(editable, text);
      await wait(100);
      return normalize(editable.value) === normalize(text)
        ? { ok: true, method: "main-world-insert-text" }
        : { ok: false, reason: "main-world-text-rejected" };
    }

    return { ok: false, reason: "main-world-no-editable-control" };
  }

  async function selectOption(element, value, fieldLabel) {
    const expected = String(value ?? "").trim();
    if (!expected) return { ok: false, reason: "main-world-empty-option" };

    if (element instanceof HTMLSelectElement) {
      const option = bestOption(Array.from(element.options), expected, fieldLabel);
      if (!option) return { ok: false, reason: "main-world-native-option-not-found" };
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      if (descriptor?.set) descriptor.set.call(element, option.value);
      else element.value = option.value;
      dispatchValueEvents(element, option.value);
      await wait(80);
      return element.value === option.value
        ? { ok: true, method: "main-world-native-select", selectedText: option.textContent || "" }
        : { ok: false, reason: "main-world-native-select-rejected" };
    }

    const aliases = buildAliases(expected, fieldLabel);
    const initialState = readDisplayedSelection(element);
    const triggers = findSelectTriggers(element);

    for (const trigger of triggers) {
      clickElement(trigger);
      await wait(220);

      let option = findBestVisibleOption(expected, fieldLabel, trigger);
      if (option) {
        activateOption(option);
        await wait(180);
        if (selectionLooksApplied(element, expected, aliases, initialState, option)) {
          return { ok: true, method: "main-world-custom-select", selectedText: option.textContent || "" };
        }
      }

      const searchInput = findSearchInput(trigger, element);
      if (searchInput && !searchInput.disabled) {
        const previous = searchInput.value;
        setNativeValue(searchInput, "");
        resetReactValueTracker(searchInput, previous);
        dispatchValueEvents(searchInput, "");
        await wait(30);
        setNativeValue(searchInput, expected);
        resetReactValueTracker(searchInput, "");
        dispatchSearchEvents(searchInput, expected);
        await wait(520);

        option = findBestVisibleOption(expected, fieldLabel, trigger);
        if (option) {
          activateOption(option);
          await wait(200);
          if (selectionLooksApplied(element, expected, aliases, initialState, option)) {
            return { ok: true, method: "main-world-search-select", selectedText: option.textContent || "" };
          }
        }

        pressKey(searchInput, "ArrowDown");
        await wait(60);
        pressKey(searchInput, "Enter");
        await wait(220);
        if (selectionLooksApplied(element, expected, aliases, initialState, null)) {
          return { ok: true, method: "main-world-keyboard-select" };
        }
      }

      pressKey(trigger, "ArrowDown");
      await wait(60);
      pressKey(trigger, "Enter");
      await wait(200);
      if (selectionLooksApplied(element, expected, aliases, initialState, null)) {
        return { ok: true, method: "main-world-trigger-keyboard-select" };
      }
    }

    const globalOption = findBestVisibleOption(expected, fieldLabel, null);
    if (globalOption) {
      activateOption(globalOption);
      await wait(180);
      if (selectionLooksApplied(element, expected, aliases, initialState, globalOption)) {
        return { ok: true, method: "main-world-global-option", selectedText: globalOption.textContent || "" };
      }
    }

    return { ok: false, reason: "main-world-custom-option-not-found" };
  }

  async function setChecked(element, value) {
    const desired = parseBoolean(value);
    if (desired === null) return { ok: false, reason: "main-world-checkbox-value-unknown" };
    const control = findCheckable(element) || element;
    if (getChecked(control) === desired) return { ok: true, method: "main-world-checkbox-already-set" };

    clickElement(findClickableLabel(control) || control);
    await wait(100);
    if (getChecked(control) === desired) return { ok: true, method: "main-world-checkbox-click" };

    if (control instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
      if (descriptor?.set) descriptor.set.call(control, desired);
      else control.checked = desired;
    } else {
      control.setAttribute("aria-checked", String(desired));
    }
    dispatchValueEvents(control, String(desired));
    await wait(70);
    return getChecked(control) === desired
      ? { ok: true, method: "main-world-checkbox-setter" }
      : { ok: false, reason: "main-world-checkbox-rejected" };
  }

  async function selectRadio(element, value) {
    const expected = String(value ?? "");
    const group = getRadioGroup(element);
    const option = bestOption(group, expected);
    if (!option) return { ok: false, reason: "main-world-radio-option-not-found" };
    const control = findCheckable(option) || option;
    clickElement(findClickableLabel(control) || control);
    await wait(100);
    return getChecked(control)
      ? { ok: true, method: "main-world-radio-click" }
      : { ok: false, reason: "main-world-radio-rejected" };
  }

  function findSelectTriggers(element) {
    const candidates = [element];
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
      if (parent.matches?.("[role='combobox'], [aria-haspopup='listbox'], [class*='select'], [class*='picker'], [class*='cascader'], [class*='dropdown']")) {
        candidates.push(parent);
      }
    }

    const closest = element.closest?.("[role='combobox'], [aria-haspopup='listbox'], [class*='select'], [class*='picker'], [class*='cascader']");
    if (closest) candidates.push(closest);
    candidates.push(...Array.from((closest || element.parentElement || element).querySelectorAll?.("[class*='arrow'], [class*='suffix'], [class*='icon'], svg") || []));
    return Array.from(new Set(candidates.filter((candidate) => candidate instanceof Element && isVisible(candidate))));
  }

  function findBestVisibleOption(expected, fieldLabel, trigger) {
    const roots = getPopupRoots(trigger);
    const candidates = [];
    roots.forEach((root) => candidates.push(...optionCandidatesWithin(root)));
    if (!candidates.length) candidates.push(...getVisibleOptions());
    return bestOption(Array.from(new Set(candidates)), expected, fieldLabel);
  }

  function getPopupRoots(trigger) {
    const roots = [];
    const referencedIds = [
      trigger?.getAttribute?.("aria-controls"),
      trigger?.getAttribute?.("aria-owns"),
      trigger?.getAttribute?.("aria-describedby")
    ].filter(Boolean).flatMap((value) => String(value).split(/\s+/));

    referencedIds.forEach((id) => {
      const node = document.getElementById(id);
      if (node && isVisible(node)) roots.push(node);
    });

    roots.push(...queryAllDeep([
      "[role='listbox']", "[role='menu']", "[role='tree']",
      ".ant-select-dropdown", ".el-select-dropdown", ".arco-select-popup",
      ".semi-select-option-list", ".t-popup", ".select2-container--open",
      "[class*='select-dropdown']", "[class*='dropdown-menu']", "[class*='picker-dropdown']",
      "[class*='cascader-popup']", "[class*='popover']", "[class*='popup']"
    ].join(",")).filter(isVisible));

    return Array.from(new Set(roots));
  }

  function optionCandidatesWithin(root) {
    const candidates = Array.from(root.querySelectorAll([
      "[role='option']", "[role='menuitem']", "[role='treeitem']",
      ".ant-select-item-option", ".el-select-dropdown__item", ".arco-select-option",
      ".semi-select-option", ".t-select-option", ".select2-results__option",
      "[class*='select-option']", "[class*='dropdown-item']", "[class*='menu-item']",
      "[class*='option-item']", "li", "button", "[tabindex]"
    ].join(","))).filter((item) => isVisible(item) && isOptionLike(item));

    if (isOptionLike(root)) candidates.push(root);
    return candidates;
  }

  function getVisibleOptions() {
    return queryAllDeep([
      "[role='option']", "[role='menuitem']", "[role='treeitem']",
      ".ant-select-item-option", ".el-select-dropdown__item", ".arco-select-option",
      ".semi-select-option", ".t-select-option", ".select2-results__option",
      "[class*='select-option']", "[class*='dropdown-item']", "[class*='menu-item']",
      "[class*='option-item']"
    ].join(",")).filter((item) => isVisible(item) && isOptionLike(item));
  }

  function isOptionLike(element) {
    const text = normalize(element.textContent);
    if (!text || text.length > 100 || /^(请选择|请输入|please select)$/.test(text)) return false;
    const role = element.getAttribute?.("role") || "";
    const className = String(element.className || "");
    const style = getComputedStyle(element);
    return /option|menuitem|treeitem/i.test(role)
      || /option|dropdown|menu-item|list-item|cascader/i.test(className)
      || style.cursor === "pointer"
      || element.tagName === "LI"
      || element.tagName === "BUTTON";
  }

  function findSearchInput(trigger, original) {
    const roots = getPopupRoots(trigger);
    const candidates = [
      trigger?.matches?.("input:not([type='hidden'])") ? trigger : null,
      original?.matches?.("input:not([type='hidden'])") ? original : null,
      trigger?.querySelector?.("input:not([type='hidden'])"),
      original?.querySelector?.("input:not([type='hidden'])"),
      document.activeElement instanceof HTMLInputElement ? document.activeElement : null,
      ...roots.flatMap((root) => Array.from(root.querySelectorAll("input:not([type='hidden']), [contenteditable='true']"))),
      ...queryAllDeep([
        "input[role='combobox']", "input[aria-autocomplete]",
        ".ant-select-selection-search-input", ".el-select__input",
        "[class*='select'] input", "[class*='dropdown'] input"
      ].join(","))
    ].filter(Boolean);

    return candidates.reverse().find((candidate) => isVisible(candidate) && !candidate.disabled && !candidate.readOnly) || null;
  }

  function selectionLooksApplied(element, expected, aliases, initialState, option) {
    const currentState = readDisplayedSelection(element);
    const optionTextValue = normalize(option?.textContent || "");
    if (aliases.some((alias) => alias && currentState.includes(alias))) return true;
    if (optionTextValue && currentState.includes(optionTextValue)) return true;
    if (currentState && currentState !== initialState && !/请选择|请输入|please select/.test(currentState)) return true;

    const editable = findEditable(element);
    const valueText = normalize(editable?.value || "");
    return aliases.some((alias) => alias && (valueText === alias || valueText.includes(alias)));
  }

  function readDisplayedSelection(element) {
    const container = element.closest?.("[role='combobox'], [class*='select'], [class*='picker'], [class*='cascader'], .form-item, .ant-form-item") || element.parentElement || element;
    return normalize([
      element.value,
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-label"),
      container?.textContent
    ].filter(Boolean).join(" "));
  }

  function activateOption(option) {
    option.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }));
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "mouse" }));
    option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    option.click?.();
  }

  function findByApplyPilotId(id) {
    if (!id) return null;
    const selector = `[${AP_ID}="${cssEscape(id)}"]`;
    const roots = [document];
    const visited = new Set();
    while (roots.length) {
      const root = roots.shift();
      if (!root || visited.has(root)) continue;
      visited.add(root);
      const match = root.querySelector?.(selector);
      if (match) return match;
      root.querySelectorAll?.("*").forEach((node) => {
        if (node.shadowRoot) roots.push(node.shadowRoot);
      });
    }
    return null;
  }

  function findEditable(element) {
    if (element.matches?.("input, textarea, [contenteditable='true']")) return element;
    const descendant = element.querySelector?.("input:not([type='hidden']), textarea, [contenteditable='true']");
    if (descendant) return descendant;
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const nearby = parent.querySelector?.("input:not([type='hidden']), textarea, [contenteditable='true']");
      if (nearby) return nearby;
    }
    return null;
  }

  function findCheckable(element) {
    if (element.matches?.("input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='radio']")) return element;
    return element.querySelector?.("input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='radio']") || null;
  }

  function findClickableLabel(control) {
    if (control.id) {
      const root = control.getRootNode();
      const label = root.querySelector?.(`label[for="${cssEscape(control.id)}"]`) || document.querySelector(`label[for="${cssEscape(control.id)}"]`);
      if (label) return label;
    }
    return control.closest?.("label") || control;
  }

  function getRadioGroup(element) {
    const control = findCheckable(element) || element;
    const name = control.getAttribute?.("name");
    if (name) return queryAllDeep(`input[type='radio'][name="${cssEscape(name)}"], [role='radio'][name="${cssEscape(name)}"]`);
    const container = control.closest?.("fieldset, [role='radiogroup'], [class*='radio-group']");
    return container ? Array.from(container.querySelectorAll("input[type='radio'], [role='radio'], label")) : [control];
  }

  function getChecked(element) {
    if ("checked" in element) return Boolean(element.checked);
    return element.getAttribute?.("aria-checked") === "true";
  }

  function bestOption(options, expected, fieldLabel = "") {
    const aliases = buildAliases(expected, fieldLabel);
    let best = null;
    for (const option of options) {
      const text = optionText(option);
      const score = Math.max(...aliases.map((alias) => scoreText(text, alias)));
      if (score > 0 && (!best || score > best.score)) best = { option, score };
    }
    return best && best.score >= 0.68 ? best.option : null;
  }

  function optionText(option) {
    return normalize([
      option.value,
      option.getAttribute?.("data-value"),
      option.getAttribute?.("title"),
      option.getAttribute?.("aria-label"),
      option.textContent
    ].filter(Boolean).join(" "));
  }

  function buildAliases(value, fieldLabel = "") {
    const normalized = normalize(value);
    const aliases = new Set([normalized, compact(normalized)]);
    const booleanValue = parseBoolean(value);
    if (booleanValue === true) ["yes", "true", "是", "有", "接受", "愿意", "需要", "同意", "至今"].forEach((item) => aliases.add(item));
    if (booleanValue === false) ["no", "false", "否", "无", "不接受", "不愿意", "不需要", "不同意"].forEach((item) => aliases.add(item));

    if (/master|msc|m\.s\.|硕士/i.test(value)) ["master", "master degree", "硕士", "硕士研究生"].forEach((item) => aliases.add(item));
    if (/bachelor|bsc|b\.s\.|本科|学士/i.test(value)) ["bachelor", "bachelor degree", "本科", "学士"].forEach((item) => aliases.add(item));
    if (/phd|doctor|博士/i.test(value)) ["phd", "doctor", "doctoral", "博士", "博士研究生"].forEach((item) => aliases.add(item));
    if (/china|chinese|中国/i.test(value)) ["china", "chinese", "中国", "中国大陆", "中华人民共和国"].forEach((item) => aliases.add(item));

    const month = extractMonth(value);
    if (month && /月|month/i.test(fieldLabel)) [String(month), String(month).padStart(2, "0"), `${month}月`].forEach((item) => aliases.add(item));
    const year = extractYear(value);
    if (year && /年|year/i.test(fieldLabel)) aliases.add(String(year));
    return Array.from(aliases).filter(Boolean).map(normalize);
  }

  function scoreText(optionTextValue, expected) {
    if (!optionTextValue || !expected) return 0;
    if (optionTextValue === expected) return 1;
    const optionCompact = compact(optionTextValue);
    const expectedCompact = compact(expected);
    if (optionCompact === expectedCompact) return 0.98;
    if (optionTextValue.includes(expected) || expected.includes(optionTextValue)) return 0.9;
    if (optionCompact.includes(expectedCompact) || expectedCompact.includes(optionCompact)) return 0.86;
    const expectedTokens = tokenize(expected);
    const optionTokens = tokenize(optionTextValue);
    if (!expectedTokens.length || !optionTokens.length) return 0;
    const overlap = expectedTokens.filter((token) => optionTokens.includes(token)).length;
    return overlap / Math.max(expectedTokens.length, optionTokens.length);
  }

  function clickElement(element) {
    if (!element) return;
    element.scrollIntoView?.({ block: "center", inline: "nearest" });
    element.focus?.();
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    element.click?.();
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function resetReactValueTracker(element, previousValue) {
    try {
      const tracker = element._valueTracker;
      if (tracker?.setValue) tracker.setValue(String(previousValue ?? ""));
    } catch (error) {
      // Optional React compatibility path.
    }
  }

  function dispatchSearchEvents(element, value) {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, composed: true, data: "" }));
    dispatchValueEvents(element, value);
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, composed: true, data: String(value) }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key: String(value).slice(-1), bubbles: true, composed: true }));
  }

  function dispatchValueEvents(element, value) {
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

  function pressKey(element, key) {
    element.focus?.();
    const options = { key, code: key, bubbles: true, composed: true, cancelable: true };
    element.dispatchEvent(new KeyboardEvent("keydown", options));
    element.dispatchEvent(new KeyboardEvent("keypress", options));
    element.dispatchEvent(new KeyboardEvent("keyup", options));
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = normalize(value);
    if (/^(true|yes|y|1|是|有|同意|接受|需要|愿意|至今|present|current)$/.test(normalized)) return true;
    if (/^(false|no|n|0|否|无|不同意|不接受|不需要|不愿意)$/.test(normalized)) return false;
    return null;
  }

  function normalizeDate(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/(19|20)\d{2}[-/.年]\d{1,2}([-/.月]\d{1,2})?/);
    return match ? match[0].replace(/[年月/.]/g, "-").replace(/日/g, "").replace(/-+$/, "") : text;
  }

  function extractYear(value) {
    return String(value ?? "").match(/(?:19|20)\d{2}/)?.[0] || "";
  }

  function extractMonth(value) {
    const match = String(value ?? "").match(/(?:19|20)\d{2}\D{0,3}(1[0-2]|0?[1-9])/);
    return match ? Number(match[1]) : "";
  }

  function queryAllDeep(selector) {
    const roots = [document];
    const visited = new Set();
    const results = [];
    while (roots.length) {
      const root = roots.shift();
      if (!root || visited.has(root)) continue;
      visited.add(root);
      try {
        results.push(...Array.from(root.querySelectorAll(selector)));
        root.querySelectorAll("*").forEach((element) => {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        });
      } catch (error) {
        // Ignore inaccessible roots.
      }
    }
    return Array.from(new Set(results));
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function compact(value) {
    return normalize(value).replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  }

  function tokenize(value) {
    return normalize(value).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function emitResult(requestId, result) {
    document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
      detail: JSON.stringify({ requestId, ...result })
    }));
  }
})();
