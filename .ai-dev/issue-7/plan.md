# Concise Implementation Plan: Issue #7 (Resume Parsing Accuracy + Import Preview)
## Target Files (modify/add)
### Backend
1.  New: `app/services/resume_parser/constants.py` (Chinese section mappings, validation rules)
2.  Modify: `app/services/resume_parser/{section_detector.py, pdf_parser.py, docx_parser.py, field_extractors.py}` (core parsing logic)
3.  Modify: `app/models/profile.py`, `app/schemas/resume.py` (project date fields, preview response schema)
4.  Modify: `app/api/routes/resume_import.py` (split parse/save endpoints)
### Frontend
1.  New: `web/src/components/resume/ImportPreviewPanel.vue` (editable preview UI)
2.  Modify: `web/src/views/candidate/ResumeImport.vue` (multi-step import flow)

---
## Implementation Steps (all parsing runs locally, no external data uploads per requirement)
1.  **Parsing accuracy upgrades**
    - Build a Chinese section synonym map for the required sections (教育背景/实习经历/工作经历/项目经历/技能/证书); add all section headings to a name-detection blocklist, and only scan pre-section resume preamble content for candidate names to eliminate section-heading-as-name errors.
    - Implement hard section boundaries to reliably separate work, internship, and project experience blocks.
    - Tighten Chinese phone validation to only match valid 11-digit mobile numbers, filtering out random embedded short number sequences.
    - Add date range extraction logic for project entries to populate start/end values, with support for "至今" (present) end dates.
    - Add an extracted text length threshold check for PDFs: return a clear "scanned/image PDFs are not supported yet" warning if extracted text is too sparse.
2.  **Data model update**: Add nullable `start_date`/`end_date` date fields to ProjectExperience storage and corresponding API schemas.
3.  **Preview flow buildout**
    - Split the existing one-step import API into two parts: a stateless parse endpoint that returns structured parsed data + warnings with no database writes, and a save endpoint that accepts user-reviewed/corrected data to write to Profile records.
    - Update frontend to a 3-step import flow: file upload → local parsing → editable preview (displaying PDF warnings, allowing field edits) → confirmed save.
---
## Validation Check
- Confirm no outbound third-party calls are made during parsing
- Test against sample Chinese DOCX/text-PDF/scanned-PDF files to verify section detection accuracy, name/phone extraction correctness, work/project separation, PDF warning behavior, and end-to-end preview/save functionality.