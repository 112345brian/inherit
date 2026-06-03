# Inherit — Usage Guide

## Overview

Inherit watches the Properties panel of the currently open note for unresolved wikilinks in configured frontmatter fields. When it finds one, it shows a small **+** button. Click the button to create the linked note with frontmatter automatically populated from the source.

## Quick start

1. Install and enable the Inherit plugin.
2. Go to **Settings → Inherit**.
3. Click **+ Add rule** and type the frontmatter field to watch, e.g. `person`.
4. Enable **Inherit up** to automatically set `up` in the new note pointing back to the source.
5. Open a note with `person: "[[Alice]]"` where `Alice` doesn't exist yet.
6. Click the **+** button that appears next to `[[Alice]]` in the Properties panel.
7. A new note named `Alice` is created with `up: "[[YourNote]]"` in its frontmatter.

## Field rules in detail

Each rule targets one frontmatter field. You can add as many rules as you need — one for `person`, one for `location`, one for `project`, and so on.

### Inherit up

When enabled, the new note gets `up: "[[SourceNote]]"` written into its frontmatter. This is a scalar wikilink string, which is the format the Breadcrumbs plugin expects for its `up` field.

### Inject frontmatter

Inject rows let you write arbitrary values into the new note's frontmatter:

| Key | Value | Strategy |
|-----|-------|----------|
| `type` | `person` | Overwrite |
| `tags` | `[people]` | Merge |
| `status` | `active` | Keep if missing |

**Strategies:**

- **Overwrite** — this value always wins; any value the Templater template wrote for the same key is discarded.
- **Merge** — arrays are combined (deduplicated); scalars use this value. Useful for `tags`.
- **Keep if missing** — only sets the field if the template did not already populate it. Useful for defaults that the template might override.

Values can be plain strings, numbers, booleans, YAML arrays (`[a, b, c]`), or wikilinks (`[[Note Name]]`).

### Templater integration

Set **Templater template** to the vault path of a Templater template (e.g. `Templates/Person.md`). Inherit runs Templater first, before applying its own fields, so template-generated values can be selectively overridden or preserved using the inject strategy.

Templater is applied via `write_template_to_file` — the new note does not need to be the active view and the current view is never changed.

### Linter integration

Enable **Run linter after creation** to run Obsidian Linter on the new note after creation. Linter runs before Inherit's inject step, so Linter-generated fields (like `date-created`) are preserved and Inherit's fields are written on top.

Linter is applied via the internal `runLinterFile` API — no active view required.

### Execution order

For each new note, Inherit always runs in this order:

1. **Templater** (if a template path is configured)
2. **Linter** (if enabled for the rule)
3. **Inject fields** (always last — ensures our values and wikilink quoting win)

## Always inherit fields

Under **Always inherit fields** you can enter a comma-separated list of frontmatter keys to copy from the source note into every new note, regardless of which rule triggered creation. Useful for fields like `tags`, `course`, or `project` that should propagate through a note hierarchy.

Always-inherited fields are applied before inject fields in the merge order, so inject fields can override them using the **Overwrite** strategy.

## Dry run preview

The **Dry run preview** section in each rule lets you test your configuration without creating any notes.

1. Expand the section by clicking **▶ Dry run preview**.
2. Paste the source note's frontmatter YAML into the first textarea.
3. Optionally paste the output your Templater template would produce into the second textarea.
4. Enter a source note name.
5. Click **Run preview**.

The output shows:
- A field-by-field table with each key, its resolved value, and its origin (`template`, `inherit`, `up`, or `inject · strategy`)
- The final YAML block exactly as it would be written to disk

## Wikilink handling

Inherit uses a custom YAML serializer (`serializeFrontmatter`) that always double-quotes strings starting with `[[`, ensuring wikilinks round-trip correctly (e.g. `up: "[[My Note]]"`).

This works around a known limitation in Obsidian's built-in YAML writer, which does not quote wikilinks inside YAML arrays. Inherit avoids arrays for the `up` field specifically for this reason.

## New note location

Inherit respects **Settings → Files & Links → Default location for new notes**:

- **Vault folder** — note is created in the configured folder path
- **Same folder as current file** — note is created in the same folder as the source note
- **Root / top level** — note is created in the vault root

## Tips

- Use **Merge** strategy for `tags` to combine the source note's tags with your template's default tags.
- Use **Keep if missing** for fields your template always sets (e.g. `type`) so the template stays the source of truth but you can add fallback values.
- The **+** button only appears for **unresolved** links — notes that don't exist yet. It disappears automatically once the note is created and the metadata cache refreshes.
- You can have rules for the same field in multiple rule entries, but in practice one rule per field type is sufficient.
- The **Dry run preview** is safe to run at any time — it never touches the vault.
