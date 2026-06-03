# Inherit

An Obsidian plugin that creates notes from unresolved frontmatter links, automatically inheriting and injecting frontmatter from the source note.

## What it does

When a note has a frontmatter field containing a wikilink to a note that doesn't exist yet, Inherit places a **+** button next to that link in the Properties panel. Click the button to create the linked note — Inherit will:

1. Apply a Templater template (if configured for the rule)
2. Run Obsidian Linter (if installed and enabled for the rule)
3. Inject configured frontmatter fields with values from the source note or your rule definitions

The new note is created in the background without navigating away from the current note.

## How to use

1. Open **Settings → Inherit**.
2. Optionally set **Always inherit fields** — a comma-separated list of frontmatter keys (e.g. `tags, course, project`) to always copy from the source note into every note created by Inherit.
3. Add a **Field rule** for each frontmatter field you want to watch (e.g. `person`, `location`).
4. Configure each rule:
   - **Inherit up** — sets `up: "[[SourceNote]]"` in the new note (Breadcrumbs-compatible)
   - **Inject frontmatter** — add key/value pairs to write into the new note, each with a conflict strategy:
     - **Overwrite** — always uses this value, discarding any value the template wrote
     - **Merge** — combines arrays (deduped); uses this value for scalars
     - **Keep if missing** — only sets the field if the template didn't already populate it
   - **Templater template** — vault path to a Templater template (e.g. `Templates/Person.md`)
   - **Run linter after creation** — runs Obsidian Linter on the new note (requires the Linter plugin)
5. Open any note with an unresolved wikilink in a watched frontmatter field. The **+** button will appear next to the link in the Properties panel.
6. Click **+** to create the note.

## Dry run preview

Each field rule includes a collapsible **Dry run preview** section. Paste simulated source note frontmatter and Templater output YAML, enter a source note name, and click **Run preview** to see a field-by-field origin table and the final YAML block — without creating any files.

## Settings reference

| Setting | Description |
|---|---|
| Always inherit fields | Comma-separated frontmatter keys to always copy from the source note |
| Field rules | One rule per frontmatter field to watch |
| Rule → Inherit up | Writes `up: "[[SourceNote]]"` in the new note |
| Rule → Inject frontmatter | Key/value pairs with overwrite / merge / keep-if-missing strategy |
| Rule → Templater template | Path to a Templater template to apply after creation |
| Rule → Run linter after creation | Runs Obsidian Linter after note creation |

## New note placement

Inherit respects Obsidian's **Files & Links → Default location for new notes** setting:
- **Vault folder** — creates in the configured folder
- **Same folder as current file** — creates next to the source note
- **Root** (default) — creates at the vault root

## Plugin integrations

- **Templater** — applied via `write_template_to_file` (no active view required; the note is never opened during template application)
- **Obsidian Linter** — applied via `runLinterFile` (no active view required)
- **Breadcrumbs** — `up` is written as a scalar wikilink string (`up: "[[Note]]"`) which Breadcrumbs reads correctly

## Installation

### From Community Plugins (when listed)

1. Open **Settings → Community plugins → Browse**.
2. Search for **Inherit**.
3. Select **Install**, then **Enable**.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/112345brian/inherit/releases).
2. Copy them to `<Vault>/.obsidian/plugins/inherit/`.
3. Reload Obsidian and enable Inherit under **Settings → Community plugins**.

## Development

```bash
npm install
npm run dev      # watch mode — recompiles on save
npm run build    # production build
npm run lint     # ESLint check
npm test         # Jest test suite
```

---

## My Other Plugins

Like this plugin? I make a few others for Obsidian:

- [**Bread Trail**](https://github.com/112345brian/bread-trail) — enhanced Breadcrumbs navigation
- [**Breadbake**](https://github.com/112345brian/breadbake) — Breadcrumbs graph configuration
- [**Citation Suite**](https://github.com/112345brian/bripey-citation-suite) — enhanced citation tools
- [**Properties First**](https://github.com/112345brian/obsidian-properties-first) — move properties above the inline title
- [**Return Headings**](https://github.com/112345brian/return-headings) — heading-return navigation markers

Want to install them all at once? Check out [**bripeys-extremely-opinionated-plugin-suite**](https://github.com/112345brian/bripeys-extremely-opinionated-plugin-suite).
