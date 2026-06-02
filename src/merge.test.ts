import { runMerge } from './merge';

// Minimal Obsidian shims for the test environment
(globalThis as any).parseYaml = (s: string) => {
	// Very small YAML parser sufficient for test assertions
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return require('js-yaml').load(s);
};
(globalThis as any).stringifyYaml = (obj: unknown) => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return require('js-yaml').dump(obj);
};

// ─── The contract ─────────────────────────────────────────────────────────────

test('basic note creation with inheritUp produces quoted wikilink', () => {
	const { merged } = runMerge(
		{},        // sourceFm
		{},        // templateFm (nothing from Templater)
		[],        // inject fields
		[],        // alwaysInherit
		true,      // inheritUp
		'person',  // sourceName
	);

	// up should be a scalar string — processFrontMatter quotes scalar
	// wikilinks correctly; arrays with wikilinks are not quoted
	expect(merged['up']).toBe('[[person]]');
	expect(merged['up']).not.toEqual(expect.arrayContaining([expect.anything()]));
});

test('inject field with overwrite wins over template', () => {
	const { yaml } = runMerge(
		{},
		{ type: 'thing' },
		[{ key: 'type', value: 'person', strategy: 'overwrite' }],
		[],
		false,
		'source',
	);
	expect(yaml).toContain('type: person');
	expect(yaml).not.toContain('thing');
});

test('inject field with keep does not overwrite template value', () => {
	const { yaml } = runMerge(
		{},
		{ type: 'thing' },
		[{ key: 'type', value: 'person', strategy: 'keep' }],
		[],
		false,
		'source',
	);
	expect(yaml).toContain('type: thing');
	expect(yaml).not.toContain('person');
});

test('inject field with merge combines arrays', () => {
	const { yaml } = runMerge(
		{},
		{ tags: ['academic'] },
		[{ key: 'tags', value: '[research]', strategy: 'merge' }],
		[],
		false,
		'source',
	);
	expect(yaml).toContain('academic');
	expect(yaml).toContain('research');
});

test('alwaysInherit copies field from source', () => {
	const { yaml } = runMerge(
		{ course: '[[My Course]]' },
		{},
		[],
		['course'],
		false,
		'source',
	);
	expect(yaml).toContain('course:');
	expect(yaml).toContain('"[[My Course]]"');
});
