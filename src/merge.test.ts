import { runMerge, serializeFrontmatter, parseFrontmatterString } from './merge';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jsyaml = require('js-yaml');

// Obsidian shims
(globalThis as any).parseYaml = (s: string) => jsyaml.load(s);
(globalThis as any).stringifyYaml = (obj: unknown) => jsyaml.dump(obj);

// ─── Simulate the full write pipeline ────────────────────────────────────────
//
// What actually happens on disk:
//   1. Linter (or other plugins) may run first and write their own frontmatter
//   2. We read the file back with vault.read
//   3. We parse any existing frontmatter
//   4. We run runMerge to compute the final merged object
//   5. We write with serializeFrontmatter (our own serializer — NOT Obsidian's)
//
// This function simulates steps 2-5.

function simulateWrite(
	existingFileContent: string,
	sourceFm: Record<string, unknown>,
	sourceBasename: string,
): string {
	const fmMatch = existingFileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	const currentFm = parseFrontmatterString(fmMatch?.[1] ?? '');
	const body = fmMatch
		? existingFileContent.slice(fmMatch[0].length).trimStart()
		: existingFileContent.trimStart();

	const { merged } = runMerge(sourceFm, currentFm, [], [], true, sourceBasename);
	const yaml = serializeFrontmatter(merged);
	return `---\n${yaml}\n---\n\n${body}`;
}

// ─── Contract: exact file content ────────────────────────────────────────────

test('produces correct file content: up is quoted wikilink, not nested sequence', () => {
	// Simulate what the file looks like after Linter has already run and
	// added date fields (which is what we see in practice)
	const fileAfterLinter = `---
date-created: 2026-06-02T11:28:09
date-modified: 2026-06-02T11:28:09
---

# yo-mama
`;

	const result = simulateWrite(fileAfterLinter, {}, 'person');

	// Must contain a properly quoted wikilink
	expect(result).toContain('up: "[[person]]"');

	// Must NOT contain the broken nested sequence
	expect(result).not.toContain('- - ');
	expect(result).not.toContain('- - person');

	// Heading must be preserved
	expect(result).toContain('# yo-mama');

	// Date fields from Linter must be preserved
	expect(result).toContain('date-created:');
	expect(result).toContain('date-modified:');
});

test('up wikilink round-trips correctly through parse/serialize cycle', () => {
	const result = simulateWrite('# yo-mama\n', {}, 'person');

	// Parse the frontmatter back out
	const fmBlock = result.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
	const parsed = jsyaml.load(fmBlock) as Record<string, unknown>;

	// After parsing, up must be the string [[person]], not [["person"]]
	expect(parsed['up']).toBe('[[person]]');
	expect(Array.isArray(parsed['up'])).toBe(false);
});

test('inject overwrite wins over existing frontmatter', () => {
	const existing = `---\ntype: thing\n---\n\n# note\n`;
	const { merged } = runMerge(
		{},
		parseFrontmatterString('type: thing'),
		[{ key: 'type', value: 'person', strategy: 'overwrite' }],
		[],
		false,
		'source',
	);
	expect(merged['type']).toBe('person');
});

test('inject keep does not overwrite existing value', () => {
	const { merged } = runMerge(
		{},
		parseFrontmatterString('type: thing'),
		[{ key: 'type', value: 'person', strategy: 'keep' }],
		[],
		false,
		'source',
	);
	expect(merged['type']).toBe('thing');
});

test('inject merge combines arrays', () => {
	const { merged } = runMerge(
		{},
		parseFrontmatterString('tags:\n  - academic'),
		[{ key: 'tags', value: '[research]', strategy: 'merge' }],
		[],
		false,
		'source',
	);
	const tags = merged['tags'] as string[];
	expect(tags).toContain('academic');
	expect(tags).toContain('research');
});

test('alwaysInherit wikilink round-trips correctly', () => {
	const { merged } = runMerge(
		{ course: '[[My Course]]' },
		{},
		[],
		['course'],
		false,
		'source',
	);
	const yaml = serializeFrontmatter(merged);
	expect(yaml).toContain('course: "[[My Course]]"');

	// Parse back
	const parsed = jsyaml.load(yaml) as Record<string, unknown>;
	expect(parsed['course']).toBe('[[My Course]]');
});
