import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  OPENAPI_SPEC_PATH,
  OMNILENS_ROOT,
  WEB_ROOT,
  type CoverageReport,
} from "@/lib/api-test-coverage";
import { buildLedger, GENERATED_LEDGER_PATH } from "@/scripts/generate-ledger";

/**
 * Contract tests that keep the rendered ledger in lockstep with the OmniLens
 * sources it audits. Three drift modes are covered:
 *
 * 1. The OpenAPI spec gains/loses an operation without the ledger following
 *    (spec <-> ledger, both directions).
 * 2. A quoted test snippet no longer points at a real it()/test() block in
 *    its route.test.ts — the evidence the UI shows must be re-readable from
 *    the source it cites.
 * 3. The spec or a route test changed without regenerating
 *    ledger.generated.json.
 */

function loadCheckedInLedger(): CoverageReport {
  return JSON.parse(fs.readFileSync(GENERATED_LEDGER_PATH, "utf8"));
}

// The drift guards compare the artifact against the audited OmniLens checkout
// (sibling ../OmniLens, or OMNILENS_REPO). Without a checkout there is nothing
// to compare against, so the suite self-skips — same pattern as the DB-gated
// integration tests in OmniLens itself.
const hasOmniLensCheckout = fs.existsSync(WEB_ROOT);
if (!hasOmniLensCheckout) {
  console.warn(
    `ledger-contract: skipping — OmniLens checkout not found at ${OMNILENS_ROOT} (set OMNILENS_REPO or clone it as a sibling)`,
  );
}

describe.skipIf(!hasOmniLensCheckout)("Test Ledger contract", () => {
  it("audits every operation in the OpenAPI spec, and nothing else", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI_SPEC_PATH, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };

    const documented = Object.entries(spec.paths)
      .flatMap(([specPath, methods]) =>
        Object.keys(methods).map((method) => `${method} ${specPath}`),
      )
      .sort();

    const audited = loadCheckedInLedger()
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
        .readFileSync(path.join(OMNILENS_ROOT, testFile), "utf8")
        .split("\n");
      sources.set(testFile, lines);
      return lines;
    };

    for (const tag of loadCheckedInLedger().tags) {
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

  it("ledger.generated.json is up to date with the spec and route tests", () => {
    const checkedIn = loadCheckedInLedger();
    // If this fails, the OpenAPI spec or a route.test.ts changed without
    // regenerating the ledger: run `bun run generate:ledger` (from
    // apps/test-ledger) and commit the result.
    expect(checkedIn).toEqual(buildLedger());
  });
});
