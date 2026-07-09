### Concise Implementation Plan (Chrome/Edge Extension Only, 100% Local Parsing)
**Guardrails**: No changes to forbidden non-extension files; run `node --check` on all modified JS files; zero external data uploads at any point in the parsing/import flow.
---
#### File-Specific Changes
1.  **resumeParser.js (core parsing fixes)**
    - Add post-PDF-extraction text length check, return a dedicated "scanned/image PDF unsupported" warning flag if usable extracted text falls below a minimum threshold.
    - Implement priority-ordered Chinese section detection for 教育背景/实习经历/工作经历/项目经历/技能/证书 (with common variant matching); run section detection *before* name parsing to block section headings from being misidentified as candidate names.
    - Tighten Chinese mobile number matching rules with context checks to eliminate false positives from ID numbers, list numbering, and postal codes.
    - Add hard section boundary logic to reliably separate work experience and project experience entries.
    - Extend project entry parsing to extract start/end date values, reusing existing work experience date parsing logic.
    - Confirm no network/fetch calls are added to parsing workflows.

2.  **options.html (preview UI)**
    - Add a hidden, dismissible import preview container that displays all parsed profile fields, includes dedicated start/end inputs for project entries, and has explicit Confirm/Cancel action buttons.
    - Add an inline alert element for the scanned PDF unsupported warning.
    - Update import helper text to clearly note parsing runs fully locally and requires user confirmation before data is saved to the profile.

3.  **options.js (flow logic updates)**
    - Remove existing logic that writes parsed resume data directly to Profile storage immediately after parsing.
    - After receiving parser results: surface the scanned PDF warning if flagged, otherwise populate the preview UI with all parsed data (including project start/end values) for user review and inline editing.
    - Add preview event handlers: save reviewed/edited data to Profile storage only when the user clicks Confirm; discard parsed data and close the preview with no saves when the user clicks Cancel.
    - Update existing project form and storage logic to support persisting start/end date fields for both imported and manually created projects.

4.  **styles.css (minimal changes only if required)**
    - Add lightweight, UI-consistent styles for the preview container, warning alert, and project date input layout to match existing extension design, with no unnecessary style overhauls.
---
#### Post-Implementation Validation
- Confirm no external network requests trigger during import/parsing
- Verify section headings are never detected as names, phone false positives are reduced, and work/project entries are correctly separated
- Confirm project start/end dates parse and save properly
- Verify scanned/image PDFs show the clear unsupported warning
- Confirm the preview loads before any save, and data only persists after explicit user confirmation