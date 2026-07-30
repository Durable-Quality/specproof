import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  loadSpec,
  resolveSpecPath,
  TARGET_REPO_ROOT,
  type CoverageReport,
} from "@/lib/api-test-coverage";
import { buildProof, GENERATED_PROOF_PATH } from "@/scripts/generate-proof";

/**
 * Contract tests that keep the rendered proof in lockstep with the target
 * repo it audits. Three drift modes are covered:
 *
 * 1. The OpenAPI spec gains/loses an operation without the proof following
 *    (spec <-> proof, both directions).
 * 2. A quoted test snippet no longer points at a real it()/test() block in
 *    its test file — the evidence the UI shows must be re-readable from the
 *    source it cites.
 * 3. The spec or a test file changed without regenerating
 *    proof.generated.json.
 */

function loadCheckedInProof(): CoverageReport {
  return JSON.parse(fs.readFileSync(GENERATED_PROOF_PATH, "utf8"));
}

// The drift guards compare the artifact against the audited target repo
// (SPECPROOF_REPO, or the current directory). Without an OpenAPI spec to audit
// there is nothing to compare against, so the suite self-skips.
const specPath = resolveSpecPath();
if (!specPath) {
  console.warn(
    `proof-contract: skipping — no OpenAPI spec found under ${TARGET_REPO_ROOT} (set SPECPROOF_REPO to the repo to audit, or SPECPROOF_SPEC to the spec file)`,
  );
}

describe.skipIf(!specPath)("SpecProof contract", () => {
  it("audits every operation in the OpenAPI spec, and nothing else", () => {
    // loadSpec, not JSON.parse: the audited repo's spec may be YAML.
    const spec = loadSpec(specPath!);

    const documented = Object.entries(spec.paths ?? {})
      .flatMap(([opPath, methods]) =>
        Object.keys(methods).map((method) => `${method} ${opPath}`),
      )
      .sort();

    const audited = loadCheckedInProof()
      .tags.flatMap((tag) => tag.operations)
      .map((op) => `${op.method} ${op.specPath}`)
      .sort();

    expect(documented.length).toBeGreaterThan(0);
    expect(audited).toEqual(documented);
  });

  it("every quoted snippet points at a real it()/test() block in its test file", () => {
    const sources = new Map<string, string[]>();
    const readLines = (testFile: string) => {
      const cached = sources.get(testFile);
      if (cached) return cached;
      const lines = fs
        .readFileSync(path.join(TARGET_REPO_ROOT, testFile), "utf8")
        .split("\n");
      sources.set(testFile, lines);
      return lines;
    };

    for (const tag of loadCheckedInProof().tags) {
      for (const op of tag.operations) {
        if (!op.testFile) continue;
        for (const status of op.statuses) {
          for (const snippet of status.snippets) {
            const line = readLines(op.testFile)[snippet.startLine - 1] ?? "";
            expect(
              /(?:it|test)\(/.test(line),
              `${op.method} ${op.specPath} ${status.code}: snippet "${snippet.title}" cites ${op.testFile}:${snippet.startLine}, but that line is not an it()/test() block`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("proof.generated.json is up to date with the spec and tests", () => {
    const checkedIn = loadCheckedInProof();
    // If this fails, the OpenAPI spec or a test file changed without
    // regenerating the proof: run `bun run generate:proof` and commit the
    // result.
    expect(checkedIn).toEqual(buildProof());
  });
});
