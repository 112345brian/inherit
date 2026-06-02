import { parseYaml, stringifyYaml } from 'obsidian';
import { InjectField } from './settings';

export type FieldOrigin = 'inject' | 'template' | 'inherit' | 'up';

export interface MergedField {
	key: string;
	value: unknown;
	origin: FieldOrigin;
	strategy?: string; // only set for inject fields
}

export interface DryRunResult {
	fields: MergedField[];
	yaml: string;
}

/**
 * Pure merge function — no file I/O.
 * Simulates exactly what createNote + applyInjectFields does.
 *
 * @param sourceFm    Frontmatter of the source note (for always-inherit fields)
 * @param templateFm  Frontmatter that Templater would produce (may be empty)
 * @param injectFields  Rule inject fields with strategies
 * @param alwaysInherit  Global always-inherit field names
 * @param inheritUp   Whether to set `up` pointing to source
 * @param sourceName  Basename of the source note (for `up` value)
 */
export function runMerge(
	sourceFm: Record<string, unknown>,
	templateFm: Record<string, unknown>,
	injectFields: InjectField[],
	alwaysInherit: string[],
	inheritUp: boolean,
	sourceName: string,
): DryRunResult {
	const fields: MergedField[] = [];
	const merged: Record<string, unknown> = {};

	// 1. Template frontmatter is the starting point
	for (const [k, v] of Object.entries(templateFm)) {
		merged[k] = v;
		fields.push({ key: k, value: v, origin: 'template' });
	}

	// 2. Always-inherited fields from source (overwrite template if present)
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

	// 3. `up` field
	if (inheritUp) {
		const upVal = `[[${sourceName}]]`;
		const existing = fields.find((f) => f.key === 'up');
		if (existing) {
			existing.value = upVal;
			existing.origin = 'up';
		} else {
			fields.push({ key: 'up', value: upVal, origin: 'up' });
		}
		merged['up'] = upVal;
	}

	// 4. Inject fields with conflict resolution
	for (const field of injectFields) {
		if (!field.key) continue;
		const incoming = parseFieldValue(field.value);
		const existing = merged[field.key];
		const existingFieldEntry = fields.find((f) => f.key === field.key);

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
					if (existing !== undefined && !arr.includes(existing)) {
						arr.unshift(existing);
					}
					resolved = arr;
				} else {
					resolved = incoming;
				}
				break;

			default:
				resolved = incoming;
		}

		merged[field.key] = resolved;

		if (existingFieldEntry) {
			existingFieldEntry.value = resolved;
			existingFieldEntry.origin = 'inject';
			existingFieldEntry.strategy = field.strategy;
		} else {
			fields.push({
				key: field.key,
				value: resolved,
				origin: 'inject',
				strategy: field.strategy,
			});
		}
	}

	// Rebuild yaml from merged (preserves correct ordering)
	const orderedMerged: Record<string, unknown> = {};
	for (const f of fields) {
		orderedMerged[f.key] = f.value;
	}
	const yaml = quoteWikilinks(stringifyYaml(orderedMerged).trimEnd());

	return { fields, yaml };
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
 * stringifyYaml doesn't quote strings that start with `[[`, which YAML
 * interprets as a nested flow sequence. Fix any such values after the fact.
 *
 * Handles both scalar lines:  `up: [[Note Name]]`
 * and list items:             `  - [[Note Name]]`
 */
export function quoteWikilinks(yaml: string): string {
	return yaml.replace(
		/^(\s*(?:[-\w][\w\s-]*:\s*|[-]\s*))(\[\[.+?\]\])(\s*)$/gm,
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
