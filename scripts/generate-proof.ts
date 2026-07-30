// Generates the coverage proof rendered by the SpecProof app from the
// audited target repo's OpenAPI spec + test suites (the current directory by
// default, override with SPECPROOF_REPO; spec auto-discovered, override with
// SPECPROOF_SPEC).
//
// Run via `bun run generate:proof` (also runs automatically before
// `bun run dev` / `bun run build`) during development of this repo, or
// `specproof generate` when installed as a dependency elsewhere.
// The output defaults to the checked-in artifact at app/proof.generated.json;
// override with --out / SPECPROOF_OUT to write the proof into the audited
// repo instead (e.g. to commit it there). --check verifies the output file is
// up to date without writing — the CI drift guard. When no target spec is
// found, the existing artifact is left untouched so the app still builds and
// renders.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  buildCoverageReport,
  findSpecCandidates,
  looksLikeSpecFile,
  resolveRepoName,
  resolveSpecPath,
  specDepth,
  TARGET_REPO_ROOT,
  type CoverageReport,
} from '../lib/api-test-coverage.js';

// This file runs both as source (scripts/generate-proof.ts, via
// `bun run generate:proof` in this repo's own dev loop) and compiled
// (dist/scripts/generate-proof.js, once installed as a dependency — see
// tsconfig.cli.json) — one directory level deeper than the package root.
// Walking up to the nearest package.json finds the right root either way,
// rather than hardcoding a hop count that only holds for one of the two
// layouts.
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`could not locate package.json above ${startDir}`);
    dir = parent;
  }
  return dir;
}

const appRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

export const GENERATED_PROOF_PATH = path.join(
  appRoot,
  'app/proof.generated.json'
);

export function buildProof(): Record<string, unknown> {
  return buildCoverageReport() as unknown as Record<string, unknown>;
}

export interface GenerateOptions {
  /** Where to write (or, with check, what to verify). Resolved against cwd.
   *  Defaults to SPECPROOF_OUT, then the app's checked-in artifact. */
  out?: string;
  /** Verify the file at `out` matches a fresh proof instead of writing. */
  check?: boolean;
}

/** Parses --out <path> / --check from a generate argv slice. Throws on
 *  anything unrecognized so callers surface their own usage text. */
export function parseGenerateArgs(argv: string[]): GenerateOptions {
  const options: GenerateOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--out') {
      const value = argv[++i];
      if (!value) throw new Error('--out requires a path');
      options.out = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/** A path shortened to a cwd-relative one when that is actually shorter. */
function labelFor(target: string): string {
  const relative = path.relative(process.cwd(), target);
  return relative && !relative.startsWith('..') ? relative : target;
}

/**
 * Warn when discovery had to break a tie. The case worth catching: a repo that
 * keeps `openapi.yaml` next to a converted `openapi.json`, where auditing the
 * wrong one means proving coverage against a spec nobody edits. Discovery is
 * deterministic (see findSpecCandidates), but silently deterministic is not
 * good enough when one of the two files is stale.
 */
function warnOnAmbiguousSpec(specPath: string): void {
  if (process.env.SPECPROOF_SPEC) return; // explicitly chosen, nothing to warn about
  const tied = findSpecCandidates().filter(
    (candidate) => specDepth(candidate) === specDepth(specPath)
  );
  if (tied.length < 2) return;
  console.warn(
    `generate-proof: ${tied.length} specs sit at the same depth (${tied
      .map(labelFor)
      .join(', ')}); auditing ${labelFor(specPath)}. ` +
      'Pass --spec (or SPECPROOF_SPEC) to choose deliberately.'
  );
}

export function runGenerate(options: GenerateOptions = {}): number {
  const outPath = path.resolve(
    options.out ?? process.env.SPECPROOF_OUT ?? GENERATED_PROOF_PATH
  );
  const outLabel = labelFor(outPath);

  // The proof is an artifact about the spec, never a spec. Writing it under a
  // discoverable spec name would either clobber the real definition or make
  // the next run audit the proof as though it were one.
  if (looksLikeSpecFile(path.basename(outPath))) {
    console.error(
      `generate-proof: refusing to write the proof to ${outLabel}: spec auto-discovery reads ` +
        'openapi* / swagger* files as the API definition, so the next run would audit the ' +
        'proof instead of the spec. Choose another --out path.'
    );
    return 1;
  }

  const specPath = resolveSpecPath();
  if (!specPath) {
    const hint =
      `no OpenAPI spec found under ${TARGET_REPO_ROOT} — ` +
      'set SPECPROOF_REPO to the repo to audit (or SPECPROOF_SPEC to the spec file)';
    if (options.check) {
      // A drift check with nothing to check against is a failure, not a skip:
      // CI asked us to verify the proof and we can't.
      console.error(`generate-proof: ${hint}`);
      return 1;
    }
    if (!fs.existsSync(outPath)) {
      // The artifact is not published with the package, so a fresh install has
      // no proof at all. Write an empty one: the app needs the file to build,
      // and an empty report renders the "no API definition" state.
      const empty: CoverageReport = {
        repoName: resolveRepoName(TARGET_REPO_ROOT),
        tags: [],
        operationCount: 0,
        coveredCount: 0,
        totalCount: 0,
        untestedOperations: 0,
      };
      fs.writeFileSync(outPath, JSON.stringify(empty, null, 2) + '\n');
      console.warn(`generate-proof: ${hint}; wrote an empty proof to ${outLabel}`);
      return 0;
    }
    console.warn(`generate-proof: ${hint}; keeping the existing proof`);
    return 0;
  }

  warnOnAmbiguousSpec(specPath);
  const specLabel = labelFor(specPath);

  let proof: Record<string, unknown>;
  try {
    proof = buildProof();
  } catch (error) {
    // An unreadable spec is a hard failure in both modes: with or without
    // --check, we cannot say anything about the proof's accuracy. Reporting it
    // as a one-line message rather than an uncaught stack keeps a malformed
    // YAML (or JSON) spec legible in CI logs.
    console.error(
      `generate-proof: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }

  const operationCount = (proof.operationCount as number) ?? 0;
  if (operationCount === 0) {
    console.error(
      `generate-proof: no operations found in ${specLabel} — refusing to write an empty proof`
    );
    return 1;
  }
  const serialized = JSON.stringify(proof, null, 2) + '\n';

  if (options.check) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (existing !== serialized) {
      console.error(
        `generate-proof: ${outLabel} is stale relative to the spec/tests — ` +
          'regenerate it (specproof generate) and commit the result'
      );
      return 1;
    }
    console.log(
      `generate-proof: ${outLabel} is up to date with ${specLabel} (${operationCount} operations)`
    );
    return 0;
  }

  fs.writeFileSync(outPath, serialized);
  console.log(
    `generate-proof: wrote ${outLabel} from ${specLabel} (${operationCount} operations)`
  );
  return 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(runGenerate(parseGenerateArgs(process.argv.slice(2))));
}
