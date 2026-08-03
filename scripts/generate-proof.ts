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
// found, an empty proof is written so the app still builds and renders its
// empty state — unless that would replace a proof with operations in it, which
// takes --allow-empty (dev/build pass it; see the guard in runGenerate).

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

/** A proof with nothing in it — what a repo with no spec, or a spec with no
 *  operations yet, compiles to. The app needs the file to exist in order to
 *  build, and renders it as an empty state. */
export function emptyProof(hasSpec: boolean): CoverageReport {
  return {
    repoName: resolveRepoName(TARGET_REPO_ROOT),
    hasSpec,
    tags: [],
    operationCount: 0,
    coveredCount: 0,
    totalCount: 0,
    untestedOperations: 0,
  };
}

export interface GenerateOptions {
  /** Where to write (or, with check, what to verify). Resolved against cwd.
   *  Defaults to SPECPROOF_OUT, then the app's checked-in artifact. */
  out?: string;
  /** Verify the file at `out` matches a fresh proof instead of writing. */
  check?: boolean;
  /** Write a proof with no operations even when the one being replaced had
   *  some — the deliberate override for the regression guard below. */
  allowEmpty?: boolean;
}

/** Parses --out <path> / --check from a generate argv slice. Throws on
 *  anything unrecognized so callers surface their own usage text. */
export function parseGenerateArgs(argv: string[]): GenerateOptions {
  const options: GenerateOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--allow-empty') {
      options.allowEmpty = true;
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

/**
 * How many operations the proof already at `outPath` claims, or 0 when there
 * is no readable proof there yet. Unreadable counts as 0 deliberately: a
 * corrupt or hand-edited artifact is not evidence worth protecting, and
 * treating it as such would wedge the generator with no way forward.
 */
function existingOperationCount(outPath: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8')) as { operationCount?: unknown };
    return typeof parsed.operationCount === 'number' ? parsed.operationCount : 0;
  } catch {
    return 0;
  }
}

/**
 * Whether an existing proof was written by a SpecProof older than the fields
 * this version emits. Keyed on `hasSpec`, added in 0.8.0 and always present
 * since — a proof that parses but lacks it can only have come from an earlier
 * release, which makes the resulting --check failure an upgrade artifact
 * rather than real drift.
 */
function predatesCurrentSchema(existing: string | null): boolean {
  if (existing === null) return false;
  try {
    const parsed = JSON.parse(existing) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null && !('hasSpec' in parsed);
  } catch {
    return false; // unparseable is corruption, not an old schema
  }
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
    // Same regression guard as the zero-operations case below, for the same
    // reason: an empty proof is only worth refusing when it would destroy one
    // that had something in it. Keeping the old proof unconditionally is worse
    // than useless when the artifact is a cache of whichever repo was last
    // audited — `specproof dev` on a repo whose API isn't written yet would
    // audit this repo while displaying the last one's coverage, which is the
    // single most misleading thing this tool can do. So dev/build's
    // --allow-empty clears it, and only a proof with operations behind it (a
    // consumer's committed --out, where discovery breaking is the likelier
    // cause than the spec really being gone) is left alone.
    const previous = existingOperationCount(outPath);
    if (previous > 0 && !options.allowEmpty) {
      console.warn(
        `generate-proof: ${hint}; keeping the existing ${outLabel} (${previous} operations). ` +
          'Pass --allow-empty to replace it with an empty proof.'
      );
      return 0;
    }
    // Below the guard: either there is nothing to lose, or the caller said to
    // overwrite. The app needs the file to exist in order to build, and an
    // empty report renders the "no API definition" state. (A fresh install
    // lands here too — the artifact is not published with the package.)
    fs.writeFileSync(outPath, JSON.stringify(emptyProof(false), null, 2) + '\n');
    console.warn(`generate-proof: ${hint}; wrote an empty proof to ${outLabel}`);
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
  if (operationCount === 0 && !options.allowEmpty) {
    // An empty proof is only dangerous when it destroys one that had something
    // in it — a spec truncated mid-edit, or discovery that latched onto the
    // wrong file. With nothing to lose, zero operations is the ordinary state
    // of a spec someone has just started, and refusing to write it would stop
    // `specproof dev` from ever opening on a scaffold.
    const previous = existingOperationCount(outPath);
    if (previous > 0) {
      console.error(
        `generate-proof: ${specLabel} documents no operations, but ${outLabel} has ${previous}. ` +
          'Refusing to overwrite a proof with an empty one. Check the spec is complete and that ' +
          'the right one was discovered, or pass --allow-empty if this is deliberate.'
      );
      return 1;
    }
    console.warn(
      `generate-proof: ${specLabel} documents no operations yet: ` +
        'the audit view will render its empty state until you add some'
    );
  }
  const serialized = JSON.stringify(proof, null, 2) + '\n';

  if (options.check) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (existing !== serialized) {
      // "Stale relative to the spec/tests" sends people to `git log` looking
      // for a change that isn't there when the real cause is an upgrade: a
      // proof written by an older SpecProof differs by the fields this version
      // added, not by anything the repo did. Name that cause when it applies.
      const cause = predatesCurrentSchema(existing)
        ? 'was generated by an older version of SpecProof and is missing fields this one ' +
          'records. Your spec and tests have not drifted'
        : 'is stale relative to the spec/tests';
      console.error(
        `generate-proof: ${outLabel} ${cause}. ` +
          'Regenerate it (specproof generate) and commit the result.'
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
