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
  options: { out: string; check?: boolean; spec?: string; allowEmpty?: boolean }
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
    const code = runGenerate({
      out: options.out,
      check: options.check,
      allowEmpty: options.allowEmpty
    });
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
    // An empty spec beside a proof that already has operations is the
    // regression this guard exists for: truncation, or discovery latching onto
    // the wrong file. Distinct from the scaffold case below, which has nothing
    // to lose.
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);
    const before = fs.readFileSync(out, 'utf8');

    fs.writeFileSync(path.join(root, 'openapi.yaml'), '');

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/Refusing to overwrite a proof with an empty one/);
    expect(fs.readFileSync(out, 'utf8')).toBe(before);
  });

  it('overwrites a non-empty proof with an empty one only under --allow-empty', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);

    fs.writeFileSync(path.join(root, 'openapi.yaml'), 'openapi: 3.0.0\npaths: {}\n');

    const run = await runGenerateIn(root, { out, allowEmpty: true });

    expect(run.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).operationCount).toBe(0);
  });
});

describe('upgrading from an older proof schema', () => {
  it('blames the upgrade, not the spec, when --check trips on a pre-0.8 proof', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);

    // Exactly what a 0.7.x consumer has committed: current content, no hasSpec.
    const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
    delete proof.hasSpec;
    fs.writeFileSync(out, JSON.stringify(proof, null, 2) + '\n');

    const run = await runGenerateIn(root, { out, check: true });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/older version of SpecProof/);
    // The misleading half of the old message must not appear: sending someone
    // to git log for a spec change that never happened is the whole failure.
    expect(run.errors).not.toMatch(/stale relative to the spec\/tests/);
  });

  it('still reports real drift as drift', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);

    fs.writeFileSync(path.join(root, 'openapi.yaml'), SPEC_YAML_DRIFTED);

    const run = await runGenerateIn(root, { out, check: true });

    expect(run.code).toBe(1);
    expect(run.errors).toMatch(/stale relative to the spec\/tests/);
    expect(run.errors).not.toMatch(/older version of SpecProof/);
  });

  it('regenerating heals the upgrade, adding only the new field', async () => {
    const root = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);
    expect((await runGenerateIn(root, { out })).code).toBe(0);
    const current = JSON.parse(fs.readFileSync(out, 'utf8'));

    const old = { ...current };
    delete old.hasSpec;
    fs.writeFileSync(out, JSON.stringify(old, null, 2) + '\n');

    expect((await runGenerateIn(root, { out })).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual(current);
    expect((await runGenerateIn(root, { out, check: true })).code).toBe(0);
  });
});

describe('barebones specs', () => {
  // The scaffolding loop: start with nothing, run the generator as you write.
  // Each of these must produce a renderable proof rather than a hard failure,
  // or `specproof dev` can never open on a repo whose API isn't written yet.
  const scaffolds: Record<string, string> = {
    'an empty file': '',
    'a comment-only file': '# paths go here\n',
    'a spec with no paths key': 'openapi: 3.0.0\ninfo: { title: WIP, version: 0.0.0 }\n',
    'a spec with an empty paths map': 'openapi: 3.0.0\npaths: {}\n',
  };

  for (const [label, contents] of Object.entries(scaffolds)) {
    it(`writes an empty proof for ${label}`, async () => {
      const root = makeRepo({ 'openapi.yaml': contents });
      const out = outIn(root);

      const run = await runGenerateIn(root, { out });

      expect(run.code).toBe(0);
      const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
      expect(proof.operationCount).toBe(0);
      // hasSpec is what separates this from a repo with no spec at all, and
      // what the empty state branches on.
      expect(proof.hasSpec).toBe(true);
    });
  }

  it('marks a repo with no spec at all as hasSpec: false', async () => {
    const root = makeRepo({ 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).hasSpec).toBe(false);
  });

  it('grows the proof as operations are added, with --check tracking each step', async () => {
    const root = makeRepo({ 'openapi.yaml': '', 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(root);

    expect((await runGenerateIn(root, { out })).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).operationCount).toBe(0);
    // A committed empty proof is a legitimate CI state, not perpetual drift.
    expect((await runGenerateIn(root, { out, check: true })).code).toBe(0);

    fs.writeFileSync(path.join(root, 'openapi.yaml'), SPEC_YAML);

    // The spec moved on, so the committed empty proof is now genuinely stale.
    expect((await runGenerateIn(root, { out, check: true })).code).toBe(1);
    expect((await runGenerateIn(root, { out })).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).operationCount).toBeGreaterThan(0);
    expect((await runGenerateIn(root, { out, check: true })).code).toBe(0);
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
    // The JSON copy wins the tie, so the 404 only the YAML documents is absent
    // (the 500 beside the 200 is SpecProof's own synthesized row).
    const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(proof.tags[0].operations[0].statuses.map((s: { code: string }) => s.code)).toEqual([
      '200',
      '500'
    ]);
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

describe('no spec, with a proof already on disk', () => {
  // The artifact dev/build render is a cache of whichever repo was last
  // audited. Pointing it at a repo with no spec must not leave the previous
  // repo's coverage on screen under a new repo's name.
  const specless = { 'readme.md': 'no spec here' };

  it("replaces the previous repo's proof with an empty one under --allow-empty", async () => {
    const audited = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(audited);
    expect((await runGenerateIn(audited, { out })).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).operationCount).toBeGreaterThan(0);

    // What `specproof dev --repo <scaffold>` does with that same artifact.
    const run = await runGenerateIn(makeRepo(specless), { out, allowEmpty: true });

    expect(run.code).toBe(0);
    expect(run.output).toMatch(/wrote an empty proof/);
    const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(proof.operationCount).toBe(0);
    expect(proof.hasSpec).toBe(false);
    expect(proof.tags).toEqual([]);
  });

  it('keeps a proof that has operations when --allow-empty is not passed', async () => {
    const audited = makeRepo({ 'openapi.yaml': SPEC_YAML, 'tests/widgets.test.ts': WIDGET_TESTS });
    const out = outIn(audited);
    expect((await runGenerateIn(audited, { out })).code).toBe(0);
    const committed = fs.readFileSync(out, 'utf8');

    // A consumer's committed proof, where a spec that suddenly can't be found
    // is likelier to be broken discovery than a deleted API.
    const run = await runGenerateIn(makeRepo(specless), { out });

    expect(run.code).toBe(0);
    expect(run.output).toMatch(/keeping the existing/);
    expect(run.output).toMatch(/--allow-empty/);
    expect(fs.readFileSync(out, 'utf8')).toBe(committed);
  });

  it('overwrites an empty proof without needing --allow-empty', async () => {
    // Nothing to lose: the repo name and hasSpec still have to track the repo
    // actually being audited, or the empty state names the wrong one.
    const root = makeRepo(specless);
    const out = outIn(root);
    fs.writeFileSync(
      out,
      JSON.stringify(
        { repoName: 'some-other-repo', hasSpec: true, tags: [], operationCount: 0 },
        null,
        2
      ) + '\n'
    );

    const run = await runGenerateIn(root, { out });

    expect(run.code).toBe(0);
    const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(proof.repoName).toBe(path.basename(root));
    expect(proof.hasSpec).toBe(false);
  });
});
