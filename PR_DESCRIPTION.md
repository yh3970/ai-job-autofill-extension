# AI-powered smart autofill and memory matching

## 1. Core files changed

- `manifest.json`: loads the semantic matcher before the content script and bumps the extension version to `0.4.0`.
- `contentScript.js`: connects the Agent planning flow to semantic matching and semantic memory.
- `README.md`: documents the Agent flow and AI-style matching behavior.

## 2. New modules

- `aiSemanticMatcher.js`: local AI-style semantic matching module.
  - Defines bilingual profile and array-field concepts.
  - Vectorizes field context into weighted tokens.
  - Scores semantic similarity with cosine similarity.
  - Stores and reuses learned memory vectors.

## 3. How field recognition works

The content script first builds a page model instead of filling isolated inputs. It classifies the page into basic information, education arrays, internship/work arrays, and long-text fields. For repeated sections, it groups fields into rows and detects add-row buttons before planning any fill actions.

## 4. How AI matching works

The new semantic matcher compares each field's label, surrounding section text, and inferred section type against bilingual field concepts. It calculates vector similarity and returns the best profile path when confidence is high enough. Learned memory is checked first and can override generic concepts when the user has previously answered a similar field.

This is currently a local deterministic AI-style matcher. It does not call an external LLM yet, but the module boundary is ready for adding a remote LLM/OCR planner later.

## 5. How memory works

When the user manually fills a field and clicks "记住当前填写内容", ApplyPilot stores:

- The field label and section context.
- The literal answer or profile path when known.
- A compact semantic vector.
- The update timestamp.

On future pages, the matcher compares new field vectors against learned memory. Similar fields can be filled even when the wording is not identical.

## 6. How to test

1. Reload the unpacked extension from `chrome://extensions` or `edge://extensions`.
2. Open the Profile page and import a DOCX or text-based PDF resume.
3. Open `test-agent-application.html`.
4. Click the ApplyPilot popup.
5. Confirm the popup reports detected sections and row counts.
6. Run smart autofill.
7. Verify that missing education/internship rows are added before filling and that dropdowns are selected through click actions.
8. Manually fill an unmatched field, click "记住当前填写内容", refresh, and confirm a similar field is filled from memory.

Validation run:

- `node --check aiSemanticMatcher.js`
- `node --check contentScript.js`
- `manifest.json` JSON parse check

## 7. Known unfinished issues

- Scanned image PDFs still need OCR.
- The semantic matcher is local and deterministic; external LLM planning is not connected yet.
- Complex custom date pickers may need site-specific adapters.
- Some ATS platforms inside cross-origin iframes may require additional extension permissions or frame handling.
