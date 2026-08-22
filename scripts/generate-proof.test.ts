import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Drift-guard tests for the generator, exercised against YAML and JSON specs
// side by side. The property that matters: the spec's serialization format is
// invisible to the proof, so a repo can convert `openapi.yaml` to
// `openapi.json` (or stop converting and audit the YAML directly) without
// `--check` calling it drift — while any real change to the spec or the tests
// still fails the check.
//
// As in lib/api-test-coverage.test.ts, every fixture uses /widgets operations,
// which the bundled example spec does not document: the analyzer parses this
// repo's own *.test.ts files as raw text when auditing example/, and colliding
// paths would pollute the generated proof.

const tmpRoots: string[] = [];

function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specproof-gen-'));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    fs.rmSync(tmpRoots.pop()!, { recursive: true, force: true });
  }
});

interface RunResult {
  code: number;
  /** console.log + console.warn */
  output: string;
  /** console.error */
  errors: string;
}

/**
 * Run the generator against `repoRoot`. The module reads SPECPROOF_REPO /
 * SPECPROOF_SPEC once at load, so each run needs a fresh module graph. `out`
 * is mandatory: without it the generator would write this repo's real
 * app/proof.generated.json.
 */
async function runGenerateIn(
  repoRoot: string,
  options: { out: string; check?: boolean; spec?: string }
): Promise<RunResult> {
  const saved = {
    repo: process.env.SPECPROOF_REPO,
    spec: process.env.SPECPROOF_SPEC
  };
  process.env.SPECPROOF_REPO = repoRoot;
  if (options.spec) process.env.SPECPROOF_SPEC = options.spec;
  else delete process.env.SPECPROOF_SPEC;

  const output: string[] = [];
  const errors: string[] = [];
  const collect = (into: string[]) => (...args: unknown[]) => {
    into.push(args.join(' '));
  };
  const log = vi.spyOn(console, 'log').mockImplementation(collect(output));
  const warn = vi.spyOn(console, 'warn').mockImplementation(collect(output));
  const error = vi.spyOn(console, 'error').mockImplementation(collect(errors));

  try {
    vi.resetModules();
    const { runGenerate } = await import('@/scripts/generate-proof');
    const code = runGenerate({ out: options.out, check: options.check });
    return { code, output: output.join('\n'), errors: errors.join('\n') };
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    if (saved.repo === undefined) delete process.env.SPECPROOF_REPO;
    else process.env.SPECPROOF_REPO = saved.repo;
    if (saved.spec === undefined) delete process.env.SPECPROOF_SPEC;
    else process.env.SPECPROOF_SPEC = saved.spec;
  }
}

const SPEC_YAML = [
  'openapi: 3.0.0',
  'paths:',
  '  /widgets:',
  '    get:',
  '      summary: List widgets',
  '      responses:',
  '        200:',
  '          description: OK',
  ''
].join('\n');

/** The same document, converted the way a consumer would convert it. */
const SPEC_JSON =
  JSON.stringify(
    {
      openapi: '3.0.0',
      paths: {
        '/widgets': {
          get: { summary: 'List widgets', responses: { '200': { description: 'OK' } } }
        }
      }
    },
    null,
    2
  ) + '\n';

/** SPEC_YAML plus a documented 404 — a real change to what must be proven. */
const SPEC_YAML_DRIFTED = SPEC_YAML + ['        404:', '          description: Not found', ''].join(
  '\n'
);

const WIDGET_TESTS = [
  'describe("GET /widgets", () => {',
  '  it("lists widgets", async () => {',
  '    expect(res.status).toBe(200);',
  '  });',
  '});',
  ''
].join('\n');

const outIn = (root: string) => path.join(root, 'proof.json');

describe('generate against a YAML spec', () => {
  it('writes a proof and names the spec it audited', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(0);
    expect(run.output).toContain('openapi.yaml');
    const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(proof.operationCount).toBe(1);
    expect(proof.coveredCount).toBe(1);
  });

  it('writes a proof byte-identical to the one its JSON conversion produces', async () => {
    const root = makeRepo({
      'openapi.yaml': SPEC_YAML,
      'openapi.json': SPEC_JSON,
      'tests/widgets.test.ts': WIDGET_TESTS
    });
    const fromYaml = path.join(root, 'from-yaml.json');
    const fromJson = path.join(root, 'from-json.json');

    expect((await runGenerateIn(root, { out: fromYaml, spec: 'openapi.yaml' })).code).toBe(0);
    expect((await runGenerateIn(root, { out: fromJson, spec: 'openapi.json' })).code).toBe(0);

    expect(fs.readFileSync(fromYaml, 'utf8')).toBe(fs.readFileSync(fromJson, 'utf8'));
  });
});

describe('the drift guard across a format conversion', () => {
  it('passes --check after the spec is converted from JSON to YAML', async () => {
    const root = makeRepo({ 'openapi.json': SPEC_JSON, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);

    // The consumer drops the converted JSON and audits the YAML source itself.
    fs.rmSync(path.join(root, 'openapi.json'));
    fs.writeFileSync(path.join(root, 'openapi.yaml'), SPEC_YAML);

    const check = await runGenerateIn(root, { out, check: true });
    expect(check.code).toBe(0);
    expect(check.output).toContain('up to date');
  });

  it('passes --check after the spec is converted from YAML to JSON', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);

    fs.rmSync(path.join(root, 'openapi.yaml'));
    fs.writeFileSync(path.join(root, 'openapi.json'), SPEC_JSON);

    expect((await runGenerateIn(root, { out, check: true })).code).toBe(0);
  });

  it('still fails --check when the YAML spec itself changes', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);
    const before = fs.readFileSync(out, 'utf8');

    fs.writeFileSync(path.join(root, 'openapi.yaml'), SPEC_YAML_DRIFTED);

    const check = await runGenerateIn(root, { out, check: true });
    expect(check.code).toBe(1);
    expect(check.errors).toMatch(/stale relative to the spec\/tests/);
    // --check verifies, never writes.
    expect(fs.readFileSync(out, 'utf8')).toBe(before);

    // Regenerating heals it.
    expect((await runGenerateIn(root, { out })).code).toBe(0);
    expect((await runGenerateIn(root, { out, check: true })).code).toBe(0);
  });

  it('still fails --check when a test file changes under a YAML spec', async () => {
    const root = makeRepo({
      'openapi.yaml': SPEC_YAML_DRIFTED,
      'tests/widgets.test.ts': WIDGET_TESTS
    });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);

    fs.writeFileSync(
      path.join(root, 'tests/widgets.test.ts'),
      WIDGET_TESTS +
        [
          'describe("GET /widgets", () => {',
          '  it("404s for a missing widget", async () => {',
          '    expect(res.status).toBe(404);',
          '  });',
          '});',
          ''
        ].join('\n')
    );

    expect((await runGenerateIn(root, { out, check: true })).code).toBe(1);
  });
});

describe('unreadable specs', () => {
  it('fails both modes on malformed YAML, leaving the proof untouched', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);
    const before = fs.readFileSync(out, 'utf8');

    fs.writeFileSync(path.join(root, 'openapi.yaml'), 'openapi: 3.0.0\npaths: { /widgets: \n');

    const write = await runGenerateIn(root, { out });
    expect(write.code).toBe(1);
    expect(write.errors).toMatch(/could not parse .*openapi\.yaml as YAML/);
    expect(fs.readFileSync(out, 'utf8')).toBe(before);

    const check = await runGenerateIn(root, { out, check: true });
    expect(check.code).toBe(1);
    expect(check.errors).toMatch(/could not parse/);
    expect(fs.readFileSync(out, 'utf8')).toBe(before);
  });

  it('fails on an empty YAML document rather than emptying the proof', async () => {
    const root = makeRepo({ 'openapi.yaml': '', 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/not an OpenAPI document/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('refuses to write when a well-formed spec documents no operations', async () => {
    const root = makeRepo({ 'openapi.yaml': 'openapi: 3.0.0\npaths: {}\n' });
    const out = outIn(root);

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/no operations found in .*openapi\.yaml/);
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('spec discovery', () => {
  it('warns when a YAML and a JSON spec sit side by side, and audits the JSON', async () => {
    const root = makeRepo({
      'openapi.yaml': SPEC_YAML_DRIFTED,
      'openapi.json': SPEC_JSON,
      'tests/widgets.test.ts': WIDGET_TESTS
    });
    const out = outIn(root);

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(0);
    expect(run.output).toMatch(/2 specs sit at the same depth/);
    expect(run.output).toMatch(/Pass --spec/);
    // The JSON copy wins the tie, so the 404 only the YAML documents is absent.
    const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(proof.totalCount).toBe(1);
  });

  it('stays quiet when the spec is unambiguous', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });

    const run = await runGenerateIn(root, { out: outIn(root) });

    expect(run.output).not.toMatch(/same depth/);
  });

  it('refuses an --out that discovery would later mistake for the spec', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = path.join(root, 'openapi-proof.json');

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/refusing to write the proof/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('will not overwrite the very spec it audits', async () => {
    const root = makeRepo({ 'openapi.json': SPEC_JSON, 'tests/widgets.test.ts': WIDGET_TESTS });
    const spec = path.join(root, 'openapi.json');

    const run = await runGenerateIn(root, { out: spec });

    expect(run.code).toBe(1);
    expect(fs.readFileSync(spec, 'utf8')).toBe(SPEC_JSON);
  });

  it('soft-skips with no spec, but hard-fails under --check', async () => {
    const root = makeRepo({ 'readme.md': 'no spec here' });
    const out = outIn(root);

    const skip = await runGenerateIn(root, { out });
    expect(skip.code).toBe(0);
    expect(skip.output).toMatch(/no OpenAPI spec found/);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).operationCount).toBe(0);

    const check = await runGenerateIn(root, { out, check: true });
    expect(check.code).toBe(1);
    expect(check.errors).toMatch(/no OpenAPI spec found/);
  });
});

// ============================================================================
// Unresolvable --spec (DEV-10)
// ============================================================================
//
// A --spec that does not resolve used to return the same null as "this repo has
// no spec", so the generator kept the stale proof and exited 0. The user named a
// file; failing to find it is an error, with or without --check.

describe('unresolvable --spec', () => {
  it('fails with the paths it tried instead of keeping the proof', async () => {
    const repo = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = path.join(repo, 'proof.json');
    fs.writeFileSync(out, '{"stale":true}');

    const run = await runGenerateIn(repo, { out, spec: 'docs/nope.yaml' });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/--spec docs\/nope\.yaml did not resolve to a file/);
    expect(run.errors).toContain(path.join(repo, 'docs/nope.yaml'));
    // The stale proof is left exactly as it was, not overwritten or emptied.
    expect(fs.readFileSync(out, 'utf8')).toBe('{"stale":true}');
  });

  it('never silently falls back to the discoverable spec beside it', async () => {
    const repo = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = path.join(repo, 'proof.json');

    const run = await runGenerateIn(repo, { out, spec: 'docs/nope.yaml' });

    expect(run.code).toBe(1);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('fails the same way under --check', async () => {
    const repo = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = path.join(repo, 'proof.json');
    await runGenerateIn(repo, { out });

    const run = await runGenerateIn(repo, { out, check: true, spec: 'docs/nope.yaml' });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/--spec docs\/nope\.yaml did not resolve to a file/);
  });

  it('resolves a spec named relative to the git root from a package subdirectory', async () => {
    // The monorepo shape the bug was reported against: the audited root is the
    // package, but --spec is written relative to the checkout root.
    const repo = makeRepo({
      '.git/config': '',
      'docs/openapi.yaml': SPEC_YAML,
      'packages/api/tests/widgets.test.ts': WIDGET_TESTS
    });
    const pkg = path.join(repo, 'packages/api');
    const out = path.join(repo, 'proof.json');
    const savedCwd = process.cwd();

    try {
      process.chdir(pkg);
      const run = await runGenerateIn(pkg, { out, spec: 'docs/openapi.yaml' });
      expect(run.code).toBe(0);
      expect(JSON.parse(fs.readFileSync(out, 'utf8')).operationCount).toBe(1);
    } finally {
      process.chdir(savedCwd);
    }
  });
});
