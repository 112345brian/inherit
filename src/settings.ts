import { App, PluginSettingTab, Setting } from 'obsidian';
import InheritPlugin from './main';

export interface FieldRule {
	/** The frontmatter field to watch (e.g. "person", "location") */
	field: string;
	/** Frontmatter to inject into the created note */
	inject: Record<string, string>;
	/** Whether to also set `up` to the source note */
	inheritUp: boolean;
	/** Optional Templater template path to apply */
	templatePath: string;
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
				'Comma-separated frontmatter fields to always copy from the source note into the new note (e.g. "tags, course, project").',
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

		ruleEl.createEl('h4', { text: `Rule ${index + 1}` });

		new Setting(ruleEl)
			.setName('Field name')
			.setDesc('The frontmatter field to watch (e.g. "person").')
			.addText((text) =>
				text
					.setPlaceholder('person')
					.setValue(rule.field)
					.onChange(async (value) => {
						rule.field = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(ruleEl)
			.setName('Inject frontmatter')
			.setDesc(
				'JSON object of frontmatter to add to the new note (e.g. {"type": "person"}).',
			)
			.addText((text) =>
				text
					.setPlaceholder('{"type": "person"}')
					.setValue(
						Object.keys(rule.inject).length
							? JSON.stringify(rule.inject)
							: '',
					)
					.onChange(async (value) => {
						try {
							rule.inject = value ? JSON.parse(value) : {};
						} catch {
							// ignore invalid JSON while typing
						}
						await this.plugin.saveSettings();
					}),
			);

		new Setting(ruleEl)
			.setName('Inherit up')
			.setDesc(
				'Set `up` in the new note to point back to the source note.',
			)
			.addToggle((toggle) =>
				toggle.setValue(rule.inheritUp).onChange(async (value) => {
					rule.inheritUp = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(ruleEl)
			.setName('Template path')
			.setDesc(
				'Optional: path to a Templater template to apply after creation (e.g. "Templates/Person.md").',
			)
			.addText((text) =>
				text
					.setPlaceholder('Templates/Person.md')
					.setValue(rule.templatePath)
					.onChange(async (value) => {
						rule.templatePath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(ruleEl).addButton((btn) =>
			btn
				.setButtonText('Remove')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.rules.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
				}),
		);
	}
}
