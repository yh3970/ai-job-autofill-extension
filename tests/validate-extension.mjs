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
assert.equal(manifest.version, "0.6.0");
assert.equal(isolatedEntry?.all_frames, true);
assert.equal(isolatedEntry?.match_about_blank, true);
assert.ok(mainEntry?.js?.includes("mainWorldBridge.js"));

const requiredScripts = [
  "aiSemanticMatcher.js",
  "formScanner.js",
  "formActions.js",
  "formAutofillAgent.js",
  "siteAdapters.js",
  "universalAdapter.js",
  "learningMonitor.js",
  "contentScriptV2.js"
];
for (const script of requiredScripts) {
  assert.ok(scripts.includes(script), `${script} must be loaded`);
  await read(script);
}
assert.ok(scripts.indexOf("formAutofillAgent.js") < scripts.indexOf("siteAdapters.js"));
assert.ok(scripts.indexOf("siteAdapters.js") < scripts.indexOf("universalAdapter.js"));
assert.ok(scripts.indexOf("universalAdapter.js") < scripts.indexOf("learningMonitor.js"));
assert.ok(scripts.indexOf("learningMonitor.js") < scripts.indexOf("contentScriptV2.js"));

console.log("validate: universal scanner");
const scanner = await read("formScanner.js");
assert.ok(scanner.includes("getTableLabelText"));
assert.ok(scanner.includes("getAdjacentLabelText"));
assert.ok(scanner.includes("getDisplayFieldValue"));
assert.ok(scanner.includes("shadowRoot"));

console.log("validate: matching and learning");
const semantic = await read("aiSemanticMatcher.js");
const universal = await read("universalAdapter.js");
const monitor = await read("learningMonitor.js");
assert.ok(semantic.includes("canonicalLabel"));
assert.ok(semantic.includes("personal.birthDate"));
assert.ok(universal.includes("runUniversalAdapter"));
assert.ok(universal.includes("groupFields"));
assert.ok(monitor.includes("corrected-autofill"));
assert.ok(monitor.includes("recovered-after-failure"));
assert.ok(monitor.includes("event.isTrusted"));

console.log("validate: safety");
for (const file of [
  "formAutofillAgent.js",
  "siteAdapters.js",
  "universalAdapter.js",
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

console.log("ApplyPilot universal learning validation passed.");
