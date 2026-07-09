# summary
This change makes a small, targeted improvement to the project's root README file to add a clear, concise explanation of the AI autofill architecture. The user-visible outcome is that readers of the README (including new users, contributors, and repository visitors) will have easy access to accurate, high-level documentation of how the AI autofill system works, what user-facing behaviors to expect, and how it fits into the project's core functionality, without adding unnecessary bulk to the document.

# target_files
- `./README.md`: Primary expected canonical root README file, the standard Markdown README used in most software repositories and the expected target for the documentation improvement.
- Narrowly scoped discovery pattern: `./README*` (restricted exclusively to the repository root directory, no recursive subdirectory search). This pattern is only to be used if `./README.md` does not exist, to locate the canonical root README (which may use a standard alternate extension like .rst, .adoc, or .txt per common project conventions). Recursive search for README files in subdirectories is not permitted, as the issue refers to the top-level project README.

# implementation_steps
1. Inspect the repository root to identify the canonical top-level README file: first check for `./README.md`; if it does not exist, use the narrow root-only `./README*` pattern to find the correct top-level README, and do not edit README files in subdirectories.
2. Read the full content of the identified README to:
   a. Map the existing document structure to find the most thematically appropriate location for AI autofill architecture content (e.g., adjacent to existing sections on core features, system architecture, or AI-powered functionality, rather than appending uncontextualized content to the very end of the file if a better fit exists).
   b. Identify any existing partial documentation of the AI autofill system to expand and improve, rather than adding redundant duplicate content.
3. Add or update a concise section explaining the AI autofill architecture, keeping the total new/modified content to 200-300 words (consistent with the "small improvement" scope). The content should cover only user-relevant, observable high-level details:
   - The core purpose of the AI autofill feature
   - The high-level user flow for triggering and using AI autofill
   - Key guardrails and behavior users can expect during autofill operation
   Do not include non-public internal details, proprietary system prompts, or granular implementation specifics irrelevant to README readers.
4. Format the new/updated content to perfectly match the existing README's conventions: match heading hierarchy, list styling, tone of voice, link format, and spacing to surrounding content to maintain visual and stylistic consistency. If the README uses a non-Markdown format, apply that format's native syntax instead of Markdown.
5. Perform a line-by-line review of the edited README to confirm:
   a. No existing content (installation steps, license text, contribution guidelines, project description, etc.) was accidentally deleted, altered, or moved incorrectly.
   b. The AI autofill explanation is accurate to observable system behavior, and makes no unsubstantiated claims about non-existent functionality.
   c. There are no typos, grammatical errors, or syntax errors that would break rendering of the document.

# acceptance_criteria
1. The repository's top-level canonical README file contains a clearly labeled, easily located section explaining the AI autofill architecture.
2. The total new/updated content for the architecture explanation is between 200-300 words, consistent with the "small improvement" scope, and does not add unnecessary bulk to the README.
3. The AI autofill section is stylistically and thematically consistent with the rest of the README, matching existing formatting, tone, and document structure without introducing new, inconsistent styling patterns.
4. All pre-existing, correct README content remains intact and unmodified except for the minimal changes required to integrate the new architecture section.
5. The explanation of AI autofill is accurate to user-observable system behavior, free of claims about unimplemented features, and accessible to readers who are new to the project.
6. The README renders correctly with no syntax errors, broken lists, malformed headings, or broken links introduced by the change.
7. No non-public, proprietary, or sensitive internal implementation details are included in the added documentation.

# forbidden_changes
- Do not merge branches.
- Do not modify the repository default branch directly.
- Do not expose, print, commit, or transform secrets.
- Do not change files outside `target_files` unless the plan is explicitly revised first.
- Do not edit README files located in repository subdirectories; only the top-level root README is in scope for this change.
- Do not add multi-page, overly verbose documentation dumps to the README; the change is explicitly a small, targeted improvement, not a full rewrite of project documentation.
- Do not include sensitive internal details, non-public system prompts, proprietary internal logic, or secrets in the added documentation.
- Do not alter existing critical README content (installation instructions, license notices, contribution guidelines, project metadata, support information) except as strictly necessary to insert the new architecture section.
- Do not create new standalone documentation files for the AI autofill architecture explanation; all content for this change must live within the existing top-level README.

# test_commands
1. First, scan root project configuration files (Makefile, package.json, pyproject.toml, justfile, .markdownlint.json, etc.) for any existing Markdown/documentation lint, link check, or README validation scripts. If such scripts exist, run the project's standard documentation validation command to catch formatting errors, broken links, or style issues.
2. Run a content presence check to confirm the AI autofill section is present: from the repository root, run `grep -i "ai autofill" ./README*` (targeting only the root README) and verify a match for the section heading/content exists.
3. If no dedicated project documentation test scripts exist, perform a structured inspection of the edited README:
   - Verify the document renders correctly as its native format (Markdown, RST, etc.) with no broken syntax, using a local Markdown/RST preview tool or CLI renderer (e.g. `mdcat`, `rst2html`) if available.
   - Read the new AI autofill section to confirm it is clear, concise, and accurate.
   Note: No project-specific test commands are provided in the issue context, so this structured inspection fills the validation gap for this documentation-only change, as code behavior is not modified.

# risks
1. The new AI autofill section may be placed in a thematically unrelated or low-visibility location in the README, reducing its discoverability and usefulness for readers; care must be taken to align placement with existing document structure.
2. Formatting or syntax errors (e.g. mismatched Markdown headings, broken lists, invalid RST syntax) may be introduced, causing the README to render incorrectly on code hosting platforms like GitHub.
3. The added content may grow beyond the "small improvement" scope, including overly granular internal details, proprietary information, or irrelevant context that bloats the README and creates maintenance burden.
4. If partial AI autofill documentation already exists in the README, adding a separate new section will create duplicate, conflicting content that can drift out of sync over time; existing content must be updated rather than duplicated.
5. Existing critical README content (installation steps, license, contribution guides) may be accidentally overwritten, deleted, or misaligned while inserting the new section, requiring careful line-by-line review after edits.
6. The AI autofill explanation may describe aspirational or non-existent functionality instead of actual, observable behavior, leading to incorrect user expectations and confusion.
7. If the root README uses a non-Markdown format, applying Markdown-specific syntax will break document rendering; all added content must match the native format of the existing README file.