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

assert.equal(manifest.manifest_version, 3, "Manifest V3 is required");
assert.equal(manifest.version, "0.6.0", "Universal learning release must be version 0.6.0");
assert.equal(isolatedEntry?.all_frames, true, "Isolated content scripts must run in all frames");
assert.equal(isolatedEntry?.match_about_blank, true, "about:blank/srcdoc frames must be covered");
assert.ok(manifest.permissions.includes("webNavigation"), "webNavigation is needed to enumerate frames");

for (const requiredScript of [
  "aiSemanticMatcher.js",
  "formScanner.js",
  "formActions.js",
  "formAutofillAgent.js",
  "siteAdapters.js",
  "universalAdapter.js",
  "learningMonitor.js",
  "contentScriptV2.js"
]) {
  assert.ok(scripts.includes(requiredScript), `${requiredScript} must be loaded by the isolated content script`);
  await read(requiredScript);
}

assert.ok(scripts.indexOf("siteAdapters.js") > scripts.indexOf("formAutofillAgent.js"), "Site adapters must wrap the base agent after it loads");
assert.ok(scripts.indexOf("universalAdapter.js") > scripts.indexOf("siteAdapters.js"), "Universal fallback must wrap site adapters");
assert.ok(scripts.indexOf("learningMonitor.js") > scripts.indexOf("universalAdapter.js"), "Learning monitor must wrap the final agent and action stack");
assert.ok(scripts.indexOf("learningMonitor.js") < scripts.indexOf("contentScriptV2.js"), "Learning monitor must load before the message listener");
assert.ok(!scripts.includes("contentScript.js"), "The legacy listener must not be loaded beside contentScriptV2");
assert.ok(mainEntry, "A minimal MAIN-world bridge is required for framework-controlled forms");
assert.equal(mainEntry.all_frames, true, "The MAIN-world bridge must run in all frames");
assert.ok(mainEntry.js?.includes("mainWorldBridge.js"), "mainWorldBridge.js must be loaded in the MAIN world");

const scanner = await read("formScanner.js");
assert.match(scanner, /getTableLabelText/, "Scanner must recognize table-cell labels used by older ATS pages");
assert.match(scanner, /getAdjacentLabelText/, "Scanner must recognize adjacent labels");
assert.match(scanner, /element\.shadowRoot/, "Scanner must recurse into open Shadow DOM roots");
assert.match(scanner, /waitForStableFields/, "Scanner must wait for dynamically rendered fields");
assert.doesNotMatch(scanner, /container\s*\?\s*\([^\n]*container\.textContent/, "Field context must not fall back to the entire form text");

const semantic = await read("aiSemanticMatcher.js");
assert.match(semantic, /canonicalLabel/, "Memory entries must retain a canonical cross-site label");
assert.match(semantic, /personal\.birthDate/, "Common Chinese application fields must be represented in the ontology");

const agent = await read("formAutofillAgent.js");
assert.match(agent, /field\.fieldTextNormalized/, "Sensitive-field detection must use field-owned text");
assert.match(agent, /adaptArrayValue/, "Year and month controls must receive split date values");
assert.doesNotMatch(agent, /\.submit\s*\(/, "Autofill must never submit a form");
assert.doesNotMatch(agent, /requestSubmit\s*\(/, "Autofill must never request form submission");

const adapters = await read("siteAdapters.js");
assert.match(adapters, /apply\.careers\.dji\.com/, "The DJI adapter must remain host-scoped");
assert.doesNotMatch(adapters, /\.submit\s*\(/, "Site adapters must never submit forms");

const universal = await read("universalAdapter.js");
assert.match(universal, /runUniversalAdapter/, "A cross-site deterministic fallback is required");
assert.match(universal, /groupFields/, "Repeated education and experience blocks must be grouped generically");
assert.doesNotMatch(universal, /\.submit\s*\(/, "Universal adapter must never submit a form");

const monitor = await read("learningMonitor.js");
assert.match(monitor, /corrected-autofill/, "Monitor must learn corrected autofill values");
assert.match(monitor, /recovered-after-failure/, "Monitor must learn values entered after a failed fill");
assert.match(monitor, /event\.isTrusted/, "Monitor must distinguish real user edits from synthetic extension events");
assert.doesNotMatch(monitor, /apiKey/i, "Learning monitor must not access API keys");

const actions = await read("formActions.js");
for (const handler of ["inputText", "selectOption", "selectDate", "setChecked", "selectRadio"]) {
  assert.match(actions, new RegExp(`function\\s+${handler}\\b`), `${handler} action handler is required`);
}
assert.match(actions, /executeInMainWorld/, "Actions must support a MAIN-world execution path");

const bridge = await read("mainWorldBridge.js");
assert.match(bridge, /main-world-custom-option-not-found/, "The bridge must report custom dropdown failures explicitly");
assert.match(bridge, /main-world-keyboard-select/, "The bridge must fall back to keyboard selection for searchable dropdowns");
assert.doesNotMatch(bridge, /chrome\./, "The MAIN-world bridge must not expose extension APIs or secrets");
assert.doesNotMatch(bridge, /\.submit\s*\(/, "The MAIN-world bridge must never submit a form");
assert.doesNotMatch(bridge, /requestSubmit\s*\(/, "The MAIN-world bridge must never request form submission");

const background = await read("background.js");
assert.match(background, /APPLYPILOT_MEMORY_UPSERT/, "Background must merge automatic memory updates atomically");
assert.match(background, /webNavigation\.getAllFrames/, "Background must enumerate all frames");
assert.match(background, /frameId/, "Frame-specific messaging is required");

const optionsHtml = await read("options.html");
assert.match(optionsHtml, /autoLearnCorrections/, "Options must expose automatic correction learning");
assert.match(optionsHtml, /learnSensitiveFields/, "Sensitive learning must require a separate opt-in");
await read("optionsEnhancements.js");

console.log("ApplyPilot universal learning validation passed.");
