import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  buildCoverageReport,
  collectTestEvidence,
  dedent,
  describeMissingSpec,
  extractItBlocks,
  findSpecCandidates,
  findVcsRoot,
  loadSpec,
  operationKey,
  parseTestFile,
  resolveSpec,
  resolveSpecPath
} from '@/lib/api-test-coverage';

// The analyzer scans this repo's own *.test.ts files (as raw text) when
// auditing the bundled example, so every inline fixture below uses operations
// (/widgets, /gadgets) that do not exist in example/api/openapi.json — that
// keeps this file invisible to the generated proof.

const tmpRoots: string[] = [];

/** Materialize a fixture repo in a temp directory */
function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specproof-unit-'));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const savedSpecEnv = process.env.SPECPROOF_SPEC;
delete process.env.SPECPROOF_SPEC;

afterEach(() => {
  delete process.env.SPECPROOF_SPEC;
  while (tmpRoots.length > 0) {
    fs.rmSync(tmpRoots.pop()!, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (savedSpecEnv !== undefined) process.env.SPECPROOF_SPEC = savedSpecEnv;
});

describe('operationKey', () => {
  it('lowercases the method and keeps literal segments', () => {
    expect(operationKey('GET', '/widgets')).toBe('get /widgets');
  });

  it('treats {param}, [param], and :param segments as equivalent', () => {
    const key = operationKey('GET', '/widgets/{widgetId}');
    expect(operationKey('get', '/widgets/[widgetId]')).toBe(key);
    expect(operationKey('GET', '/widgets/:widgetId')).toBe(key);
  });

  it('normalizes params in any segment position', () => {
    expect(operationKey('PUT', '/a/{x}/b/[y]/:z')).toBe('put /a/{}/b/{}/{}');
  });

  it('ignores a trailing slash', () => {
    expect(operationKey('GET', '/widgets/')).toBe(operationKey('GET', '/widgets'));
  });
});

describe('dedent', () => {
  it('strips the common leading indentation', () => {
    expect(dedent('    a();\n      b();\n    c();')).toBe('a();\n  b();\nc();');
  });

  it('ignores blank lines when measuring the indent', () => {
    expect(dedent('    a();\n\n    b();')).toBe('a();\n\nb();');
  });
});

describe('extractItBlocks', () => {
  const segment = [
    'describe("GET /widgets", () => {',
    '  it("lists widgets", async () => {',
    '    const res = await api.get("/widgets");',
    '    expect(res.status).toBe(200);',
    '  });',
    '',
    "  test('rejects anonymous calls', async () => {",
    '    const res = await api.get("/widgets", { auth: false });',
    '    expect(res.status).toEqual(401);',
    '  });',
    '});'
  ].join('\n');

  it('finds it() and test() blocks across quote styles', () => {
    const blocks = extractItBlocks(segment, 0, segment);
    expect(blocks.map((b) => b.title)).toEqual(['lists widgets', 'rejects anonymous calls']);

    const backtick = 'describe("GET /widgets", () => {\n  it(`uses backticks`, () => {\n  });\n});';
    expect(extractItBlocks(backtick, 0, backtick)[0].title).toBe('uses backticks');
  });

  it('extracts statuses from both toBe and toEqual assertions', () => {
    const blocks = extractItBlocks(segment, 0, segment);
    expect(blocks[0].statuses).toEqual(['200']);
    expect(blocks[1].statuses).toEqual(['401']);
  });

  it('dedents the extracted source', () => {
    const blocks = extractItBlocks(segment, 0, segment);
    expect(blocks[0].source.startsWith('it("lists widgets"')).toBe(true);
    expect(blocks[0].source.endsWith('\n});')).toBe(true);
  });

  it('reports 1-indexed start lines, offset into the full source', () => {
    const blocks = extractItBlocks(segment, 0, segment);
    expect(blocks[0].startLine).toBe(2);
    expect(blocks[1].startLine).toBe(7);

    const prefix = '// header\n\n';
    const fullSource = prefix + segment;
    const shifted = extractItBlocks(segment, prefix.length, fullSource);
    expect(shifted[0].startLine).toBe(4);
  });

  it('skips nested closers at deeper indentation', () => {
    const nested = [
      'describe("POST /widgets", () => {',
      '  it("creates a widget", async () => {',
      '    await withRetry(async () => {',
      '      await api.post("/widgets");',
      '    });',
      '    expect(res.status).toBe(201);',
      '  });',
      '});'
    ].join('\n');
    const blocks = extractItBlocks(nested, 0, nested);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].statuses).toEqual(['201']);
    expect(blocks[0].source.endsWith('\n});')).toBe(true);
  });

  it('runs to the segment end when no closer matches', () => {
    const unclosed = 'describe("GET /widgets", () => {\n  it("dangles", () => {\n    expect(res.status).toBe(200);';
    const blocks = extractItBlocks(unclosed, 0, unclosed);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].statuses).toEqual(['200']);
  });
});

describe('parseTestFile', () => {
  it('keys evidence by operation and ignores non-operation describes', () => {
    const source = [
      'import { api } from "./client";',
      '',
      'describe("GET /widgets", () => {',
      '  it("lists widgets", async () => {',
      '    expect(res.status).toBe(200);',
      '  });',
      '});',
      '',
      'describe("widget helpers", () => {',
      '  it("is not an operation", () => {',
      '    expect(res.status).toBe(500);',
      '  });',
      '});',
      '',
      'describe("POST /widgets", () => {',
      '  it("creates twice", async () => {',
      '    expect(one.status).toBe(201);',
      '    expect(two.status).toBe(201);',
      '  });',
      '});'
    ].join('\n');

    const parsed = parseTestFile(source, 'tests/widgets.test.ts');
    expect([...parsed.keys()].sort()).toEqual(['get /widgets', 'post /widgets']);

    const get = parsed.get('get /widgets')!;
    expect(get.testFile).toBe('tests/widgets.test.ts');
    expect(get.testCount).toBe(1);
    expect([...get.statuses.entries()]).toEqual([['200', 1]]);

    // The 500 in the non-operation describe is attributed to nothing.
    const post = parsed.get('post /widgets')!;
    expect(post.statuses.has('500')).toBe(false);
    // Two assertions of the same status count twice, but the single it()
    // block yields one snippet.
    expect(post.statuses.get('201')).toBe(2);
    expect(post.snippets.get('201')).toHaveLength(1);
  });

  it('merges evidence when two describes name the same operation', () => {
    const source = [
      'describe("GET /gadgets", () => {',
      '  it("lists", async () => {',
      '    expect(res.status).toBe(200);',
      '  });',
      '});',
      'describe("GET /gadgets", () => {',
      '  it("paginates", async () => {',
      '    expect(res.status).toBe(206);',
      '  });',
      '});'
    ].join('\n');

    const parsed = parseTestFile(source, 'tests/gadgets.test.ts');
    const evidence = parsed.get('get /gadgets')!;
    expect(evidence.testCount).toBe(2);
    expect([...evidence.statuses.keys()].sort()).toEqual(['200', '206']);
  });

  it('files one it() asserting two statuses as a snippet under each', () => {
    const source = [
      'describe("DELETE /gadgets/{gadgetId}", () => {',
      '  it("deletes then 404s", async () => {',
      '    expect(first.status).toBe(204);',
      '    expect(second.status).toBe(404);',
      '  });',
      '});'
    ].join('\n');

    const evidence = parseTestFile(source, 'tests/gadgets.test.ts').get('delete /gadgets/{}')!;
    expect(evidence.snippets.get('204')![0].title).toBe('deletes then 404s');
    expect(evidence.snippets.get('404')![0].title).toBe('deletes then 404s');
  });

  it('counts assertions outside it() blocks but yields no snippet for them', () => {
    const source = [
      'describe("PATCH /gadgets/{gadgetId}", () => {',
      '  const conflict = (res) => expect(res.status).toBe(409);',
      '  it("renames a gadget", async () => {',
      '    expect(res.status).toBe(200);',
      '  });',
      '});'
    ].join('\n');

    const evidence = parseTestFile(source, 'tests/gadgets.test.ts').get('patch /gadgets/{}')!;
    expect(evidence.statuses.get('409')).toBe(1);
    expect(evidence.snippets.has('409')).toBe(false);
    expect(evidence.snippets.get('200')).toHaveLength(1);
  });
});

describe('resolveSpecPath', () => {
  it('picks the shallowest spec in the tree', () => {
    const root = makeRepo({
      'docs/openapi.json': '{}',
      'openapi.json': '{}'
    });
    expect(resolveSpecPath(root)).toBe(path.join(root, 'openapi.json'));
  });

  it('breaks equal-depth ties alphabetically', () => {
    const root = makeRepo({
      'b/openapi.json': '{}',
      'a/openapi.json': '{}'
    });
    expect(resolveSpecPath(root)).toBe(path.join(root, 'a/openapi.json'));
  });

  it('matches swagger-prefixed specs', () => {
    const root = makeRepo({ 'swagger-v2.json': '{}' });
    expect(resolveSpecPath(root)).toBe(path.join(root, 'swagger-v2.json'));
  });

  it('never looks inside excluded or dot directories', () => {
    const root = makeRepo({
      'node_modules/dep/openapi.json': '{}',
      '.hidden/openapi.json': '{}'
    });
    expect(resolveSpecPath(root)).toBeNull();
  });

  it('returns null for a nonexistent root', () => {
    expect(resolveSpecPath(path.join(os.tmpdir(), 'specproof-no-such-dir'))).toBeNull();
  });

  it('SPECPROOF_SPEC overrides discovery', () => {
    const root = makeRepo({
      'api/custom-spec.json': '{}',
      'openapi.json': '{}'
    });
    process.env.SPECPROOF_SPEC = 'api/custom-spec.json';
    expect(resolveSpecPath(root)).toBe(path.join(root, 'api/custom-spec.json'));
  });

  it('SPECPROOF_SPEC pointing at a missing file yields null, not a fallback', () => {
    const root = makeRepo({ 'openapi.json': '{}' });
    process.env.SPECPROOF_SPEC = 'missing.json';
    expect(resolveSpecPath(root)).toBeNull();
  });

  it('discovers YAML specs under either extension', () => {
    expect(resolveSpecPath(makeRepo({ 'openapi.yaml': 'paths: {}' }))).toMatch(/openapi\.yaml$/);
    expect(resolveSpecPath(makeRepo({ 'openapi.yml': 'paths: {}' }))).toMatch(/openapi\.yml$/);
    expect(resolveSpecPath(makeRepo({ 'swagger-v2.yaml': 'paths: {}' }))).toMatch(
      /swagger-v2\.yaml$/
    );
  });

  it('prefers a JSON sibling over YAML, so a converted copy keeps winning', () => {
    // The realistic layout for a repo that converts its spec: both files sit in
    // the same directory. Whichever we pick must be stable across runs.
    const root = makeRepo({
      'openapi.yaml': 'paths: {}',
      'openapi.json': '{}',
      'openapi.yml': 'paths: {}'
    });
    expect(resolveSpecPath(root)).toBe(path.join(root, 'openapi.json'));
  });

  it('still prefers a shallower YAML spec over a deeper JSON one', () => {
    const root = makeRepo({
      'openapi.yaml': 'paths: {}',
      'docs/api/openapi.json': '{}'
    });
    expect(resolveSpecPath(root)).toBe(path.join(root, 'openapi.yaml'));
  });

  it('SPECPROOF_SPEC can point at a YAML spec', () => {
    const root = makeRepo({
      'openapi.json': '{}',
      'docs/service.yaml': 'paths: {}'
    });
    process.env.SPECPROOF_SPEC = 'docs/service.yaml';
    expect(resolveSpecPath(root)).toBe(path.join(root, 'docs/service.yaml'));
  });

  it('findSpecCandidates exposes the runners-up behind the winner', () => {
    const root = makeRepo({
      'openapi.yaml': 'paths: {}',
      'openapi.json': '{}',
      'docs/openapi.json': '{}'
    });
    expect(findSpecCandidates(root).map((p) => path.relative(root, p))).toEqual([
      'openapi.json',
      'openapi.yaml',
      path.join('docs', 'openapi.json')
    ]);
  });
});

describe('loadSpec', () => {
  const jsonSpec = {
    openapi: '3.0.0',
    tags: [{ name: 'Widgets', description: 'Widget operations' }],
    paths: {
      '/widgets': {
        get: { summary: 'List widgets', responses: { '200': { description: 'OK' } } }
      }
    }
  };

  // Hand-written rather than round-tripped through the YAML serializer: the
  // point is to parse what a human actually checks in, including unquoted
  // status codes (YAML integers, not strings).
  const yamlSpec = [
    'openapi: 3.0.0',
    'tags:',
    '  - name: Widgets',
    '    description: Widget operations',
    'paths:',
    '  /widgets:',
    '    get:',
    '      summary: List widgets',
    '      responses:',
    '        200:',
    '          description: OK',
    ''
  ].join('\n');

  it('parses YAML into the same document as the equivalent JSON', () => {
    const root = makeRepo({ 'openapi.json': JSON.stringify(jsonSpec), 'openapi.yaml': yamlSpec });
    expect(loadSpec(path.join(root, 'openapi.yaml'))).toEqual(
      loadSpec(path.join(root, 'openapi.json'))
    );
  });

  it('reads unquoted YAML status codes as string keys', () => {
    const root = makeRepo({ 'openapi.yaml': yamlSpec });
    const responses = loadSpec(path.join(root, 'openapi.yaml')).paths!['/widgets'].get.responses!;
    expect(Object.keys(responses)).toEqual(['200']);
  });

  it('accepts the .yml extension', () => {
    const root = makeRepo({ 'openapi.yml': yamlSpec });
    expect(Object.keys(loadSpec(path.join(root, 'openapi.yml')).paths!)).toEqual(['/widgets']);
  });

  it('tolerates a UTF-8 BOM in either format', () => {
    const root = makeRepo({
      'openapi.yaml': '\uFEFF' + yamlSpec,
      'openapi.json': '\uFEFF' + JSON.stringify(jsonSpec)
    });
    expect(() => loadSpec(path.join(root, 'openapi.yaml'))).not.toThrow();
    expect(() => loadSpec(path.join(root, 'openapi.json'))).not.toThrow();
  });

  it('sniffs the format when the extension says nothing (SPECPROOF_SPEC can point anywhere)', () => {
    const root = makeRepo({
      'spec-as-yaml.txt': yamlSpec,
      'spec-as-json.txt': JSON.stringify(jsonSpec)
    });
    expect(loadSpec(path.join(root, 'spec-as-yaml.txt'))).toEqual(
      loadSpec(path.join(root, 'spec-as-json.txt'))
    );
  });

  it('reports malformed YAML with the file it came from', () => {
    const root = makeRepo({ 'openapi.yaml': 'paths:\n  /widgets:\n   get:\n  bad: [1,\n' });
    expect(() => loadSpec(path.join(root, 'openapi.yaml'))).toThrow(
      /could not parse .*openapi\.yaml as YAML/
    );
  });

  it('reports malformed JSON the same way', () => {
    const root = makeRepo({ 'openapi.json': '{ "paths": ' });
    expect(() => loadSpec(path.join(root, 'openapi.json'))).toThrow(
      /could not parse .*openapi\.json as JSON/
    );
  });

  it('rejects duplicate YAML keys instead of silently keeping one', () => {
    const root = makeRepo({
      'openapi.yaml': ['paths:', '  /widgets:', '    get: {}', '    get: {}', ''].join('\n')
    });
    expect(() => loadSpec(path.join(root, 'openapi.yaml'))).toThrow(/could not parse/);
  });

  it('rejects a document that is not an object', () => {
    const root = makeRepo({ 'openapi.yaml': '', 'swagger.yaml': '- just\n- a list\n' });
    expect(() => loadSpec(path.join(root, 'openapi.yaml'))).toThrow(/not an OpenAPI document/);
    expect(() => loadSpec(path.join(root, 'swagger.yaml'))).toThrow(/not an OpenAPI document/);
  });

  it('rejects a paths value that is not an object', () => {
    const root = makeRepo({ 'openapi.yaml': 'paths: not-a-map\n' });
    expect(() => loadSpec(path.join(root, 'openapi.yaml'))).toThrow(/"paths" value that is not/);
  });
});

const widgetDescribe = (title: string, its: Array<[string, string]>) =>
  [
    `describe("${title}", () => {`,
    ...its.flatMap(([name, status]) => [
      `  it("${name}", async () => {`,
      `    expect(res.status).toBe(${status});`,
      '  });'
    ]),
    '});'
  ].join('\n');

describe('collectTestEvidence', () => {
  it('lets the file with the most it() blocks win an operation', () => {
    const root = makeRepo({
      'tests/rich.test.ts': widgetDescribe('GET /widgets', [
        ['lists', '200'],
        ['rejects', '401']
      ]),
      'tests/poor.test.ts': widgetDescribe('GET /widgets', [['lists', '200']])
    });
    const evidence = collectTestEvidence(root).get('get /widgets')!;
    expect(evidence.testFile).toBe('tests/rich.test.ts');
    expect(evidence.testCount).toBe(2);
  });

  it('breaks ties in favor of the alphabetically first file', () => {
    const root = makeRepo({
      'tests/b.test.ts': widgetDescribe('GET /widgets', [['lists', '200']]),
      'tests/a.test.ts': widgetDescribe('GET /widgets', [['lists', '200']])
    });
    expect(collectTestEvidence(root).get('get /widgets')!.testFile).toBe('tests/a.test.ts');
  });
});

describe('buildCoverageReport', () => {
  const spec = {
    tags: [{ name: 'Widgets', description: 'Widget operations' }],
    paths: {
      '/widgets': {
        get: {
          summary: 'List widgets',
          tags: ['Widgets'],
          responses: {
            '200': { description: 'OK' },
            '401': { description: 'Unauthorized' }
          }
        },
        post: {
          tags: ['Widgets'],
          responses: { '201': { description: 'Created' } }
        }
      },
      '/widgets/{widgetId}': {
        delete: { tags: ['Admin'], responses: { '204': { description: 'Deleted' } } }
      },
      '/gadgets': {
        get: { responses: { '200': { description: 'OK' } } }
      }
    }
  };

  // The same document as `spec`, hand-written the way a repo would check it
  // in: unquoted status codes, block sequences, no quoting where YAML does not
  // demand it.
  const yamlSpec = [
    'tags:',
    '  - name: Widgets',
    '    description: Widget operations',
    'paths:',
    '  /widgets:',
    '    get:',
    '      summary: List widgets',
    '      tags:',
    '        - Widgets',
    '      responses:',
    '        200:',
    '          description: OK',
    '        401:',
    '          description: Unauthorized',
    '    post:',
    '      tags:',
    '        - Widgets',
    '      responses:',
    '        201:',
    '          description: Created',
    '  "/widgets/{widgetId}":',
    '    delete:',
    '      tags:',
    '        - Admin',
    '      responses:',
    '        204:',
    '          description: Deleted',
    '  /gadgets:',
    '    get:',
    '      responses:',
    '        200:',
    '          description: OK',
    ''
  ].join('\n');

  const testFiles = {
    'tests/widgets.test.ts': [
      widgetDescribe('GET /widgets', [['lists widgets', '200']]),
      widgetDescribe('POST /widgets', [
        ['creates a widget', '201'],
        ['rejects bad payloads', '422']
      ])
    ].join('\n'),
    // Trailing slash in the describe title still joins against /gadgets.
    'tests/gadgets.test.ts': widgetDescribe('GET /gadgets/', [['lists gadgets', '200']])
  };

  const fixtureRepo = () => makeRepo({ 'openapi.json': JSON.stringify(spec), ...testFiles });

  it('joins spec operations against test evidence and counts coverage', () => {
    const report = buildCoverageReport(fixtureRepo());

    expect(report.operationCount).toBe(4);
    expect(report.coveredCount).toBe(3);
    expect(report.totalCount).toBe(5);
    expect(report.untestedOperations).toBe(1);

    const widgets = report.tags.find((t) => t.tag === 'Widgets')!;
    const get = widgets.operations.find((op) => op.method === 'get')!;
    expect(get.summary).toBe('List widgets');
    expect(get.coveredCount).toBe(1);
    expect(get.gapCount).toBe(1);
    expect(get.testFile).toBe('tests/widgets.test.ts');
  });

  it('flags statuses the tests assert but the spec omits, sorted by code', () => {
    const report = buildCoverageReport(fixtureRepo());
    const post = report.tags
      .find((t) => t.tag === 'Widgets')!
      .operations.find((op) => op.method === 'post')!;

    expect(post.statuses.map((s) => s.code)).toEqual(['201', '422']);
    expect(post.statuses[1].documented).toBe(false);
    expect(post.statuses[1].assertions).toBe(1);
    // Undocumented statuses count toward neither coverage nor gaps.
    expect(post.coveredCount).toBe(1);
    expect(post.gapCount).toBe(0);
    expect(post.summary).toBe('');
  });

  it('joins param-style and trailing-slash variants of spec paths', () => {
    const report = buildCoverageReport(fixtureRepo());
    const gadgets = report.tags.find((t) => t.tag === 'Other')!.operations[0];
    expect(gadgets.testFile).toBe('tests/gadgets.test.ts');
    expect(gadgets.coveredCount).toBe(1);
  });

  it('orders tags by the spec, unknown tags last, untagged ops under Other', () => {
    const report = buildCoverageReport(fixtureRepo());
    expect(report.tags.map((t) => t.tag)).toEqual(['Widgets', 'Admin', 'Other']);
    expect(report.tags[0].description).toBe('Widget operations');
    expect(report.tags[1].description).toBe('');

    const del = report.tags[1].operations[0];
    expect(del.testFile).toBeNull();
    expect(del.testCount).toBe(0);
    expect(del.gapCount).toBe(1);
  });

  it('reports identically from a YAML spec and its JSON conversion', () => {
    // Both files in one repo, so the reports differ in nothing but the parser
    // that produced them (repoName is derived from the directory).
    const root = makeRepo({
      'openapi.json': JSON.stringify(spec),
      'openapi.yaml': yamlSpec,
      ...testFiles
    });

    process.env.SPECPROOF_SPEC = 'openapi.json';
    const fromJson = buildCoverageReport(root);
    process.env.SPECPROOF_SPEC = 'openapi.yaml';
    const fromYaml = buildCoverageReport(root);

    // Serialized, not merely deep-equal: the drift guard compares the proof
    // byte for byte, so converting a spec between formats must not so much as
    // reorder a key.
    expect(JSON.stringify(fromYaml, null, 2)).toBe(JSON.stringify(fromJson, null, 2));
    expect(fromYaml.operationCount).toBe(4);
    expect(fromYaml.tags.map((t) => t.tag)).toEqual(['Widgets', 'Admin', 'Other']);
  });

  it('throws when the repo has no spec to audit', () => {
    const root = makeRepo({ 'readme.md': 'nothing here' });
    expect(() => buildCoverageReport(root)).toThrow(/no OpenAPI spec found/);
  });

  it('surfaces a malformed spec as a parse error, not a silently empty report', () => {
    const root = makeRepo({ 'openapi.yaml': 'openapi: 3.0.0\npaths: { /widgets: \n' });
    expect(() => buildCoverageReport(root)).toThrow(/could not parse/);
  });
});

// ============================================================================
// Explicit --spec / SPECPROOF_SPEC anchoring (DEV-10)
// ============================================================================
//
// A relative --spec used to be resolved against the audited root only, and the
// audited root defaults to cwd. Running SpecProof from a package subdirectory
// therefore anchored "relative to the repo root" at the subdirectory, and the
// miss was reported as "no spec found at all", which is what made an absolute
// path look like the only thing that worked.

describe('findVcsRoot', () => {
  it('finds the enclosing .git directory from a nested start', () => {
    const root = fs.realpathSync(makeRepo({ '.git/config': '', 'packages/api/index.ts': '' }));
    expect(findVcsRoot(path.join(root, 'packages/api'))).toBe(root);
  });

  it('returns null when nothing above the start is a repo', () => {
    // os.tmpdir() itself is not inside a checkout, so the walk runs to /.
    const root = makeRepo({ 'packages/api/index.ts': '' });
    expect(findVcsRoot(path.join(root, 'packages/api'))).toBeNull();
  });
});

describe('explicit spec anchoring', () => {
  const savedCwd = process.cwd();
  afterEach(() => process.chdir(savedCwd));

  it('anchors a relative spec at the audited root first', () => {
    const root = makeRepo({ 'docs/openapi.json': '{}', 'other/docs/openapi.json': '{}' });
    process.env.SPECPROOF_SPEC = 'docs/openapi.json';
    expect(resolveSpecPath(root)).toBe(path.join(root, 'docs/openapi.json'));
  });

  it('falls back to the enclosing git root when the audited root is a subdirectory', () => {
    // The monorepo case: `cd packages/api && specproof generate --spec docs/openapi.json`,
    // where docs/ sits at the repo root, not in the package.
    const root = fs.realpathSync(
      makeRepo({ '.git/config': '', 'docs/openapi.json': '{}', 'packages/api/index.ts': '' })
    );
    const pkg = path.join(root, 'packages/api');
    process.chdir(pkg);
    process.env.SPECPROOF_SPEC = 'docs/openapi.json';
    expect(resolveSpecPath(pkg)).toBe(path.join(root, 'docs/openapi.json'));
  });

  it('reads a leading slash as repo-root-relative when no such absolute file exists', () => {
    // `--spec /api/openapi.json` is a natural way to write "from the repo
    // root"; taken literally it points at a filesystem path that never exists.
    const root = makeRepo({ 'api/openapi.json': '{}' });
    process.env.SPECPROOF_SPEC = '/api/openapi.json';
    expect(resolveSpecPath(root)).toBe(path.join(root, 'api/openapi.json'));
  });

  it('still prefers a genuine absolute path over the anchored reading', () => {
    // Both readings of the same value exist here: the real absolute file, and
    // the repo-root-anchored path built by stripping its leading separator.
    // The literal one has to win, or an absolute --spec would stop meaning
    // what it says.
    const outside = makeRepo({ 'openapi.json': '{"from":"outside"}' });
    const absolute = path.join(outside, 'openapi.json');
    const root = makeRepo({ [absolute.replace(/^[\\/]+/, '')]: '{"from":"inside"}' });
    process.env.SPECPROOF_SPEC = absolute;
    expect(resolveSpecPath(root)).toBe(absolute);
  });

  it('does not accept a directory as a spec', () => {
    const root = makeRepo({ 'openapi.json/keep': '' });
    process.env.SPECPROOF_SPEC = 'openapi.json';
    expect(resolveSpecPath(root)).toBeNull();
  });

  it('reports an unresolvable spec as missing-explicit, listing every path tried', () => {
    const root = makeRepo({ 'openapi.json': '{}' });
    process.env.SPECPROOF_SPEC = 'docs/nope.json';
    const resolution = resolveSpec(root);
    expect(resolution.kind).toBe('missing-explicit');
    if (resolution.kind !== 'missing-explicit') throw new Error('unreachable');
    expect(resolution.requested).toBe('docs/nope.json');
    expect(resolution.tried).toContain(path.join(root, 'docs/nope.json'));
    // Never silently falls back to the discoverable openapi.json beside it.
    expect(resolution.tried.every((candidate) => !fs.existsSync(candidate))).toBe(true);
  });

  it('distinguishes an unspecced repo from a bad --spec', () => {
    expect(resolveSpec(makeRepo({ 'README.md': '' })).kind).toBe('none');
  });

  it('describeMissingSpec names the request and each candidate', () => {
    const message = describeMissingSpec({ requested: 'docs/nope.json', tried: ['/a/x', '/b/x'] });
    expect(message).toContain('--spec docs/nope.json did not resolve to a file');
    expect(message).toContain('  /a/x');
    expect(message).toContain('  /b/x');
  });

  it('buildCoverageReport surfaces the bad --spec rather than "no spec found"', () => {
    const root = makeRepo({ 'openapi.json': '{"paths":{}}' });
    process.env.SPECPROOF_SPEC = 'docs/nope.json';
    expect(() => buildCoverageReport(root)).toThrow(/--spec docs\/nope\.json did not resolve/);
  });
});
