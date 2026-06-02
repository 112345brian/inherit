import { App, Notice, Plugin, TFile, stringifyYaml } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	FieldRule,
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
		// Only act on the frontmatter / properties block
		const propertiesEl = el.querySelector('.metadata-container');
		if (!propertiesEl) return;

		this.attachButtons(propertiesEl as HTMLElement, ctx.sourcePath);
	}

	// ─── Button attachment ────────────────────────────────────────────────────

	/**
	 * Walk the rendered properties block, find internal links inside watched
	 * fields, and attach a ⊕ button to unresolved ones (and optionally resolved).
	 */
	attachButtons(container: HTMLElement, sourcePath: string) {
		const watchedFields = new Set(
			this.settings.rules.map((r) => r.field.toLowerCase()),
		);
		if (watchedFields.size === 0) return;

		// Each property row looks like:
		//   .metadata-property[data-property-key="person"]
		//     .metadata-property-value
		//       .multi-select-container | .metadata-link-inner a.internal-link
		const rows = container.querySelectorAll('.metadata-property');
		rows.forEach((row) => {
			const key = row
				.getAttribute('data-property-key')
				?.toLowerCase();
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

				// Skip if button already attached
				if (anchor.parentElement?.querySelector('.inherit-create-btn'))
					return;

				const resolved = this.app.metadataCache.getFirstLinkpathDest(
					linkText,
					sourcePath,
				);

				// Show button for unresolved links (note doesn't exist yet)
				// For resolved links that are missing expected fields, we could
				// optionally patch — for now just unresolved.
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

		// Resolve target path
		const targetPath = this.resolveNewNotePath(linkText, sourcePath);

		// Build frontmatter
		const fm: Record<string, unknown> = {};

		// 1. Fields to always inherit from source
		for (const field of this.settings.alwaysInherit) {
			if (sourceMeta[field] !== undefined) {
				fm[field] = sourceMeta[field];
			}
		}

		// 2. Rule-specific injected fields
		for (const [k, v] of Object.entries(rule.inject)) {
			fm[k] = v;
		}

		// 3. `up` pointing back to source
		if (rule.inheritUp) {
			fm['up'] = `[[${sourceFile.basename}]]`;
		}

		const yaml = stringifyYaml(fm).trimEnd();
		const content = `---\n${yaml}\n---\n\n# ${linkText}\n`;

		// Create the file
		try {
			const newFile = await this.app.vault.create(targetPath, content);

			// Apply Templater template if configured
			if (rule.templatePath) {
				await this.applyTemplaterTemplate(newFile, rule.templatePath);
			}

			new Notice(`Created: ${linkText}`);
		} catch (err) {
			new Notice(`Inherit: failed to create note — ${(err as Error).message}`);
		}
	}

	/**
	 * Resolve where to create the new note. Uses Obsidian's "new file location"
	 * setting so it respects the user's vault defaults.
	 */
	private resolveNewNotePath(linkText: string, sourcePath: string): string {
		// Strip any alias (e.g. [[John Smith|John]])
		const name = (linkText.split('|')[0] ?? linkText).trim();

		// Use Obsidian's attachment/new-file folder config if available
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
		// default: vault root
		return `${name}.md`;
	}

	/**
	 * Attempt to apply a Templater template via its exposed API.
	 * Fails silently if Templater is not installed.
	 */
	private async applyTemplaterTemplate(
		file: TFile,
		templatePath: string,
	): Promise<void> {
		const templater = (this.app as any).plugins?.plugins?.['templater-obsidian'];
		if (!templater) return;

		const templateFile =
			this.app.vault.getAbstractFileByPath(templatePath);
		if (!(templateFile instanceof TFile)) return;

		try {
			await templater.templater.append_template_to_active_file(
				templateFile,
			);
		} catch {
			// Templater API may vary — fail silently
		}
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<InheritSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
