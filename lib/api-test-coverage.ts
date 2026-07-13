// Coverage analyzer for Test Ledger — the source the generated ledger is
// compiled from.
//
// Joins two sources of truth in the audited OmniLens checkout:
//   1. The generated OpenAPI spec (apps/web/app/api/openapi/openapi.generated.json) —
//      every documented operation and its response status codes.
//   2. The colocated route tests (apps/web/app/api/**/route.test.ts) — which
//      statuses each method actually has assertions for, parsed from the
//      `describe("METHOD /api/…")` blocks and their `.status).toBe(NNN)`
//      expectations.
//
// Only the generator script (scripts/generate-ledger.ts) and the contract
// tests run this; the app itself renders the checked-in
// app/ledger.generated.json artifact. The output is deterministic for a given
// state of the OmniLens sources — that is what makes the artifact diffable
// and the drift guard possible.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * The OmniLens checkout the ledger audits. Configurable via the OMNILENS_REPO
 * env var; defaults to a sibling checkout next to this repo
 * (…/GitHub/test-ledger -> …/GitHub/OmniLens).
 */
export const OMNILENS_ROOT = process.env.OMNILENS_REPO
  ? path.resolve(process.env.OMNILENS_REPO)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../OmniLens');

/** The app whose spec + tests the ledger audits. */
export const WEB_ROOT = path.join(OMNILENS_ROOT, 'apps/web');

/** The spec the audited operations come from. */
export const OPENAPI_SPEC_PATH = path.join(
  WEB_ROOT,
  'app/api/openapi/openapi.generated.json'
);

// ============================================================================
// Types
// ============================================================================

export interface TestSnippet {
  /** it() title */
  title: string;
  /** dedented source of the it() block */
  source: string;
  /** 1-indexed line in the test file where the block starts */
  startLine: number;
}

export interface StatusCoverage {
  /** HTTP status code, e.g. "200" */
  code: string;
  /** Response description from the OpenAPI spec (empty for undocumented) */
  description: string;
  /** Whether the spec documents this status for the operation */
  documented: boolean;
  /** Number of test assertions hitting this status for this method */
  assertions: number;
  /** The it() blocks asserting this status */
  snippets: TestSnippet[];
}

export interface OperationCoverage {
  method: string;
  specPath: string;
  summary: string;
  /** Path of the colocated test file relative to the OmniLens repo root, if one exists */
  testFile: string | null;
  /** Number of it() blocks in this method's describe segments */
  testCount: number;
  statuses: StatusCoverage[];
  /** Documented statuses with at least one assertion */
  coveredCount: number;
  /** Documented statuses with no assertions */
  gapCount: number;
}

export interface TagCoverage {
  tag: string;
  description: string;
  operations: OperationCoverage[];
  coveredCount: number;
  totalCount: number;
}

export interface CoverageReport {
  tags: TagCoverage[];
  operationCount: number;
  /** documented (path, method, status) pairs with assertions */
  coveredCount: number;
  totalCount: number;
  /** operations whose route has no test file at all */
  untestedOperations: number;
}

// ============================================================================
// Test-file parsing
// ============================================================================

interface MethodTestEvidence {
  /** statuses asserted, with assertion counts */
  statuses: Map<string, number>;
  /** it() blocks per asserted status */
  snippets: Map<string, TestSnippet[]>;
  testCount: number;
}

const STATUS_ASSERT_RE = /\.status\)\.(?:toBe|toEqual)\(\s*(\d{3})\s*\)/g;

/** Strip the common leading indentation from an extracted block */
function dedent(block: string): string {
  const lines = block.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)![0].length);
  const cut = Math.min(...indents);
  return lines.map((line) => line.slice(cut)).join('\n');
}

/**
 * Extract the it()/test() blocks from a describe segment. Blocks end at the
 * first `});` back at the block's own indentation — reliable for this repo's
 * prettier-consistent test files.
 */
function extractItBlocks(
  segment: string,
  segmentOffset: number,
  fullSource: string
): Array<{ title: string; source: string; startLine: number; statuses: string[] }> {
  const blocks: Array<{ title: string; source: string; startLine: number; statuses: string[] }> = [];
  const itRe = /(?:^|\n)([ \t]*)(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g;

  let match: RegExpExecArray | null;
  while ((match = itRe.exec(segment)) !== null) {
    const indent = match[1];
    const title = match[2];
    const blockStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const closer = `\n${indent}});`;
    const closeIndex = segment.indexOf(closer, blockStart);
    const blockEnd = closeIndex === -1 ? segment.length : closeIndex + closer.length;
    const source = segment.slice(blockStart, blockEnd);

    blocks.push({
      title,
      source: dedent(source),
      startLine: fullSource.slice(0, segmentOffset + blockStart).split('\n').length,
      statuses: [...source.matchAll(STATUS_ASSERT_RE)].map((m) => m[1])
    });
  }
  return blocks;
}

/**
 * Parse a route.test.ts source into per-method evidence. Test files follow the
 * `describe("METHOD /api/…", …)` convention; each describe segment is scanned
 * for `.status).toBe(NNN)` / `.status).toEqual(NNN)` assertions and it() blocks.
 */
function parseTestFile(source: string): Map<string, MethodTestEvidence> {
  const byMethod = new Map<string, MethodTestEvidence>();
  const describeRe = /describe\(\s*["'`]([^"'`]+)["'`]/g;

  const segments: Array<{ method: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = describeRe.exec(source)) !== null) {
    const title = match[1];
    const methodMatch = title.match(/^(GET|POST|PUT|DELETE|PATCH)\b/);
    if (segments.length > 0) segments[segments.length - 1].end = match.index;
    segments.push({
      method: methodMatch ? methodMatch[1].toLowerCase() : '',
      start: match.index,
      end: source.length
    });
  }

  for (const segment of segments) {
    if (!segment.method) continue;
    const body = source.slice(segment.start, segment.end);
    const evidence =
      byMethod.get(segment.method) ??
      { statuses: new Map(), snippets: new Map(), testCount: 0 };

    for (const statusMatch of body.matchAll(STATUS_ASSERT_RE)) {
      const code = statusMatch[1];
      evidence.statuses.set(code, (evidence.statuses.get(code) ?? 0) + 1);
    }

    const blocks = extractItBlocks(body, segment.start, source);
    evidence.testCount += blocks.length;
    for (const block of blocks) {
      for (const code of new Set(block.statuses)) {
        const list = evidence.snippets.get(code) ?? [];
        list.push({ title: block.title, source: block.source, startLine: block.startLine });
        evidence.snippets.set(code, list);
      }
    }

    byMethod.set(segment.method, evidence);
  }

  return byMethod;
}

// ============================================================================
// Report assembly
// ============================================================================

/** Map an OpenAPI path back to its route directory: /api/repo/{slug} -> app/api/repo/[slug] */
function specPathToRouteDir(specPath: string): string {
  return path.join(
    WEB_ROOT,
    'app',
    ...specPath
      .replace(/^\//, '')
      .split('/')
      .map((part) => part.replace(/^\{(.+)\}$/, '[$1]'))
  );
}

export function buildCoverageReport(): CoverageReport {
  const spec = JSON.parse(fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8')) as {
    tags?: Array<{ name: string; description?: string }>;
    paths: Record<
      string,
      Record<string, { summary?: string; tags?: string[]; responses?: Record<string, { description?: string }> }>
    >;
  };

  const tagOrder = (spec.tags ?? []).map((t) => t.name);
  const tagDescriptions = new Map((spec.tags ?? []).map((t) => [t.name, t.description ?? '']));
  const byTag = new Map<string, OperationCoverage[]>();

  for (const [specPath, methods] of Object.entries(spec.paths)) {
    const routeDir = specPathToRouteDir(specPath);
    const testFileAbs = path.join(routeDir, 'route.test.ts');
    const hasTestFile = fs.existsSync(testFileAbs);
    const evidence = hasTestFile
      ? parseTestFile(fs.readFileSync(testFileAbs, 'utf8'))
      : new Map<string, MethodTestEvidence>();

    for (const [method, operation] of Object.entries(methods)) {
      const methodEvidence = evidence.get(method);
      const documented = Object.entries(operation.responses ?? {});
      const assertedCodes = methodEvidence?.statuses ?? new Map<string, number>();

      const statuses: StatusCoverage[] = documented.map(([code, response]) => ({
        code,
        description: response.description ?? '',
        documented: true,
        assertions: assertedCodes.get(code) ?? 0,
        snippets: methodEvidence?.snippets.get(code) ?? []
      }));
      // Statuses the tests exercise but the spec doesn't document
      for (const [code, assertions] of assertedCodes) {
        if (!statuses.some((s) => s.code === code)) {
          statuses.push({
            code,
            description: '',
            documented: false,
            assertions,
            snippets: methodEvidence?.snippets.get(code) ?? []
          });
        }
      }
      statuses.sort((a, b) => a.code.localeCompare(b.code));

      const coveredCount = statuses.filter((s) => s.documented && s.assertions > 0).length;
      const gapCount = statuses.filter((s) => s.documented && s.assertions === 0).length;

      const op: OperationCoverage = {
        method,
        specPath,
        summary: operation.summary ?? '',
        testFile: hasTestFile
          ? path.relative(OMNILENS_ROOT, testFileAbs).split(path.sep).join('/')
          : null,
        testCount: methodEvidence?.testCount ?? 0,
        statuses,
        coveredCount,
        gapCount
      };

      const tag = operation.tags?.[0] ?? 'Other';
      byTag.set(tag, [...(byTag.get(tag) ?? []), op]);
    }
  }

  const tags: TagCoverage[] = [...byTag.entries()]
    .sort(([a], [b]) => {
      const ai = tagOrder.indexOf(a);
      const bi = tagOrder.indexOf(b);
      return (ai === -1 ? tagOrder.length : ai) - (bi === -1 ? tagOrder.length : bi);
    })
    .map(([tag, operations]) => ({
      tag,
      description: tagDescriptions.get(tag) ?? '',
      operations,
      coveredCount: operations.reduce((n, op) => n + op.coveredCount, 0),
      totalCount: operations.reduce((n, op) => n + op.coveredCount + op.gapCount, 0)
    }));

  const operations = tags.flatMap((t) => t.operations);
  return {
    tags,
    operationCount: operations.length,
    coveredCount: tags.reduce((n, t) => n + t.coveredCount, 0),
    totalCount: tags.reduce((n, t) => n + t.totalCount, 0),
    untestedOperations: operations.filter((op) => op.testFile === null || op.testCount === 0).length
  };
}
