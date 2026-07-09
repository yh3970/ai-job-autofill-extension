# AI-powered smart autofill and memory matching

## 1. Core files changed

- `manifest.json`: loads the local semantic matcher before the content script and bumps the extension version to `0.5.0`.
- `aiResumeParser.js`: adds optional user-configured AI resume parsing for Profile generation.
- `contentScript.js`: adds confidence-gated autofill decisions, suggestions, debug output, sensitive-field protection, and confirmed memory saving.
- `options.html` / `options.js` / `styles.css`: add AI resume settings, memory review UI, and the explicit sensitive-field autofill preference.
- `README.md`: clarifies that the current implementation is local semantic matching, not OpenAI API integration.
- `test-agent-application.html`: adds review-requested test fields, including sensitive EEO fields.

## 2. New modules

- `aiResumeParser.js`: optional AI resume parser.
  - Reads API settings from local browser storage.
  - Supports Responses API and Chat Completions API.
  - Sends extracted resume text to the user-configured API only after confirmation.
  - Normalizes returned JSON into the Profile schema.
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

Current state:

- Resume-to-Profile parsing can optionally call a user-configured AI API.
- Page autofill field matching is still local semantic matching and does not call OpenAI API yet.

The matcher is a local deterministic semantic matcher. It vectorizes field labels, nearby text, and section context, then compares them against:

- Confirmed user memory.
- Bilingual semantic concepts.
- Rule fallback where needed.

Next stage: replace or augment the local page-field matcher with OpenAI API semantic classification and add OCR for scanned PDFs.

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

- Page-field semantic matching is not OpenAI API integration yet.
- Scanned image PDFs still need OCR before AI resume parsing can work reliably.
- Some complex custom date pickers may need site-specific adapters.
- Cross-origin ATS iframes may require extra extension frame handling.
