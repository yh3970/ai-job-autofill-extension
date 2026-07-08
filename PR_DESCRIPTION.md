# AI-powered smart autofill and memory matching

## 1. Core files changed

- `manifest.json`: loads the local semantic matcher before the content script and bumps the extension version to `0.4.1`.
- `contentScript.js`: adds confidence-gated autofill decisions, suggestions, debug output, sensitive-field protection, and confirmed memory saving.
- `options.html` / `options.js` / `styles.css`: add memory review UI and the explicit sensitive-field autofill preference.
- `README.md`: clarifies that the current implementation is local semantic matching, not OpenAI API integration.
- `test-agent-application.html`: adds review-requested test fields, including sensitive EEO fields.

## 2. New modules

- `aiSemanticMatcher.js`: local semantic matcher.
  - Defines bilingual profile and array-field concepts.
  - Tokenizes English words/numbers with `/[a-z0-9]+/g`.
  - Keeps CJK single-character tokens and CJK bigrams.
  - Scores memory and concept matches with cosine similarity.
  - Returns `score` and `confidence` for all semantic/memory candidates.

## 3. Field recognition logic

The content script builds a page model before planning actions. It classifies fields into:

- Basic profile fields.
- Education array rows.
- Internship/work array rows.
- Long-text questions.

The planner compares row counts against Profile data, adds missing rows first, waits for DOM rendering, then replans filling against the updated page.

## 4. Matching logic

Current state: this PR does **not** integrate the OpenAI API yet.

The matcher is a local deterministic semantic matcher. It vectorizes field labels, nearby text, and section context, then compares them against:

- Confirmed user memory.
- Bilingual semantic concepts.
- Rule fallback where needed.

Next stage: replace or augment the local matcher with OpenAI API semantic classification and optional OCR for scanned PDFs.

## 5. Memory behavior

Memory is no longer saved silently.

- After the user manually fills fields and clicks the learn action, ApplyPilot asks for confirmation before saving each question/answer.
- Saved memory includes label/context, answer or profile path, section, semantic vector, timestamp, and disabled state.
- The Profile settings page now includes memory review UI with list, edit, delete, and disable support.

## 6. Autofill policy

Automatically filled:

- Candidates with `score >= 0.85`.
- Normal profile fields such as name, email, phone, work authorization, visa sponsorship, education rows, and employer/company rows when confidence is high.

Needs user confirmation:

- Candidates with `0.55 <= score < 0.85`.
- These are added to the suggestion UI and are not written until the user clicks Apply.

Skipped by default:

- Candidates with `score < 0.55`.
- Sensitive fields unless explicitly enabled in Profile settings:
  - gender
  - race / ethnicity
  - disability
  - veteran status
  - religion
  - political affiliation
  - equal opportunity / EEO questions
  - health-related questions
  - criminal history

ApplyPilot never auto-submits forms.

## 7. Debugging and testing

Debug output:

- `console.table` prints one row per planned field with selector, label, nearby text, matched path, value preview, score, source, action, and reason.
- The popup reports filled, suggested, skipped, and debug row counts.

Test page coverage:

- First name / Given name
- Surname / Last name
- Email
- Mobile phone
- Legal work authorization
- Visa sponsorship
- Expected graduation date
- University / Institution
- Employer / Company
- Gender / Race / Disability / Veteran status, which should not autofill by default

Validation run:

- `node --check aiSemanticMatcher.js`
- `node --check contentScript.js`
- `node --check options.js`
- `node --check popup.js`

## 8. Known unfinished issues

- This is not OpenAI API integration yet.
- Scanned image PDFs still need OCR.
- Some complex custom date pickers may need site-specific adapters.
- Cross-origin ATS iframes may require extra extension frame handling.
