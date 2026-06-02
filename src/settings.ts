import { App, PluginSettingTab, Setting } from 'obsidian';
import InheritPlugin from './main';
import { runMerge, parseFrontmatterString } from './merge';

export type InjectStrategy = 'overwrite' | 'merge' | 'keep';

export interface InjectField {
	key: string;
	value: string;
	/** overwrite: our value always wins | merge: combine arrays, overwrite scalars | keep: only set if template didn't */
	strategy: InjectStrategy;
}

export interface FieldRule {
	/** The frontmatter field to watch (e.g. "person", "location") */
	field: string;
	/** Frontmatter fields to inject into the created note */
	inject: InjectField[];
	/** Whether to also set `up` to the source note */
	inheritUp: boolean;
	/** Optional Templater template path to apply */
	templatePath: string;
	/** Run Obsidian Linter on the note after creation */
	runLinter: boolean;
}

export interface InheritSettings {
	rules: FieldRule[];
	/** Always inherit these frontmatter fields from source note */
	alwaysInherit: string[];
}

export const DEFAULT_SETTINGS: InheritSettings = {
	rules: [],
	alwaysInherit: [],
};

const STRATEGY_LABELS: Record<InjectStrategy, string> = {
	overwrite: 'Overwrite',
	merge: 'Merge',
	keep: 'Keep if missing',
};

const STRATEGY_DESCS: Record<InjectStrategy, string> = {
	overwrite: 'Our value always wins, template value is discarded.',
	merge: 'Arrays are combined; scalars use our value.',
	keep: 'Only set if the template did not already set this field.',
};

export class InheritSettingTab extends PluginSettingTab {
	plugin: InheritPlugin;

	constructor(app: App, plugin: InheritPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Inherit' });

		// Always inherit fields
		new Setting(containerEl)
			.setName('Always inherit fields')
			.setDesc(
				'Frontmatter fields to always copy from the source note into the new note.',
			)
			.addText((text) =>
				text
					.setPlaceholder('tags, course, project')
					.setValue(this.plugin.settings.alwaysInherit.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.alwaysInherit = value
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					}),
			);

		// Rules
		containerEl.createEl('h3', { text: 'Field rules' });
		containerEl.createEl('p', {
			text: 'Define what happens when a new note is created from a link in a specific frontmatter field.',
			cls: 'setting-item-description',
		});

		for (let i = 0; i < this.plugin.settings.rules.length; i++) {
			this.renderRule(containerEl, i);
		}

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText('+ Add rule')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.rules.push({
						field: '',
						inject: [],
						inheritUp: true,
						templatePath: '',
						runLinter: false,
					});
					await this.plugin.saveSettings();
					this.display();
				}),
		);
	}

	private renderRule(containerEl: HTMLElement, index: number): void {
		const rule = this.plugin.settings.rules[index];
		if (!rule) return;

		const ruleEl = containerEl.createDiv({ cls: 'inherit-rule' });

		// ── Header: field name + remove ──────────────────────────────────────
		const headerEl = ruleEl.createDiv({ cls: 'inherit-rule-header' });

		const fieldInput = headerEl.createEl('input', {
			type: 'text',
			cls: 'inherit-rule-field-input',
			attr: { placeholder: 'Field name (e.g. person)' },
		});
		fieldInput.value = rule.field;
		fieldInput.addEventListener('input', async () => {
			rule.field = fieldInput.value.trim();
			await this.plugin.saveSettings();
		});

		const removeBtn = headerEl.createEl('button', {
			cls: 'inherit-rule-remove',
			text: '✕',
			attr: { 'aria-label': 'Remove rule' },
		});
		removeBtn.addEventListener('click', async () => {
			this.plugin.settings.rules.splice(index, 1);
			await this.plugin.saveSettings();
			this.display();
		});

		// ── Inherit up ───────────────────────────────────────────────────────
		new Setting(ruleEl)
			.setName('Inherit up')
			.setDesc('Set `up` in the new note to point back to the source note.')
			.addToggle((toggle) =>
				toggle.setValue(rule.inheritUp).onChange(async (value) => {
					rule.inheritUp = value;
					await this.plugin.saveSettings();
				}),
			);

		// ── Inject frontmatter rows ──────────────────────────────────────────
		const injectSection = ruleEl.createDiv({ cls: 'inherit-inject-section' });
		injectSection.createEl('div', {
			text: 'Inject frontmatter',
			cls: 'inherit-section-label',
		});

		const renderInjectRows = () => {
			const existing = injectSection.querySelector('.inherit-inject-rows');
			if (existing) existing.remove();

			const rows = injectSection.createDiv({ cls: 'inherit-inject-rows' });

			if (rule.inject.length === 0) {
				rows.createEl('div', {
					text: 'No fields — click + to add one.',
					cls: 'inherit-empty-hint',
				});
			}

			rule.inject.forEach((field, fi) => {
				const row = rows.createDiv({ cls: 'inherit-inject-row' });

				// Key
				const keyInput = row.createEl('input', {
					type: 'text',
					cls: 'inherit-inject-key',
					attr: { placeholder: 'key' },
				});
				keyInput.value = field.key;
				keyInput.addEventListener('blur', async () => {
					field.key = keyInput.value.trim();
					await this.plugin.saveSettings();
				});

				// Value
				const valInput = row.createEl('input', {
					type: 'text',
					cls: 'inherit-inject-val',
					attr: { placeholder: 'value' },
				});
				valInput.value = field.value;
				valInput.addEventListener('blur', async () => {
					field.value = valInput.value;
					await this.plugin.saveSettings();
				});

				// Strategy dropdown
				const stratSelect = row.createEl('select', {
					cls: 'inherit-inject-strategy',
					attr: { title: STRATEGY_DESCS[field.strategy] },
				});
				for (const [val, label] of Object.entries(STRATEGY_LABELS)) {
					const opt = stratSelect.createEl('option', {
						value: val,
						text: label,
					});
					if (val === field.strategy) opt.selected = true;
				}
				stratSelect.addEventListener('change', async () => {
					field.strategy = stratSelect.value as InjectStrategy;
					stratSelect.title = STRATEGY_DESCS[field.strategy];
					await this.plugin.saveSettings();
				});

				// Delete
				const delBtn = row.createEl('button', {
					cls: 'inherit-inject-del',
					text: '✕',
				});
				delBtn.addEventListener('click', async () => {
					rule.inject.splice(fi, 1);
					await this.plugin.saveSettings();
					renderInjectRows();
				});
			});

			// Add row button
			const addRow = rows.createEl('button', {
				cls: 'inherit-inject-add',
				text: '+ Add field',
			});
			addRow.addEventListener('click', async () => {
				rule.inject.push({ key: '', value: '', strategy: 'overwrite' });
				await this.plugin.saveSettings();
				renderInjectRows();
			});
		};

		renderInjectRows();

		// ── Template path ────────────────────────────────────────────────────
		new Setting(ruleEl)
			.setName('Templater template')
			.setDesc('Optional template to apply after creation.')
			.addText((text) =>
				text
					.setPlaceholder('Templates/Person.md')
					.setValue(rule.templatePath)
					.onChange(async (value) => {
						rule.templatePath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// ── Run linter ───────────────────────────────────────────────────────
		new Setting(ruleEl)
			.setName('Run linter after creation')
			.setDesc('Requires the Obsidian Linter plugin to be enabled.')
			.addToggle((toggle) =>
				toggle.setValue(rule.runLinter ?? false).onChange(async (value) => {
					rule.runLinter = value;
					await this.plugin.saveSettings();
				}),
			);

		// ── Dry run ──────────────────────────────────────────────────────────
		this.renderDryRun(ruleEl, index);
	}

	private renderDryRun(ruleEl: HTMLElement, index: number): void {
		const rule = this.plugin.settings.rules[index];
		if (!rule) return;

		const section = ruleEl.createDiv({ cls: 'inherit-dryrun' });

		// Collapsible toggle
		const header = section.createEl('button', {
			cls: 'inherit-dryrun-header',
			text: '▶ Dry run preview',
		});
		const body = section.createDiv({ cls: 'inherit-dryrun-body' });
		body.style.display = 'none';

		header.addEventListener('click', () => {
			const open = body.style.display !== 'none';
			body.style.display = open ? 'none' : 'block';
			header.setText((open ? '▶' : '▼') + ' Dry run preview');
		});

		// Source note frontmatter input
		body.createEl('div', {
			text: 'Simulated source note frontmatter',
			cls: 'inherit-section-label',
		});
		body.createEl('div', {
			text: 'Paste YAML as it would appear in the source note (the one containing the link).',
			cls: 'inherit-dryrun-hint',
		});
		const sourceInput = body.createEl('textarea', {
			cls: 'inherit-dryrun-textarea',
			attr: { placeholder: 'tags:\n  - research\ncourse: "[[My Course]]"', spellcheck: 'false' },
		});

		// Template frontmatter input
		body.createEl('div', {
			text: 'Simulated Templater output frontmatter',
			cls: 'inherit-section-label',
		});
		body.createEl('div', {
			text: 'Paste YAML as your Templater template would produce it.',
			cls: 'inherit-dryrun-hint',
		});
		const templateInput = body.createEl('textarea', {
			cls: 'inherit-dryrun-textarea',
			attr: { placeholder: 'type: person\ntags:\n  - person', spellcheck: 'false' },
		});

		// Source name input
		const sourceNameRow = body.createDiv({ cls: 'inherit-dryrun-row' });
		sourceNameRow.createEl('span', { text: 'Source note name:', cls: 'inherit-dryrun-label' });
		const sourceNameInput = sourceNameRow.createEl('input', {
			type: 'text',
			cls: 'inherit-dryrun-name',
			attr: { placeholder: 'My Research Note' },
		});

		// Run button
		const runBtn = body.createEl('button', {
			cls: 'inherit-dryrun-run',
			text: 'Run preview',
		});

		// Output
		const output = body.createDiv({ cls: 'inherit-dryrun-output' });
		output.style.display = 'none';

		runBtn.addEventListener('click', () => {
			const sourceFm = parseFrontmatterString(sourceInput.value);
			const templateFm = parseFrontmatterString(templateInput.value);
			const sourceName = sourceNameInput.value.trim() || 'Source Note';

			const { fields, yaml } = runMerge(
				sourceFm,
				templateFm,
				rule.inject,
				this.plugin.settings.alwaysInherit,
				rule.inheritUp,
				sourceName,
			);

			output.empty();
			output.style.display = 'block';

			// Annotated field list
			const table = output.createEl('table', { cls: 'inherit-dryrun-table' });
			const thead = table.createEl('thead');
			const hr = thead.createEl('tr');
			hr.createEl('th', { text: 'Field' });
			hr.createEl('th', { text: 'Value' });
			hr.createEl('th', { text: 'Source' });

			const tbody = table.createEl('tbody');
			for (const f of fields) {
				const tr = tbody.createEl('tr');
				tr.createEl('td', {
					text: f.key,
					cls: 'inherit-dryrun-key',
				});
				tr.createEl('td', {
					text: JSON.stringify(f.value),
					cls: 'inherit-dryrun-val',
				});
				const badge = tr.createEl('td');
				badge.createEl('span', {
					text: f.strategy
						? `inject · ${f.strategy}`
						: f.origin,
					cls: `inherit-badge inherit-badge-${f.origin}`,
				});
			}

			// Final YAML block
			output.createEl('div', {
				text: 'Resulting frontmatter',
				cls: 'inherit-section-label',
			});
			output.createEl('pre', {
				text: `---\n${yaml}\n---`,
				cls: 'inherit-dryrun-yaml',
			});
		});
	}
}
