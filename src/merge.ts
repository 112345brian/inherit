import { parseYaml, stringifyYaml } from 'obsidian';
import { InjectField } from './settings';

export type FieldOrigin = 'inject' | 'template' | 'inherit' | 'up';

export interface MergedField {
	key: string;
	value: unknown;
	origin: FieldOrigin;
	strategy?: string;
}

export interface MergeResult {
	fields: MergedField[];
	/** Merged object — use with processFrontMatter for actual writes */
	merged: Record<string, unknown>;
	/** YAML string — for dry run display only */
	yaml: string;
}

/**
 * Pure merge function — no file I/O.
 *
 * Returns both the merged JS object (for use with processFrontMatter)
 * and a YAML string (for dry run preview display only).
 */
export function runMerge(
	sourceFm: Record<string, unknown>,
	templateFm: Record<string, unknown>,
	injectFields: InjectField[],
	alwaysInherit: string[],
	inheritUp: boolean,
	sourceName: string,
): MergeResult {
	const fields: MergedField[] = [];
	const merged: Record<string, unknown> = {};

	// 1. Template frontmatter is the starting point
	for (const [k, v] of Object.entries(templateFm)) {
		merged[k] = v;
		fields.push({ key: k, value: v, origin: 'template' });
	}

	// 2. Always-inherited fields from source
	for (const field of alwaysInherit) {
		if (sourceFm[field] !== undefined) {
			const existing = fields.find((f) => f.key === field);
			if (existing) {
				existing.value = sourceFm[field];
				existing.origin = 'inherit';
			} else {
				fields.push({ key: field, value: sourceFm[field], origin: 'inherit' });
			}
			merged[field] = sourceFm[field];
		}
	}

	// 3. `up` — stored as array for Breadcrumbs compatibility
	if (inheritUp) {
		const upVal = `[[${sourceName}]]`;
		const existing = fields.find((f) => f.key === 'up');
		if (existing) {
			existing.value = [upVal];
			existing.origin = 'up';
		} else {
			fields.push({ key: 'up', value: [upVal], origin: 'up' });
		}
		merged['up'] = [upVal];
	}

	// 4. Inject fields with conflict resolution
	for (const field of injectFields) {
		if (!field.key) continue;
		const incoming = parseFieldValue(field.value);
		const existing = merged[field.key];
		const existingEntry = fields.find((f) => f.key === field.key);

		let resolved: unknown;
		switch (field.strategy) {
			case 'overwrite':
				resolved = incoming;
				break;
			case 'keep':
				resolved =
					existing === undefined || existing === null || existing === ''
						? incoming
						: existing;
				break;
			case 'merge':
				if (Array.isArray(existing) && Array.isArray(incoming)) {
					resolved = [...new Set([...existing, ...(incoming as unknown[])])];
				} else if (Array.isArray(existing)) {
					const arr = [...existing];
					if (!arr.includes(incoming)) arr.push(incoming);
					resolved = arr;
				} else if (Array.isArray(incoming)) {
					const arr = [...(incoming as unknown[])];
					if (existing !== undefined && !arr.includes(existing))
						arr.unshift(existing);
					resolved = arr;
				} else {
					resolved = incoming;
				}
				break;
			default:
				resolved = incoming;
		}

		merged[field.key] = resolved;
		if (existingEntry) {
			existingEntry.value = resolved;
			existingEntry.origin = 'inject';
			existingEntry.strategy = field.strategy;
		} else {
			fields.push({ key: field.key, value: resolved, origin: 'inject', strategy: field.strategy });
		}
	}

	// YAML is only used for dry run display — not for writing to disk.
	// quoteWikilinks is a best-effort fix for display purposes only.
	const orderedMerged: Record<string, unknown> = {};
	for (const f of fields) orderedMerged[f.key] = f.value;
	const yaml = quoteWikilinks(stringifyYaml(orderedMerged).trimEnd());

	return { fields, merged, yaml };
}

export function parseFieldValue(value: string): unknown {
	try {
		const parsed = parseYaml(value);
		return parsed !== value ? parsed : value;
	} catch {
		return value;
	}
}

/**
 * Best-effort fix for dry run YAML display.
 * NOT used for actual file writes — processFrontMatter handles that.
 */
export function quoteWikilinks(yaml: string): string {
	return yaml
		.replace(
			/^(\s*(?:[\w-][\w\s-]*:\s*|-\s+))'(\[\[.+?\]\])'(\s*)$/gm,
			'$1"$2"$3',
		)
		.replace(
			/^(\s*(?:[\w-][\w\s-]*:\s*|-\s+))(?!['"])(\[\[.+?\]\])(\s*)$/gm,
			'$1"$2"$3',
		);
}

export function parseFrontmatterString(raw: string): Record<string, unknown> {
	if (!raw.trim()) return {};
	try {
		const parsed = parseYaml(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Serialize a frontmatter object to a YAML string we fully control.
 * Does NOT use stringifyYaml — we need deterministic quoting of wikilinks.
 */
export function serializeFrontmatter(fm: Record<string, unknown>): string {
	return Object.entries(fm)
		.map(([key, value]) => serializeField(key, value))
		.join('\n');
}

function serializeField(key: string, value: unknown): string {
	if (Array.isArray(value)) {
		if (value.length === 0) return `${key}: []`;
		return `${key}:\n${value.map((item) => `  - ${serializeScalar(item)}`).join('\n')}`;
	}
	return `${key}: ${serializeScalar(value)}`;
}

function serializeScalar(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'boolean' || typeof value === 'number') return String(value);
	if (typeof value === 'string') {
		const needsQuoting =
			value === '' ||
			/^[[\]{}>|*&!%@`'"#]/.test(value) ||
			value.includes(': ') ||
			/^(true|false|null|~|\d)/.test(value);
		if (needsQuoting) return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
		return value;
	}
	return JSON.stringify(value);
}
