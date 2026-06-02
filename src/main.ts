import { Notice, Plugin, TFile, parseYaml, stringifyYaml } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	FieldRule,
	InjectField,
	InheritSettings,
	InheritSettingTab,
} from './settings';

export default class InheritPlugin extends Plugin {
	settings!: InheritSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new InheritSettingTab(this.app, this));
		this.registerMarkdownPostProcessor(this.postProcessor.bind(this));
	}

	onunload() {}

	// ─── Post processor ───────────────────────────────────────────────────────

	private postProcessor(el: HTMLElement, ctx: { sourcePath: string }) {
		const propertiesEl = el.querySelector('.metadata-container');
		if (!propertiesEl) return;
		this.attachButtons(propertiesEl as HTMLElement, ctx.sourcePath);
	}

	// ─── Button attachment ────────────────────────────────────────────────────

	attachButtons(container: HTMLElement, sourcePath: string) {
		const watchedFields = new Set(
			this.settings.rules.map((r) => r.field.toLowerCase()),
		);
		if (watchedFields.size === 0) return;

		const rows = container.querySelectorAll('.metadata-property');
		rows.forEach((row) => {
			const key = row.getAttribute('data-property-key')?.toLowerCase();
			if (!key || !watchedFields.has(key)) return;

			const rule = this.settings.rules.find(
				(r) => r.field.toLowerCase() === key,
			);
			if (!rule) return;

			const links = row.querySelectorAll('a.internal-link');
			links.forEach((link) => {
				const anchor = link as HTMLAnchorElement;
				const linkText =
					anchor.getAttribute('data-href') ||
					anchor.textContent?.trim() ||
					'';
				if (!linkText) return;
				if (anchor.parentElement?.querySelector('.inherit-create-btn')) return;

				const resolved = this.app.metadataCache.getFirstLinkpathDest(
					linkText,
					sourcePath,
				);
				if (!resolved) {
					this.attachButton(anchor, linkText, sourcePath, rule);
				}
			});
		});
	}

	private attachButton(
		anchor: HTMLAnchorElement,
		linkText: string,
		sourcePath: string,
		rule: FieldRule,
	) {
		const wrapper = anchor.parentElement!;
		wrapper.style.position = 'relative';
		wrapper.style.display = 'inline-flex';
		wrapper.style.alignItems = 'center';
		wrapper.style.gap = '4px';

		const btn = wrapper.createEl('button', {
			cls: 'inherit-create-btn',
			attr: { 'aria-label': `Create note: ${linkText}` },
		});
		btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;

		btn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			await this.createNote(linkText, sourcePath, rule);
			btn.remove();
		});
	}

	// ─── Note creation ────────────────────────────────────────────────────────

	async createNote(
		linkText: string,
		sourcePath: string,
		rule: FieldRule,
	): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		const sourceMeta =
			this.app.metadataCache.getFileCache(sourceFile)?.frontmatter ?? {};

		const targetPath = this.resolveNewNotePath(linkText, sourcePath);

		// Build initial frontmatter: inherited fields + `up`
		// Inject fields come AFTER Templater so we can apply conflict strategies
		const baseFm: Record<string, unknown> = {};

		for (const field of this.settings.alwaysInherit) {
			if (sourceMeta[field] !== undefined) {
				baseFm[field] = sourceMeta[field];
			}
		}

		if (rule.inheritUp) {
			baseFm['up'] = `[[${sourceFile.basename}]]`;
		}

		const yaml = stringifyYaml(baseFm).trimEnd();
		const content = `---\n${yaml}\n---\n\n# ${linkText}\n`;

		try {
			const newFile = await this.app.vault.create(targetPath, content);

			// Open so Templater and Linter can operate on the active file
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(newFile);

			// Apply Templater template first — it may set its own frontmatter
			if (rule.templatePath) {
				await this.applyTemplaterTemplate(newFile, rule.templatePath);
			}

			// Now apply inject fields with conflict resolution against whatever
			// Templater wrote
			if (rule.inject.length > 0) {
				await this.applyInjectFields(newFile, rule.inject);
			}

			// Linter runs last, after all frontmatter is settled
			if (rule.runLinter) {
				await this.runLinter();
			}

			new Notice(`Created: ${linkText}`);
		} catch (err) {
			new Notice(`Inherit: failed to create note — ${(err as Error).message}`);
		}
	}

	/**
	 * Apply inject fields to the file's frontmatter using per-field strategies.
	 * Reads the current file content (post-Templater), merges, then writes back.
	 */
	private async applyInjectFields(
		file: TFile,
		fields: InjectField[],
	): Promise<void> {
		// Small delay to ensure Templater has finished writing
		await new Promise((r) => setTimeout(r, 150));

		const raw = await this.app.vault.read(file);
		const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
		const existingFm: Record<string, unknown> = fmMatch && fmMatch[1]
			? (parseYaml(fmMatch[1]) as Record<string, unknown>) ?? {}
			: {};
		const body = fmMatch ? raw.slice(fmMatch[0].length) : '\n' + raw;

		const merged = { ...existingFm };

		for (const field of fields) {
			if (!field.key) continue;
			const existing = merged[field.key];
			const incoming = this.parseFieldValue(field.value);

			switch (field.strategy) {
				case 'overwrite':
					merged[field.key] = incoming;
					break;

				case 'keep':
					// Only set if not already present
					if (existing === undefined || existing === null || existing === '') {
						merged[field.key] = incoming;
					}
					break;

				case 'merge':
					if (Array.isArray(existing) && Array.isArray(incoming)) {
						// Combine arrays, deduplicate
						merged[field.key] = [
							...new Set([...existing, ...incoming]),
						];
					} else if (Array.isArray(existing)) {
						// Add scalar incoming into existing array
						const arr = [...existing];
						if (!arr.includes(incoming)) arr.push(incoming);
						merged[field.key] = arr;
					} else if (Array.isArray(incoming)) {
						// Incoming is array, existing is scalar — prepend existing
						const arr = [...incoming];
						if (existing !== undefined && !arr.includes(existing)) {
							arr.unshift(existing);
						}
						merged[field.key] = arr;
					} else {
						// Both scalars — treat as overwrite
						merged[field.key] = incoming;
					}
					break;
			}
		}

		const newYaml = stringifyYaml(merged).trimEnd();
		await this.app.vault.modify(file, `---\n${newYaml}\n---${body}`);
	}

	/**
	 * Try to parse a field value string as YAML so arrays like "[a, b]"
	 * and booleans/numbers work correctly. Falls back to raw string.
	 */
	private parseFieldValue(value: string): unknown {
		try {
			const parsed = parseYaml(value);
			// parseYaml returns the input string if it can't parse — avoid that
			return parsed !== value ? parsed : value;
		} catch {
			return value;
		}
	}

	// ─── Path resolution ──────────────────────────────────────────────────────

	private resolveNewNotePath(linkText: string, sourcePath: string): string {
		const name = (linkText.split('|')[0] ?? linkText).trim();

		const config = (this.app.vault as any).config as {
			newFileLocation?: string;
			newFileFolderPath?: string;
		};

		if (config.newFileLocation === 'folder' && config.newFileFolderPath) {
			return `${config.newFileFolderPath}/${name}.md`;
		}
		if (config.newFileLocation === 'current') {
			const dir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
			return dir ? `${dir}/${name}.md` : `${name}.md`;
		}
		return `${name}.md`;
	}

	// ─── Linter ───────────────────────────────────────────────────────────────

	private async runLinter(): Promise<void> {
		try {
			await new Promise((r) => setTimeout(r, 100));
			(this.app as any).commands.executeCommandById(
				'obsidian-linter:lint-file',
			);
		} catch {
			// Linter not installed — ignore
		}
	}

	// ─── Templater ────────────────────────────────────────────────────────────

	private async applyTemplaterTemplate(
		file: TFile,
		templatePath: string,
	): Promise<void> {
		const templater =
			(this.app as any).plugins?.plugins?.['templater-obsidian'];
		if (!templater) return;

		const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
		if (!(templateFile instanceof TFile)) return;

		try {
			await templater.templater.append_template_to_active_file(templateFile);
		} catch {
			// Templater API may vary — fail silently
		}
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<InheritSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

		// Migrate old inject format (Record<string,string>) to InjectField[]
		for (const rule of this.settings.rules) {
			if (rule.inject && !Array.isArray(rule.inject)) {
				rule.inject = Object.entries(
					rule.inject as unknown as Record<string, string>,
				).map(([key, value]) => ({ key, value, strategy: 'overwrite' as const }));
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
