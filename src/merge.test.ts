import { runMerge } from './merge';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml');

// Obsidian shims
(globalThis as any).parseYaml = (s: string) => yaml.load(s);
(globalThis as any).stringifyYaml = (obj: unknown) => yaml.dump(obj);

// ─── Simulate processFrontMatter ──────────────────────────────────────────────
//
// processFrontMatter:
//   1. Parses the file's current frontmatter into a JS object (currentFm)
//   2. Calls our callback with currentFm — we mutate it
//   3. Serializes currentFm back to YAML with js-yaml and writes to disk
//
// This function simulates steps 1-3 so we can assert the final file content.

function simulateProcessFrontMatter(
	existingFmYaml: string,
	callback: (fm: Record<string, unknown>) => void,
): string {
	// Step 1: parse existing frontmatter (empty object if none)
	const fm: Record<string, unknown> =
		existingFmYaml.trim()
			? (yaml.load(existingFmYaml) as Record<string, unknown>) ?? {}
			: {};

	// Step 2: our callback mutates fm
	callback(fm);

	// Step 3: serialize back — this is exactly what Obsidian does
	const serialized: string = yaml.dump(fm);
	return `---\n${serialized}---`;
}

// ─── Contract tests ───────────────────────────────────────────────────────────

test('full pipeline: up wikilink is valid YAML and round-trips correctly', () => {
	const { merged } = runMerge({}, {}, [], [], true, 'person');

	const fileContent = simulateProcessFrontMatter('', (fm) => {
		for (const [k, v] of Object.entries(merged)) fm[k] = v;
	});

	// Must not produce the broken nested-sequence form
	expect(fileContent).not.toContain('- - ');
	expect(fileContent).not.toContain('- - person');

	// Parse back — round-trip must give us the wikilink string
	const fmBlock = fileContent.match(/^---\n([\s\S]*?)---/)?.[1] ?? '';
	const parsed = yaml.load(fmBlock) as Record<string, unknown>;
	expect(parsed['up']).toBe('[[person]]');
});

test('full pipeline: final file content matches expected', () => {
	const { merged } = runMerge({}, {}, [], [], true, 'person');

	const frontmatter = simulateProcessFrontMatter('', (fm) => {
		for (const [k, v] of Object.entries(merged)) fm[k] = v;
	});

	const file = `${frontmatter}\n\n# mama-yo\n`;

	// Parse the frontmatter out and check up
	const fmBlock = file.match(/^---\n([\s\S]*?)---/)?.[1] ?? '';
	const parsed = yaml.load(fmBlock) as Record<string, unknown>;
	expect(parsed['up']).toBe('[[person]]');
	expect(file).toContain('# mama-yo');
	expect(file).not.toContain('- - ');
});

test('inject overwrite wins over template', () => {
	const { merged } = runMerge(
		{},
		{ type: 'thing' },
		[{ key: 'type', value: 'person', strategy: 'overwrite' }],
		[],
		false,
		'source',
	);
	expect(merged['type']).toBe('person');
});

test('inject keep does not overwrite template value', () => {
	const { merged } = runMerge(
		{},
		{ type: 'thing' },
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
		{ tags: ['academic'] },
		[{ key: 'tags', value: '[research]', strategy: 'merge' }],
		[],
		false,
		'source',
	);
	const tags = merged['tags'] as string[];
	expect(tags).toContain('academic');
	expect(tags).toContain('research');
});

test('alwaysInherit copies wikilink from source and round-trips', () => {
	const { merged } = runMerge(
		{ course: '[[My Course]]' },
		{},
		[],
		['course'],
		false,
		'source',
	);

	const fileContent = simulateProcessFrontMatter('', (fm) => {
		for (const [k, v] of Object.entries(merged)) fm[k] = v;
	});

	const fmBlock = fileContent.match(/^---\n([\s\S]*?)---/)?.[1] ?? '';
	const parsed = yaml.load(fmBlock) as Record<string, unknown>;
	expect(parsed['course']).toBe('[[My Course]]');
});
