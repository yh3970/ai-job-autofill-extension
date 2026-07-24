import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");

const manifest = JSON.parse(await read("manifest.json"));
const scripts = manifest.content_scripts?.[0]?.js || [];

assert.equal(manifest.manifest_version, 3, "Manifest V3 is required");
assert.equal(manifest.content_scripts?.[0]?.all_frames, true, "Content scripts must run in all frames");
assert.equal(manifest.content_scripts?.[0]?.match_about_blank, true, "about:blank/srcdoc frames must be covered");
assert.ok(manifest.permissions.includes("webNavigation"), "webNavigation is needed to enumerate frames");

for (const requiredScript of [
  "aiSemanticMatcher.js",
  "formScanner.js",
  "formActions.js",
  "formAutofillAgent.js",
  "contentScriptV2.js"
]) {
  assert.ok(scripts.includes(requiredScript), `${requiredScript} must be loaded by the content script`);
  await read(requiredScript);
}

assert.ok(!scripts.includes("contentScript.js"), "The legacy listener must not be loaded beside contentScriptV2");

const scanner = await read("formScanner.js");
assert.match(scanner, /element\.shadowRoot/, "Scanner must recurse into open Shadow DOM roots");
assert.match(scanner, /waitForStableFields/, "Scanner must wait for dynamically rendered fields");
assert.doesNotMatch(
  scanner,
  /container\s*\?\s*\([^\n]*container\.textContent/,
  "Field context must not fall back to the entire form text"
);

const agent = await read("formAutofillAgent.js");
assert.match(agent, /field\.fieldTextNormalized/, "Sensitive-field detection must use field-owned text");
assert.doesNotMatch(agent, /\.submit\s*\(/, "Autofill must never submit a form");
assert.doesNotMatch(agent, /requestSubmit\s*\(/, "Autofill must never request form submission");

const actions = await read("formActions.js");
for (const handler of ["inputText", "selectOption", "selectDate", "setChecked", "selectRadio"]) {
  assert.match(actions, new RegExp(`function\\s+${handler}\\b`), `${handler} action handler is required`);
}

const background = await read("background.js");
assert.match(background, /webNavigation\.getAllFrames/, "Background must enumerate all frames");
assert.match(background, /frameId/, "Frame-specific messaging is required");

console.log("ApplyPilot static extension validation passed.");
