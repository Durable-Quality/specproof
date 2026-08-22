import { describe, expect, it } from 'vitest';

import { CliUsageError, parseCliArgs, USAGE } from '@/scripts/cli-args';

// scripts/cli.ts itself runs main() and calls process.exit() at import time,
// so the parser lives in cli-args.ts and is tested here. What cli.ts still
// owns, copying repo/spec into env before dynamically importing the generator,
// is covered end to end by the consumer matrix in .github/workflows/ci.yml.

describe('parseCliArgs', () => {
  it('defaults to port 3001 with no generate arguments', () => {
    expect(parseCliArgs('dev', [])).toEqual({ port: '3001', generateArgs: [] });
  });

  it('captures --repo and --spec verbatim, without resolving them', () => {
    // Resolution is the analyzer's job (it needs the audited root to anchor
    // against), so the parser must not helpfully path.resolve() anything.
    const parsed = parseCliArgs('generate', ['--repo', '../api', '--spec', 'docs/openapi.yaml']);
    expect(parsed.repo).toBe('../api');
    expect(parsed.spec).toBe('docs/openapi.yaml');
  });

  it('keeps a leading-slash --spec intact for the analyzer to interpret', () => {
    expect(parseCliArgs('generate', ['--spec', '/api/openapi.json']).spec).toBe(
      '/api/openapi.json'
    );
  });

  it('forwards --out and --check to the generator', () => {
    expect(parseCliArgs('generate', ['--check', '--out', 'proof.json']).generateArgs).toEqual([
      '--check',
      '--out',
      'proof.json'
    ]);
  });

  it('accepts --port for dev/start', () => {
    expect(parseCliArgs('dev', ['--port', '4000']).port).toBe('4000');
  });

  it('rejects --out and --check outside generate', () => {
    expect(() => parseCliArgs('dev', ['--out', 'proof.json'])).toThrow(
      /--out only applies to the generate command/
    );
    expect(() => parseCliArgs('start', ['--check'])).toThrow(
      /--check only applies to the generate command/
    );
  });

  it('rejects an option with no value', () => {
    expect(() => parseCliArgs('generate', ['--spec'])).toThrow(/--spec requires a value/);
    expect(() => parseCliArgs('generate', ['--repo'])).toThrow(/--repo requires a value/);
  });

  it('rejects unknown options rather than ignoring them', () => {
    expect(() => parseCliArgs('generate', ['--sepc', 'openapi.json'])).toThrow(
      /unknown option: --sepc/
    );
    // The --key=value form is not supported; it must fail loudly, not silently
    // leave the spec unset and audit something else.
    expect(() => parseCliArgs('generate', ['--spec=openapi.json'])).toThrow(
      /unknown option: --spec=openapi\.json/
    );
  });

  it('throws CliUsageError, which cli.ts turns into usage text', () => {
    expect(() => parseCliArgs('generate', ['--nope'])).toThrow(CliUsageError);
  });

  it('documents how a relative --spec is anchored', () => {
    expect(USAGE).toContain('--spec <path>');
    expect(USAGE).toContain('resolved against the audited repo');
  });
});
