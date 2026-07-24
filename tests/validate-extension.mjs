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
assert.equal(manifest.version, "0.6.4");
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
assert.ok(scripts.indexOf("learningMonitor.js") < scripts.indexOf("contentScriptV2.js"));

console.log("validate: universal scanner");
const scanner = await read("formScanner.js");
const legacySections = await read("legacySectionAdapter.js");
assert.ok(scanner.includes("getTableLabelText"));
assert.ok(scanner.includes("getAdjacentLabelText"));
assert.ok(scanner.includes("getDisplayFieldValue"));
assert.ok(scanner.includes("shadowRoot"));
assert.ok(legacySections.includes("input[readonly]"));
assert.ok(legacySections.includes("工作经历"));
assert.ok(legacySections.includes("START_PATTERN"));

console.log("validate: strict matching, repeatable rows and learning");
const semantic = await read("aiSemanticMatcher.js");
const universal = await read("universalAdapter.js");
const repeated = await read("repeatedProfileAdapter.js");
const repeatableManager = await read("repeatableSectionManager.js");
const phoneAdapter = await read("phoneValueAdapter.js");
const safetyGuard = await read("fieldSafetyGuard.js");
const monitor = await read("learningMonitor.js");
assert.ok(semantic.includes("const MEMORY_THRESHOLD = 0.85"));
assert.ok(semantic.includes("const ONTOLOGY_THRESHOLD = 0.65"));
assert.ok(semantic.includes("semantic-exact"));
assert.match(semantic, /function buildFieldText\(field\)\s*\{\s*return normalize\(field\?\.fieldTextNormalized \|\| field\?\.text \|\| ""\);/s);
assert.ok(!semantic.match(/function buildFieldText[\s\S]{0,180}sectionText/));
assert.ok(universal.includes("runUniversalAdapter"));
assert.ok(universal.includes("groupFields"));
assert.ok(repeated.includes("AMBIGUOUS_EDUCATION_LABELS"));
assert.ok(repeated.includes("领域方向"));
assert.ok(repeated.includes("导师"));
assert.ok(repeated.includes("ownFieldLabel"));
assert.ok(!repeated.match(/function ownFieldLabel[\s\S]{0,300}sectionText/));
assert.ok(repeatableManager.includes("ensureRepeatableRows"));
assert.ok(repeatableManager.includes("增加更多"));
assert.ok(repeatableManager.includes("projectRowsAdded"));
assert.ok(phoneAdapter.includes("deriveAreaValue"));
assert.ok(phoneAdapter.includes("deriveLocalNumber"));
assert.ok(safetyGuard.includes("profile-path-field-mismatch"));
assert.ok(safetyGuard.includes("field-safety-guard"));
assert.ok(safetyGuard.includes("教育"));
assert.ok(monitor.includes("corrected-autofill"));
assert.ok(monitor.includes("recovered-after-failure"));
assert.ok(monitor.includes("event.isTrusted"));

console.log("validate: safety");
for (const file of [
  "formAutofillAgent.js",
  "siteAdapters.js",
  "universalAdapter.js",
  "repeatedProfileAdapter.js",
  "repeatableSectionManager.js",
  "phoneValueAdapter.js",
  "fieldSafetyGuard.js",
  "learningMonitor.js",
  "mainWorldBridge.js"
]) {
  const source = await read(file);
  assert.ok(!source.includes("requestSubmit("), `${file} must not request submission`);
  assert.ok(!source.includes(".submit("), `${file} must not submit forms`);
}
const bridge = await read("mainWorldBridge.js");
assert.ok(!bridge.includes("chrome."));

console.log("validate: persistence and options");
const background = await read("background.js");
const optionsHtml = await read("options.html");
assert.ok(background.includes("APPLYPILOT_MEMORY_UPSERT"));
assert.ok(background.includes("webNavigation.getAllFrames"));
assert.ok(optionsHtml.includes("autoLearnCorrections"));
assert.ok(optionsHtml.includes("learnSensitiveFields"));
await read("optionsEnhancements.js");

console.log("ApplyPilot strict field identity validation passed.");
