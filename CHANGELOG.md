# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-06-02

### Added

- **Create notes from the Properties panel** — a **+** button appears next to unresolved wikilinks in watched frontmatter fields; clicking it creates the linked note in the background without navigating away from the source note.
- **Field rules** — per-field configuration (field name, inject rows, Templater template, Linter toggle, inherit-up toggle) controlling what happens when a note is created from a link in that field.
- **Always inherit** — global setting listing frontmatter keys (e.g. `tags`, `course`) to always copy from the source note into every new note created by Inherit.
- **Inherit up** — per-rule toggle that sets `up: "[[SourceNote]]"` in the new note as a scalar wikilink (Breadcrumbs-compatible).
- **Inject frontmatter** — per-rule list of key/value pairs to write into new notes, each with an **overwrite / merge / keep-if-missing** conflict-resolution strategy.
- **Templater integration** — optional template path per rule; applied via `write_template_to_file` without requiring the file to be opened or active.
- **Linter integration** — optional per-rule toggle that runs Obsidian Linter via `runLinterFile` after creation, before Inherit's own inject step.
- **Execution order guarantee** — Templater → Linter → inject fields; our fields are always written last so wikilinks and other values are serialized correctly regardless of what earlier steps wrote.
- **Dry run preview** — collapsible section in each rule that simulates the full merge pipeline (template FM + always-inherit + up + inject) and shows a field-by-field origin table and final YAML block without creating any files.
- **List-type (multi-select pill) support** — the **+** button attaches to multi-select pills for list-type frontmatter fields in addition to standard internal-link fields.
- **Custom YAML serializer** (`serializeFrontmatter`) — deterministically quotes wikilinks and other special-character strings so `up: "[[Note]]"` is always written correctly, working around a limitation in Obsidian's internal YAML writer.
- **`merge` module** (`src/merge.ts`) — pure, side-effect-free merge logic with `runMerge`, `parseFieldValue`, `parseFrontmatterString`, `serializeFrontmatter`, and `quoteWikilinks`.
- **Jest test suite** — round-trip tests covering all merge strategies, wikilink serialization edge cases, and the full Templater + Linter + inject pipeline.
- **GitHub Actions release workflow** — builds and publishes `main.js`, `manifest.json`, and `styles.css` as release assets on version tag push.
