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
  resolveRepoName,
  resolveSpecPath,
  TARGET_REPO_ROOT,
  type CoverageReport,
} from '../lib/api-test-coverage.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

export function runGenerate(options: GenerateOptions = {}): number {
  const outPath = path.resolve(
    options.out ?? process.env.SPECPROOF_OUT ?? GENERATED_PROOF_PATH
  );
  const relative = path.relative(process.cwd(), outPath);
  const outLabel = relative && !relative.startsWith('..') ? relative : outPath;

  if (!resolveSpecPath()) {
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

  const proof = buildProof();
  const operationCount = (proof.operationCount as number) ?? 0;
  if (operationCount === 0) {
    console.error('generate-proof: no operations found in the OpenAPI spec — refusing to write an empty proof');
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
    console.log(`generate-proof: ${outLabel} is up to date (${operationCount} operations)`);
    return 0;
  }

  fs.writeFileSync(outPath, serialized);
  console.log(`generate-proof: wrote ${outLabel} (${operationCount} operations)`);
  return 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(runGenerate(parseGenerateArgs(process.argv.slice(2))));
}
