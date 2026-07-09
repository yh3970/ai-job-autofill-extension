# summary

This change adds a concise, user-facing section to the project README explaining the AI autofill feature's high-level architecture. The outcome is improved documentation for end users and contributors, who will be able to quickly understand the purpose and core workflow of the AI autofill system without navigating internal code or separate detailed documentation.

# target_files

- `./README.md`: Primary root project README, the standard expected location for high-level feature and architecture documentation.
- Narrow fallback discovery pattern: `./docs/README.md` only, if no root `README.md` exists. This is the only allowed alternate location for the primary project README, as the issue explicitly scopes changes to README content; no other files or paths may be modified.

# implementation_steps

1. Inspect the existing content and structure of the primary project README (at root or top-level `docs/` fallback location) to identify the logical placement for the new AI autofill architecture section. Align placement with existing content groupings (e.g., place near core feature descriptions, architecture overviews, or contributor onboarding sections as appropriate to the existing README flow). If other public documentation in the repository references AI autofill, note those details to ensure consistent explanations.
2. Add a properly formatted section aligned with the README's existing heading hierarchy (e.g., `## AI Autofill Architecture` for second-level, consistent with other major sections). The section should include:
   - A 1-2 sentence explanation of the AI autofill feature's end-user purpose
   - A high-level, non-sensitive overview of the core workflow (e.g., user trigger → input processing → AI suggestion generation → user review/approval → content insertion)
   - No internal implementation details, secrets, or unreleased feature claims
3. If the README includes a manually maintained table of contents, add a link to the new section matching existing TOC formatting; do not modify auto-generated TOCs, as project tooling will handle updates for those.
4. Review the full modified README to confirm:
   - All pre-existing content remains intact and unmodified except for the new section and any required minimal manual TOC update
   - Markdown formatting is consistent with the rest of the document (no broken lists, mismatched heading levels, or malformed links)
   - No sensitive information (API keys, internal endpoints, proprietary model details, credentials) is included in the new content
   - The tone and writing style matches existing README content for consistency
   - All claims about AI autofill align with existing public documentation in the repository to avoid conflicting statements

# acceptance_criteria

1. The primary project README (root or top-level `docs/` fallback) contains a clearly labeled, focused section explaining the AI autofill architecture, placed in a logical location consistent with the README's existing structure.
2. The addition is a small, targeted improvement: the diff for the README shows fewer than 100 lines of new content (per the "small improvement" request) with no unrelated rewrites, deletions, or changes to existing documentation.
3. The section explains the feature in terms accessible to both end users and new contributors, avoiding overly internal jargon, not disclosing sensitive or non-public implementation details, and aligning with any existing public documentation about AI autofill in the repository.
4. All existing README content (links, headings, lists, badges, sections) remains functional and unchanged aside from the new AI autofill section and any required minimal manual TOC entry.
5. The Markdown formatting of the README is valid, with no rendering errors introduced by the change.

# forbidden_changes

- Do not merge branches.
- Do not modify the repository default branch directly.
- Do not expose, print, commit, or transform secrets.
- Do not change files outside `target_files` unless the plan is explicitly revised first.
- Do not rewrite, delete, or materially alter existing README content outside of inserting the requested new section and a single matching TOC entry if the README uses a manual TOC.
- Do not include sensitive implementation details, internal API endpoints, proprietary model specifications, unreleased feature claims, or confidential project information in the added documentation.
- Do not add large, unrelated documentation sections, images, or external links not directly related to explaining the AI autofill architecture.
- Do not modify source code, configuration files, CI/CD workflows, or any non-README files as part of this change.

# test_commands

No project-specific test commands for documentation changes are provided in the issue context. Use the following verification steps:
1. After making changes, run `git diff README.md` (or `git diff docs/README.md` if using the fallback location) to review all edits, confirming only the intended new section and minimal required TOC changes are present, with no accidental modifications to existing content.
2. Check standard project configuration files (`package.json`, `Makefile`, `.markdownlint.json`, `pyproject.toml`, etc.) for existing Markdown lint commands (e.g., `markdownlint`, `lint:md`, `docs:lint`). If such a command exists, run it against the modified README to check for formatting errors.
3. Perform a visual inspection of the rendered Markdown (using local IDE Markdown preview or CLI tools like `glow README.md` if available) to confirm headings, lists, and links render correctly, and the new section is readable and logically placed.

# risks

1. Misplaced section: Adding the new section in an illogical location that disrupts the README's existing content flow, making the architecture explanation hard for readers to locate. Mitigation: Complete a full read of the existing README before adding content to align with existing section groupings.
2. Inappropriate content: Including overly technical internal details, sensitive information, or unsubstantiated claims about AI autofill functionality that do not reflect actual project capabilities or should not appear in public documentation. Mitigation: Keep explanations high-level, focused on user-facing behavior and standard, non-proprietary workflow steps, and review the final diff for any sensitive content.
3. Accidental content loss: Deleting or corrupting existing README content while inserting the new section. Mitigation: Review the full git diff after edits to confirm all pre-existing content is unchanged, and avoid bulk edits to existing sections.
4. Inconsistent formatting: Mismatching the README's existing heading levels, tone, or formatting conventions, leading to inconsistent documentation. Mitigation: Match the writing style, heading hierarchy, and Markdown patterns used in adjacent existing sections of the README.
5. Broken navigation: Failing to add a TOC entry for the new section in READMEs with manually maintained tables of contents, leading to incomplete or broken navigation. Mitigation: Check for an existing manual TOC after adding the section, and add a matching entry if required, following existing TOC link formatting.
6. Conflicting claims: Adding descriptions of AI autofill that contradict existing public documentation or stated project functionality. Mitigation: Cross-reference any existing references to AI autofill in public repo docs before writing the new section to ensure aligned, accurate descriptions.