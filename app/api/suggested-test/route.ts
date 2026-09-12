// Writes a suggested test into the audited repo — the Apply button behind the
// NO TEST panel.
//
// The app itself renders a checked-in artifact and needs no target checkout,
// so this route is the one place that reaches back to the repo being audited.
// It runs wherever the Next server does: under `specproof dev` that is the
// developer's own machine with SPECPROOF_REPO set, and the watcher there
// regenerates the proof as soon as the file lands, so the row the test was
// suggested for flips to VERIFIED without a restart. Anywhere the repo isn't
// reachable or writable, GET says so and the panel offers only the code.
//
// The request names an operation and a status, never a file body: the code
// written is rebuilt here from the spec through the same function the panel
// previewed it with, so there is nothing in the payload worth injecting.

import fs from 'fs';
import path from 'path';

import {
  buildCoverageReport,
  detectTestFramework,
  findTestFiles,
  resolveSpecPath,
  TARGET_REPO_ROOT,
} from '@/lib/api-test-coverage';
import { documentResponse } from '@/lib/apply-spec';
import { applySuggestedTest } from '@/lib/apply-test';
import { buildSuggestedTest } from '@/lib/test-suggestion';

export const dynamic = 'force-dynamic';

/** The artifact app/page.tsx renders. SPECPROOF_APP_ROOT comes from
 *  next.config.js, which is the only file guaranteed to sit at the package
 *  root under both `next dev <pkgDir>` and this repo's own dev script. */
const PROOF_PATH = process.env.SPECPROOF_APP_ROOT
  ? path.join(process.env.SPECPROOF_APP_ROOT, 'app/proof.generated.json')
  : null;

/**
 * Rewrite the bundled proof from the repo as it now stands, so the row that
 * was just applied reads as covered. Serialized exactly as the generator does
 * — the contract test compares the two byte for byte.
 *
 * `specproof dev`'s watcher would do this a moment later, but this repo's own
 * `bun run dev` starts no watcher, and either way a refresh the request waits
 * for is one the client can act on. A failure here is not a failed apply: the
 * test is already on disk, so it is reported rather than thrown.
 */
function refreshProof(): string | null {
  if (!PROOF_PATH) return 'SPECPROOF_APP_ROOT is unset, so the audit view will refresh on its own';
  try {
    fs.writeFileSync(PROOF_PATH, JSON.stringify(buildCoverageReport(), null, 2) + '\n');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Why applying is unavailable, or null when it is available. */
function blocked(): string | null {
  if (!fs.existsSync(TARGET_REPO_ROOT)) {
    return `the audited repo is not on this machine (${TARGET_REPO_ROOT})`;
  }
  try {
    fs.accessSync(TARGET_REPO_ROOT, fs.constants.W_OK);
  } catch {
    return `the audited repo is read-only (${TARGET_REPO_ROOT})`;
  }
  if (!resolveSpecPath()) return 'no OpenAPI spec resolves in the audited repo';
  return null;
}

export async function GET() {
  const reason = blocked();
  return Response.json({ writable: reason === null, repo: TARGET_REPO_ROOT, reason });
}

export async function POST(request: Request) {
  const reason = blocked();
  if (reason) return Response.json({ error: `cannot apply: ${reason}` }, { status: 409 });

  let body: { method?: unknown; specPath?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'expected a JSON body' }, { status: 400 });
  }
  const { method, specPath, status } = body;
  if (typeof method !== 'string' || typeof specPath !== 'string' || typeof status !== 'string') {
    return Response.json(
      { error: 'expected { method, specPath, status } as strings' },
      { status: 400 }
    );
  }

  // Re-derived from the spec rather than trusted from the request: the client
  // can only name a row the current audit actually reports as a gap.
  const report = buildCoverageReport();
  const operation = report.tags
    .flatMap((tag) => tag.operations)
    .find((op) => op.method === method && op.specPath === specPath);
  if (!operation) {
    return Response.json({ error: `${method} ${specPath} is not in the spec` }, { status: 404 });
  }
  const row = operation.statuses.find((candidate) => candidate.code === status);
  if (!row) {
    return Response.json(
      { error: `${method} ${specPath} has no ${status} row to cover` },
      { status: 404 }
    );
  }
  if (row.assertions > 0) {
    return Response.json(
      { error: `${method} ${specPath} ${status} is already asserted by a test` },
      { status: 409 }
    );
  }

  const framework = detectTestFramework(TARGET_REPO_ROOT, findTestFiles(TARGET_REPO_ROOT));
  const suggestion = buildSuggestedTest({
    method: operation.method,
    specPath: operation.specPath,
    status,
    hasRequestBody: operation.hasRequestBody,
    framework: framework.id,
    mode: operation.testFile ? 'append' : 'create',
  });

  try {
    const result = applySuggestedTest(
      TARGET_REPO_ROOT,
      operation.suggestedTestFile,
      suggestion,
      operation
    );
    // A gap the spec never documented is two holes. Writing only the test
    // would leave the row stamped MISSING FROM SPEC with a passing test
    // beside it, which is the one state this tool exists to call out.
    const spec = row.documented
      ? null
      : documentResponse(resolveSpecPath()!, operation.method, operation.specPath, status);
    return Response.json({
      ...result,
      specFile: spec?.added ? path.relative(TARGET_REPO_ROOT, resolveSpecPath()!) : null,
      specDescription: spec?.added ? spec.description : null,
      refreshError: refreshProof(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
