(function () {
  if (window.__APPLYPILOT_VISUAL_PAGE_MAPPER__) return;
  window.__APPLYPILOT_VISUAL_PAGE_MAPPER__ = true;

  const scanner = window.ApplyPilotFormScanner;
  const actionsApi = window.ApplyPilotFormActions;
  if (!scanner || !actionsApi) return;

  const VISUAL_ID_ATTR = "data-applypilot-visual-id";
  const BADGE_CLASS = "applypilot-visual-badge";
  let state = emptyState();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "APPLYPILOT_VISUAL_PREPARE") {
      prepareVisualScan(message.profile || {}).then(sendResponse).catch((error) => respondError(error, sendResponse));
      return true;
    }
    if (message?.type === "APPLYPILOT_VISUAL_SCROLL") {
      scrollVisualPage(message.scrollY).then(sendResponse).catch((error) => respondError(error, sendResponse));
      return true;
    }
    if (message?.type === "APPLYPILOT_VISUAL_APPLY") {
      applyVisualMappings(message.profile || {}, message.mappings || []).then(sendResponse).catch((error) => respondError(error, sendResponse));
      return true;
    }
    if (message?.type === "APPLYPILOT_VISUAL_CLEANUP") {
      cleanupVisualScan(message.originalScrollY).then(sendResponse).catch((error) => respondError(error, sendResponse));
      return true;
    }
    return false;
  });

  async function prepareVisualScan(profile) {
    await cleanupVisualScan(window.scrollY, false);
    await scanner.waitForStableFields(1800);

    const model = scanner.understandPage();
    const sectionMetadata = buildSectionMetadata(model);
    const rawFields = scanner.getInteractiveFields();
    const labelOccurrences = new Map();
    const descriptors = [];
    const elements = new Map();

    rawFields.forEach((element, index) => {
      if (!isVisible(element)) return;
      const field = scanner.describeField(element, index);
      const label = ownFieldLabel(field);
      const canonicalLabel = canonicalize(label);
      const occurrenceKey = `${canonicalLabel}|${field.control}`;
      const labelOccurrence = labelOccurrences.get(occurrenceKey) || 0;
      labelOccurrences.set(occurrenceKey, labelOccurrence + 1);

      const id = `AP${descriptors.length + 1}`;
      element.setAttribute(VISUAL_ID_ATTR, id);
      const rect = element.getBoundingClientRect();
      const metadata = sectionMetadata.get(element) || {};
      const descriptor = {
        id,
        pageX: Math.round(rect.left + window.scrollX),
        pageY: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        control: field.control,
        kind: field.kind,
        sectionHint: metadata.section || field.section || "basic",
        rowHint: Number.isInteger(metadata.rowIndex) ? metadata.rowIndex : -1,
        domTextHint: label.slice(0, 100),
        canonicalLabel,
        labelOccurrence
      };
      descriptors.push(descriptor);
      elements.set(id, element);
      addBadge(element, id);
    });

    state = {
      prepared: true,
      originalScrollY: window.scrollY,
      fields: descriptors,
      elements
    };

    return {
      ok: true,
      fieldCount: descriptors.length,
      pageHeight: getPageHeight(),
      viewportHeight: window.innerHeight,
      originalScrollY: state.originalScrollY,
      fields: descriptors,
      profileCatalog: buildProfileCatalog(profile)
    };
  }

  async function scrollVisualPage(scrollY) {
    const target = Math.max(0, Math.min(Number(scrollY || 0), Math.max(0, getPageHeight() - window.innerHeight)));
    window.scrollTo({ top: target, left: 0, behavior: "instant" });
    await scanner.sleep(180);
    return { ok: true, scrollY: window.scrollY };
  }

  async function applyVisualMappings(profile, mappings) {
    if (!state.prepared) return { ok: false, error: "visual-scan-not-prepared" };

    const allowedPaths = new Set(buildProfileCatalog(profile));
    const ordered = (Array.isArray(mappings) ? mappings : [])
      .filter((mapping) => allowedPaths.has(mapping.profilePath) && Number(mapping.confidence || 0) >= 0.9)
      .sort((left, right) => descriptorFor(left.id)?.pageY - descriptorFor(right.id)?.pageY);

    let filled = 0;
    let failed = 0;
    let skipped = 0;
    const uncertain = [];

    for (const mapping of ordered) {
      const descriptor = descriptorFor(mapping.id);
      const value = getProfileValue(profile, mapping.profilePath);
      if (!descriptor || !hasValue(value)) {
        skipped += 1;
        continue;
      }

      const element = resolveLiveElement(descriptor);
      if (!element) {
        failed += 1;
        uncertain.push({ label: descriptor.domTextHint || mapping.id, reason: "visual-target-not-found", source: mapping.profilePath });
        continue;
      }

      const current = scanner.normalizeText(scanner.getDisplayFieldValue(element));
      if (current && !isPlaceholderValue(current)) {
        if (valueMatches(current, value)) filled += 1;
        else {
          skipped += 1;
          uncertain.push({ label: descriptor.domTextHint || mapping.id, reason: "existing-value-preserved", source: mapping.profilePath });
        }
        continue;
      }

      const liveField = scanner.describeField(element, 0);
      const action = {
        type: actionTypeFor(liveField),
        fieldId: liveField.id,
        value,
        source: mapping.profilePath,
        debug: {
          label: ownFieldLabel(liveField),
          matchedProfilePath: mapping.profilePath,
          source: "ephemeral-visual-ai",
          confidence: Number(mapping.confidence || 0)
        }
      };

      const result = await actionsApi.execute(action, element);
      if (result === true || result?.ok) filled += 1;
      else {
        failed += 1;
        uncertain.push({
          label: ownFieldLabel(liveField) || mapping.id,
          reason: result?.reason || "visual-action-failed",
          source: mapping.profilePath
        });
      }
      await scanner.sleep(150);
    }

    return { ok: true, filled, failed, skipped, uncertain: uncertain.slice(0, 40) };
  }

  async function cleanupVisualScan(originalScrollY = state.originalScrollY, restoreScroll = true) {
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
    scanner.deepQueryAll(`[${VISUAL_ID_ATTR}]`).forEach((element) => element.removeAttribute(VISUAL_ID_ATTR));
    if (restoreScroll) {
      window.scrollTo({ top: Math.max(0, Number(originalScrollY || 0)), left: 0, behavior: "instant" });
      await scanner.sleep(120);
    }
    state = emptyState();
    return { ok: true };
  }

  function buildSectionMetadata(model) {
    const metadata = new Map();
    for (const [sectionName, section] of Object.entries({
      education: model.sections?.education,
      experience: model.sections?.internship
    })) {
      (section?.rows || []).forEach((row, rowIndex) => {
        (row.fields || []).forEach((field) => metadata.set(field.element, { section: sectionName, rowIndex }));
      });
    }
    (model.sections?.basic || []).forEach((field) => metadata.set(field.element, { section: "basic", rowIndex: -1 }));
    (model.sections?.longText || []).forEach((field) => metadata.set(field.element, { section: "longText", rowIndex: -1 }));
    return metadata;
  }

  function buildProfileCatalog(profile) {
    const paths = [];
    const sensitiveAllowed = profile?.preferences?.allowSensitiveAutofill === true;
    const personalPaths = [
      "personal.firstName", "personal.middleName", "personal.lastName", "personal.fullName", "personal.chineseName",
      "personal.preferredName", "personal.email", "personal.phone", "personal.location", "personal.currentResidence",
      "personal.householdLocation", "personal.nativePlace", "personal.address", "personal.nationality", "personal.highestDegree",
      "personal.latestMajor", "personal.latestSchool", "personal.linkedin", "personal.github", "personal.portfolio"
    ];
    if (sensitiveAllowed) {
      personalPaths.push(
        "personal.gender", "personal.birthDate", "personal.ethnicity", "personal.maritalStatus",
        "personal.politicalStatus", "personal.idType", "personal.idNumber"
      );
    }
    personalPaths.forEach((path) => {
      if (hasValue(getProfileValue(profile, path))) paths.push(path);
    });

    ["summary", "workAuthorization", "visaSponsorship", "relocation", "desiredSalary", "noticePeriod", "availabilityDate"]
      .forEach((path) => {
        if (hasValue(getProfileValue(profile, path))) paths.push(path);
      });

    addListPaths(paths, profile.education, "education", ["school", "degree", "major", "start", "end", "description"]);
    addListPaths(paths, profile.experience, "experience", ["company", "title", "start", "end", "description"]);
    addListPaths(paths, profile.projects, "projects", ["name", "role", "start", "end", "description", "url"]);
    return paths;
  }

  function addListPaths(paths, list, prefix, keys) {
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      keys.forEach((key) => {
        if (hasValue(item?.[key])) paths.push(`${prefix}.${index}.${key}`);
      });
    });
  }

  function resolveLiveElement(descriptor) {
    const exact = scanner.deepQueryAll(`[${VISUAL_ID_ATTR}="${scanner.cssEscape(descriptor.id)}"]`)[0];
    if (exact && isVisible(exact)) return exact;

    const matches = scanner.getInteractiveFields().filter((element) => {
      const field = scanner.describeField(element, 0);
      return canonicalize(ownFieldLabel(field)) === descriptor.canonicalLabel && field.control === descriptor.control;
    });
    return matches[descriptor.labelOccurrence] || null;
  }

  function ownFieldLabel(field) {
    const element = field.element;
    return cleanLabel(
      scanner.getLabelText?.(element)
      || element.getAttribute("aria-label")
      || referencedText(element, "aria-labelledby")
      || field.fieldTextNormalized
      || field.text
      || element.getAttribute("placeholder")
      || element.getAttribute("name")
      || ""
    );
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

  function addBadge(element, id) {
    const rect = element.getBoundingClientRect();
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.textContent = id;
    badge.setAttribute("aria-hidden", "true");
    badge.style.cssText = [
      "position:absolute",
      `left:${Math.max(0, rect.left + window.scrollX - 2)}px`,
      `top:${Math.max(0, rect.top + window.scrollY - 18)}px`,
      "z-index:2147483646",
      "background:#d40000",
      "color:#fff",
      "font:700 11px/16px Arial,sans-serif",
      "padding:0 4px",
      "border:1px solid #fff",
      "border-radius:3px",
      "box-shadow:0 1px 4px rgba(0,0,0,.45)",
      "pointer-events:none",
      "white-space:nowrap"
    ].join(";");
    document.documentElement.appendChild(badge);
  }

  function actionTypeFor(field) {
    if (field.control === "checkbox") return "setChecked";
    if (field.control === "radio") return "selectRadio";
    if (["native-select", "custom-select"].includes(field.control)) return "selectOption";
    if (field.kind === "date") return "selectDate";
    return "inputText";
  }

  function getProfileValue(profile, path) {
    if (!profile || !path) return "";
    return path.split(".").reduce((value, key) => {
      if (value === null || value === undefined) return "";
      if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)];
      return typeof value === "object" ? value[key] : "";
    }, profile) ?? "";
  }

  function descriptorFor(id) {
    return state.fields.find((field) => field.id === id) || null;
  }

  function getPageHeight() {
    return Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      document.documentElement.offsetHeight,
      document.body?.offsetHeight || 0,
      window.innerHeight
    );
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function isPlaceholderValue(value) {
    return /^(请选择|--请选择--|请输入|年|月|please select|select|choose)$/.test(scanner.normalizeText(value));
  }

  function valueMatches(current, expected) {
    const left = scanner.normalizeText(current);
    const right = scanner.normalizeText(expected);
    return left === right || left.includes(right) || right.includes(left);
  }

  function hasValue(value) {
    return value !== null && value !== undefined && (typeof value === "boolean" || String(value).trim() !== "");
  }

  function canonicalize(value) {
    return scanner.normalizeText(cleanLabel(value)).replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function cleanLabel(value) {
    return String(value || "")
      .replace(/[＊*：:]+/g, " ")
      .replace(/请输入|请选择|please\s+(?:enter|select|choose)|required|必填/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function emptyState() {
    return { prepared: false, originalScrollY: 0, fields: [], elements: new Map() };
  }

  function respondError(error, sendResponse) {
    console.error("ApplyPilot visual mapper error", error);
    sendResponse({ ok: false, error: error?.message || String(error) });
  }
})();
