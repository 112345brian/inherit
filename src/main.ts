import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	FieldRule,
	InheritSettings,
	InheritSettingTab,
} from './settings';
import { runMerge, parseFrontmatterString, serializeFrontmatter } from './merge';

export default class InheritPlugin extends Plugin {
	settings!: InheritSettings;
	private observer: MutationObserver | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new InheritSettingTab(this.app, this));

		// Attach buttons whenever the active leaf changes or layout updates
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.refreshButtons()),
		);
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.refreshButtons()),
		);
		// Re-run when metadata changes (e.g. user adds a new link)
		this.registerEvent(
			this.app.metadataCache.on('changed', () => this.refreshButtons()),
		);

		// MutationObserver catches the properties panel rendering after the view
		// has loaded — it often renders slightly after layout-change fires
		this.observer = new MutationObserver(() => this.refreshButtons());
		this.observer.observe(document.body, { childList: true, subtree: true });

		// Run once on load in case a note is already open
		this.app.workspace.onLayoutReady(() => this.refreshButtons());
	}

	onunload() {
		this.observer?.disconnect();
	}

	// ─── Button refresh ───────────────────────────────────────────────────────

	private refreshButtons() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) return;

		// The properties panel lives inside the view's container, not the
		// rendered markdown — query the full containerEl directly
		const container = view.containerEl.querySelector('.metadata-container');
		if (!container) return;

		this.attachButtons(container as HTMLElement, view.file.path);
	}

	// ─── Button attachment ────────────────────────────────────────────────────

	private attachButtons(container: HTMLElement, sourcePath: string) {
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

			// Properties panel can render links as:
			//   a.internal-link               (text/link type fields)
			//   .multi-select-pill            (list type — link text is the content)
			// Try both
			const anchors = Array.from(row.querySelectorAll('a.internal-link'));
			const pills = Array.from(
				row.querySelectorAll('.multi-select-pill:not(:has(.inherit-create-btn))'),
			);

			// Handle anchor links
			for (const link of anchors) {
				const anchor = link as HTMLAnchorElement;
				if (anchor.querySelector('.inherit-create-btn')) continue;
				const linkText =
					anchor.getAttribute('data-href') ||
					anchor.textContent?.trim() ||
					'';
				if (!linkText) continue;
				if (!this.isUnresolved(linkText, sourcePath)) continue;
				this.attachButtonToAnchor(anchor, linkText, sourcePath, rule);
			}

			// Handle list-type pills (e.g. people: [[mama-yo]])
			for (const pill of pills) {
				if (pill.querySelector('.inherit-create-btn')) continue;
				// The pill may contain an anchor or just text
				const anchor = pill.querySelector('a.internal-link') as HTMLAnchorElement | null;
				const linkText = anchor
					? (anchor.getAttribute('data-href') || anchor.textContent?.trim() || '')
					: (pill.querySelector('.multi-select-pill-content')?.textContent?.trim() || '');
				if (!linkText) continue;
				if (!this.isUnresolved(linkText, sourcePath)) continue;
				this.attachButtonToPill(pill as HTMLElement, linkText, sourcePath, rule);
			}
		});
	}

	private isUnresolved(linkText: string, sourcePath: string): boolean {
		return !this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
	}

	private attachButtonToAnchor(
		anchor: HTMLAnchorElement,
		linkText: string,
		sourcePath: string,
		rule: FieldRule,
	) {
		const wrapper = anchor.parentElement!;
		wrapper.style.display = 'inline-flex';
		wrapper.style.alignItems = 'center';
		wrapper.style.gap = '4px';
		this.createBtn(wrapper, linkText, sourcePath, rule);
	}

	private attachButtonToPill(
		pill: HTMLElement,
		linkText: string,
		sourcePath: string,
		rule: FieldRule,
	) {
		// Insert before the existing × delete button if present
		const deleteBtn = pill.querySelector('.multi-select-pill-remove-button');
		const btn = this.createBtn(null, linkText, sourcePath, rule);
		if (deleteBtn) {
			pill.insertBefore(btn, deleteBtn);
		} else {
			pill.appendChild(btn);
		}
	}

	private createBtn(
		parent: HTMLElement | null,
		linkText: string,
		sourcePath: string,
		rule: FieldRule,
	): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.className = 'inherit-create-btn';
		btn.setAttribute('aria-label', `Create note: ${linkText}`);
		btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;

		btn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			await this.createNote(linkText, sourcePath, rule);
			btn.remove();
		});

		if (parent) parent.appendChild(btn);
		return btn;
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
		const content = '';

		try {
			const newFile = await this.app.vault.create(targetPath, content);

			// 1. Templater — needs the file to be active
			if (rule.templatePath) {
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile, { state: { mode: 'source' } });
				await new Promise((r) => setTimeout(r, 150));
				await this.applyTemplaterTemplate(newFile, rule.templatePath);
				// Navigate back so the note doesn't stay open
				await this.app.workspace.getLeaf(false).openFile(sourceFile);
			}

			// 2. Linter — use internal API directly on the file (no need to open)
			await this.runLinter(newFile);
			await new Promise((r) => setTimeout(r, 600));

			// 3. Our fields last — reads whatever Templater+Linter wrote
			await this.applyInjectFields(newFile, sourceMeta, sourceFile.basename, rule);

			new Notice(`Created: ${linkText}`);
		} catch (err) {
			new Notice(`Inherit: failed to create note — ${(err as Error).message}`);
		}
	}

	private async applyInjectFields(
		file: TFile,
		sourceFm: Record<string, unknown>,
		sourceBasename: string,
		rule: FieldRule,
	): Promise<void> {
		const raw = await this.app.vault.read(file);
		const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
		const currentFm = parseFrontmatterString(fmMatch?.[1] ?? '');
		const body = fmMatch
			? raw.slice(fmMatch[0].length).trimStart()
			: raw.trimStart();

		const { merged } = runMerge(
			sourceFm,
			currentFm,
			rule.inject,
			this.settings.alwaysInherit,
			rule.inheritUp,
			sourceBasename,
		);

		const yaml = serializeFrontmatter(merged);
		await this.app.vault.modify(file, `---\n${yaml}\n---\n\n${body}`);
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

	private async runLinter(file: TFile): Promise<void> {
		try {
			const linter = (this.app as any).plugins?.plugins?.['obsidian-linter'];
			if (!linter) return;
			// runLinterFile works directly on a file without it being active
			await linter.runLinterFile(file);
		} catch {
			// Linter not installed or API changed — ignore
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
			// Templater API may vary — ignore
		}
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<InheritSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

		for (const rule of this.settings.rules) {
			if (rule.inject && !Array.isArray(rule.inject)) {
				rule.inject = Object.entries(
					rule.inject as unknown as Record<string, string>,
				).map(([key, value]) => ({
					key,
					value,
					strategy: 'overwrite' as const,
				}));
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
