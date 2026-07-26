import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");

const manifest = JSON.parse(await read("manifest.json"));
const contentScripts = manifest.content_scripts || [];
const isolatedEntry = contentScripts.find((entry) => entry.world === "ISOLATED") || contentScripts.find((entry) => entry.js?.includes("contentScriptV2.js"));
const mainEntry = contentScripts.find((entry) => entry.world === "MAIN");
const scripts = isolatedEntry?.js || [];

console.log("validate: manifest");
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "0.7.0");
assert.equal(manifest.background?.service_worker, "visualBackground.js");
assert.equal(isolatedEntry?.all_frames, true);
assert.equal(isolatedEntry?.match_about_blank, true);
assert.ok(mainEntry?.js?.includes("mainWorldBridge.js"));

const requiredScripts = [
  "aiSemanticMatcher.js",
  "formScanner.js",
  "legacySectionAdapter.js",
  "formActions.js",
  "formAutofillAgent.js",
  "siteAdapters.js",
  "universalAdapter.js",
  "repeatedProfileAdapter.js",
  "repeatableSectionManager.js",
  "phoneValueAdapter.js",
  "fieldSafetyGuard.js",
  "learningMonitor.js",
  "visualPageMapper.js",
  "contentScriptV2.js"
];
for (const script of requiredScripts) {
  assert.ok(scripts.includes(script), `${script} must be loaded`);
  await read(script);
}
assert.ok(scripts.indexOf("formScanner.js") < scripts.indexOf("legacySectionAdapter.js"));
assert.ok(scripts.indexOf("legacySectionAdapter.js") < scripts.indexOf("formAutofillAgent.js"));
assert.ok(scripts.indexOf("formAutofillAgent.js") < scripts.indexOf("siteAdapters.js"));
assert.ok(scripts.indexOf("siteAdapters.js") < scripts.indexOf("universalAdapter.js"));
assert.ok(scripts.indexOf("universalAdapter.js") < scripts.indexOf("repeatedProfileAdapter.js"));
assert.ok(scripts.indexOf("repeatedProfileAdapter.js") < scripts.indexOf("repeatableSectionManager.js"));
assert.ok(scripts.indexOf("repeatableSectionManager.js") < scripts.indexOf("phoneValueAdapter.js"));
assert.ok(scripts.indexOf("phoneValueAdapter.js") < scripts.indexOf("fieldSafetyGuard.js"));
assert.ok(scripts.indexOf("fieldSafetyGuard.js") < scripts.indexOf("learningMonitor.js"));
assert.ok(scripts.indexOf("learningMonitor.js") < scripts.indexOf("visualPageMapper.js"));
assert.ok(scripts.indexOf("visualPageMapper.js") < scripts.indexOf("contentScriptV2.js"));

console.log("validate: universal scanner and strict mapping");
const scanner = await read("formScanner.js");
const legacySections = await read("legacySectionAdapter.js");
const semantic = await read("aiSemanticMatcher.js");
const repeated = await read("repeatedProfileAdapter.js");
const safetyGuard = await read("fieldSafetyGuard.js");
assert.ok(scanner.includes("getTableLabelText"));
assert.ok(scanner.includes("getAdjacentLabelText"));
assert.ok(scanner.includes("getDisplayFieldValue"));
assert.ok(scanner.includes("shadowRoot"));
assert.ok(legacySections.includes("input[readonly]"));
assert.ok(semantic.includes("const MEMORY_THRESHOLD = 0.85"));
assert.ok(semantic.includes("const ONTOLOGY_THRESHOLD = 0.65"));
assert.ok(repeated.includes("resolveCurrentTarget"));
assert.ok(repeated.includes("existing-value-preserved"));
assert.ok(safetyGuard.includes("profile-path-field-mismatch"));

console.log("validate: ephemeral visual mode");
const visualBackground = await read("visualBackground.js");
const visualMapper = await read("visualPageMapper.js");
const popupHtml = await read("popup.html");
const popupJs = await read("popup.js");
assert.ok(visualBackground.startsWith('importScripts("background.js")'));
assert.ok(visualBackground.includes("captureVisibleTab"));
assert.ok(visualBackground.includes('type: "input_image"'));
assert.ok(visualBackground.includes("store: false"));
assert.ok(visualBackground.includes("screenshot = null"));
assert.ok(!visualBackground.includes("chrome.storage.local.set"));
assert.ok(visualBackground.includes("MAX_VISUAL_TILES"));
assert.ok(visualMapper.includes("APPLYPILOT_VISUAL_PREPARE"));
assert.ok(visualMapper.includes("APPLYPILOT_VISUAL_APPLY"));
assert.ok(visualMapper.includes("applypilot-visual-badge"));
assert.ok(visualMapper.includes("profile-path-field-mismatch") === false);
assert.ok(popupHtml.includes("visualFillPage"));
assert.ok(popupJs.includes("截图不保存"));
assert.ok(popupJs.includes("APPLYPILOT_VISUAL_FILL"));

console.log("validate: repeatable rows, learning and safety");
const universal = await read("universalAdapter.js");
const repeatableManager = await read("repeatableSectionManager.js");
const phoneAdapter = await read("phoneValueAdapter.js");
const monitor = await read("learningMonitor.js");
assert.ok(universal.includes("runUniversalAdapter"));
assert.ok(repeatableManager.includes("ensureRepeatableRows"));
assert.ok(repeatableManager.includes("projectRowsAdded"));
assert.ok(phoneAdapter.includes("deriveAreaValue"));
assert.ok(monitor.includes("corrected-autofill"));
assert.ok(monitor.includes("event.isTrusted"));

for (const file of [
  "formAutofillAgent.js",
  "siteAdapters.js",
  "universalAdapter.js",
  "repeatedProfileAdapter.js",
  "repeatableSectionManager.js",
  "phoneValueAdapter.js",
  "fieldSafetyGuard.js",
  "learningMonitor.js",
  "visualPageMapper.js",
  "visualBackground.js",
  "mainWorldBridge.js"
]) {
  const source = await read(file);
  assert.ok(!source.includes("requestSubmit("), `${file} must not request submission`);
  assert.ok(!source.includes(".submit("), `${file} must not submit forms`);
}

const background = await read("background.js");
const optionsHtml = await read("options.html");
assert.ok(background.includes("APPLYPILOT_MEMORY_UPSERT"));
assert.ok(background.includes("webNavigation.getAllFrames"));
assert.ok(optionsHtml.includes("aiResumeApiStyle"));
assert.ok(optionsHtml.includes("autoLearnCorrections"));

console.log("ApplyPilot ephemeral visual autofill validation passed.");
