import { App, PluginSettingTab, Setting } from 'obsidian';
import InheritPlugin from './main';

export interface FieldRule {
	/** The frontmatter field to watch (e.g. "person", "location") */
	field: string;
	/** Frontmatter key/value pairs to inject into the created note */
	inject: Record<string, string>;
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
						inject: {},
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

		// ── Header row: field name + remove button ──────────────────────────
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

		// ── Inherit up toggle ────────────────────────────────────────────────
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
			const rowsEl = injectSection.querySelector('.inherit-inject-rows');
			if (rowsEl) rowsEl.remove();

			const rows = injectSection.createDiv({ cls: 'inherit-inject-rows' });

			const entries = Object.entries(rule.inject);

			if (entries.length === 0) {
				rows.createEl('div', {
					text: 'No fields — click + to add one.',
					cls: 'inherit-empty-hint',
				});
			}

			for (const [key, val] of entries) {
				const row = rows.createDiv({ cls: 'inherit-inject-row' });

				const keyInput = row.createEl('input', {
					type: 'text',
					cls: 'inherit-inject-key',
					attr: { placeholder: 'key' },
				});
				keyInput.value = key;

				const valInput = row.createEl('input', {
					type: 'text',
					cls: 'inherit-inject-val',
					attr: { placeholder: 'value' },
				});
				valInput.value = val;

				const delBtn = row.createEl('button', {
					cls: 'inherit-inject-del',
					text: '✕',
				});

				// Save on blur so rapid typing doesn't thrash
				const save = async () => {
					const newKey = keyInput.value.trim();
					const newVal = valInput.value;
					if (!newKey) return;
					// Rebuild inject without old key, add new key
					const updated: Record<string, string> = {};
					for (const [k, v] of Object.entries(rule.inject)) {
						updated[k === key ? newKey : k] = k === key ? newVal : v;
					}
					rule.inject = updated;
					await this.plugin.saveSettings();
				};
				keyInput.addEventListener('blur', save);
				valInput.addEventListener('blur', save);

				delBtn.addEventListener('click', async () => {
					delete rule.inject[key];
					await this.plugin.saveSettings();
					renderInjectRows();
				});
			}

			// Add row button
			const addRow = rows.createEl('button', {
				cls: 'inherit-inject-add',
				text: '+ Add field',
			});
			addRow.addEventListener('click', async () => {
				// Add a blank entry with a placeholder key
				let k = 'key';
				let n = 1;
				while (rule.inject[k]) k = `key${n++}`;
				rule.inject[k] = '';
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
	}
}
