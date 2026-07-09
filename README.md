# ApplyPilot

ApplyPilot is a Chrome/Edge browser extension prototype for autofilling job application forms from a local resume profile.

## What it does

- Stores a structured profile locally in the browser.
- Imports Chinese or English resumes from DOCX, PDF, or TXT and fills the Profile automatically.
- Uses PDF.js for text-based PDF extraction, with a lightweight fallback extractor.
- Supports domestic and overseas job-application fields such as Chinese name, preferred name, nationality, work authorization, visa sponsorship, relocation, availability, languages, and certifications.
- Runs an agent-style autofill loop: page understanding, action planning, queued execution, and learning.
- Uses local semantic matching instead of direct keyword-only matching. The matcher builds bilingual field concepts, vectorizes field context, scores semantic similarity, and lets confirmed memory override generic concepts. It is not connected to the OpenAI API yet.
- Understands basic information, education arrays, internship/work arrays, and long-text question areas.
- Adds missing education or internship rows before filling when the resume has more items than the page initially shows.
- Handles dropdowns as actions: click, wait, find option, select.
- Learns from fields you manually complete and reuses those answers next time.
- Keeps data in `chrome.storage.local` by default.

## Why this is not a traditional autofill plugin

Traditional autofill plugins usually fail in three places:

- They only see isolated inputs and do not understand the whole form structure.
- They fill only the first visible education or internship row and do not click "Add" to create missing rows.
- They assign select or date values directly, which often fails in React, Vue, Ant Design, Element UI, and similar frameworks.

ApplyPilot now avoids those patterns by building a page model first, planning actions before filling, and executing all operations through a queue with native browser events.

## Agent flow

1. Page understanding: scan the whole page and classify basic info, education rows, internship/work rows, and long-text fields.
2. Planning: compare resume data with current row counts. If rows are missing, plan add-row actions first.
3. Local semantic matching: compare each field context with confirmed memory and bilingual semantic concepts, then choose the best profile source.
4. Action execution: click, wait for render, fill fields, open dropdowns, select options, and dispatch native events.
5. Learning: remember one-off fields after you manually fill them once, including a semantic vector for future similar fields.

Autofill confidence policy:

- `score >= 0.85`: fill automatically.
- `0.55 <= score < 0.85`: show a confirmation suggestion UI.
- `score < 0.55`: skip.
- Sensitive EEO, health, criminal history, political, religion, veteran, disability, race, and gender fields are skipped by default unless explicitly enabled in Profile settings.
- ApplyPilot never auto-submits forms.

### AI Autofill Architecture

The AI development workflow for building ApplyPilot uses `/aidev` comments on GitHub issues and pull requests as the entrypoint for new feature and fix requests.

The high-level AI dev loop flow follows four steps:
1.  Ingest full issue context and repository state to understand requested changes
2.  Generate a structured, scoped implementation plan defining exact file targets and minimal changes
3.  Produce focused file changes aligned strictly to the approved plan
4.  Run pre-PR validation to confirm changes work as intended and do not break existing functionality

Clear, explicit boundaries separate user approval checkpoints, AI planning logic, and direct repository modification actions to ensure all changes remain intentional, reviewable, and aligned with project goals.

## How to try it

1. Open Chrome or Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose "Load unpacked".
5. Select this project folder: `C:\Users\hyx\Documents\New project`.
6. Open ApplyPilot options and fill your Profile.
7. Visit a job application form, click ApplyPilot, then choose "智能填充当前页面".

## Updating an installed unpacked extension

If ApplyPilot has already been loaded from this folder, future code changes stay linked to the installed extension. Open `chrome://extensions` or `edge://extensions`, then click the reload button on ApplyPilot. Your saved Profile and memory remain in browser storage.

After importing a resume, the Profile page now reports how many characters were extracted and how many profile items were recognized. If the character count is `0`, the file is probably a scanned PDF or an unsupported export.

## Current limits

- File upload fields on job sites are not auto-filled because browsers intentionally restrict silent file upload.
- DOCX parsing reads normal text-based Word files. PDF parsing is best effort and works best for text PDFs, not scanned image PDFs.
- Scanned image PDFs still need OCR. The current matcher is local and deterministic; a later version can connect OpenAI API and OCR services for deeper semantic matching.
