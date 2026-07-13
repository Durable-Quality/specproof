// Coverage analyzer for SpecProof — the source the generated proof is
// compiled from.
//
// Joins two sources of truth in the audited target repo:
//   1. The OpenAPI spec (auto-discovered `openapi*.json` / `swagger*.json`,
//      or SPECPROOF_SPEC) — every documented operation and its response status
//      codes.
//   2. The repo's test files (`*.test.ts` / `*.test.tsx` / `*.test.js`) —
//      which statuses each operation actually has assertions for, parsed from
//      `describe("METHOD /path")` blocks and their `.status).toBe(NNN)`
//      expectations.
//
// Only the generator script (scripts/generate-proof.ts) and the contract
// tests run this; the app itself renders the checked-in
// app/proof.generated.json artifact. The output is deterministic for a given
// state of the target repo — that is what makes the artifact diffable and the
// drift guard possible.

import fs from 'fs';
import path from 'path';

/**
 * The repo the proof audits. Configurable via the SPECPROOF_REPO env var;
 * defaults to the directory SpecProof is run from, so installing it into a
 * repo and running the generator there just works.
 */
export const TARGET_REPO_ROOT = process.env.SPECPROOF_REPO
  ? path.resolve(process.env.SPECPROOF_REPO)
  : process.cwd();

/** Directories never worth scanning for specs or tests */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.vercel'
]);

const SPEC_FILE_RE = /^(?:openapi|swagger)[^/]*\.json$/i;
const TEST_FILE_RE = /\.test\.(?:ts|tsx|js|jsx)$/;

/** Recursively collect files matching `matches`, skipping EXCLUDED_DIRS */
function walk(dir: string, matches: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        found.push(...walk(path.join(dir, entry.name), matches));
      }
    } else if (matches(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Locate the OpenAPI spec in the target repo: SPECPROOF_SPEC (relative to the
 * repo root, or absolute) wins; otherwise the shallowest `openapi*.json` /
 * `swagger*.json` in the tree. Returns null when there is nothing to audit.
 */
export function resolveSpecPath(repoRoot: string = TARGET_REPO_ROOT): string | null {
  if (process.env.SPECPROOF_SPEC) {
    const explicit = path.resolve(repoRoot, process.env.SPECPROOF_SPEC);
    return fs.existsSync(explicit) ? explicit : null;
  }
  if (!fs.existsSync(repoRoot)) return null;
  const candidates = walk(repoRoot, (name) => SPEC_FILE_RE.test(name)).sort(
    (a, b) =>
      a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b)
  );
  return candidates[0] ?? null;
}

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
  /** Path of the operation's test file relative to the target repo root, if one exists */
  testFile: string | null;
  /** Number of it() blocks in this operation's describe segments */
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
  /** operations with no test evidence at all */
  untestedOperations: number;
}

// ============================================================================
// Test-file parsing
// ============================================================================

interface OperationEvidence {
  /** test file the evidence came from, relative to the repo root */
  testFile: string;
  /** statuses asserted, with assertion counts */
  statuses: Map<string, number>;
  /** it() blocks per asserted status */
  snippets: Map<string, TestSnippet[]>;
  testCount: number;
}

const STATUS_ASSERT_RE = /\.status\)\.(?:toBe|toEqual)\(\s*(\d{3})\s*\)/g;

/**
 * Normalize a URL path for joining spec operations against describe titles:
 * `{param}`, `[param]`, and `:param` segments are interchangeable, and a
 * trailing slash is ignored.
 */
function normalizePath(urlPath: string): string {
  return urlPath
    .replace(/\/$/, '')
    .split('/')
    .map((part) =>
      part.replace(/^\{(.+)\}$/, '{}').replace(/^\[(.+)\]$/, '{}').replace(/^:(.+)$/, '{}')
    )
    .join('/');
}

/** Join key for one operation: "get /api/repo/{}" */
function operationKey(method: string, urlPath: string): string {
  return `${method.toLowerCase()} ${normalizePath(urlPath)}`;
}

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
 * first `});` back at the block's own indentation — reliable for
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
 * Parse a test file's source into per-operation evidence, keyed by
 * operationKey. The convention joined on is `describe("METHOD /path", …)` —
 * each such segment is scanned for `.status).toBe(NNN)` /
 * `.status).toEqual(NNN)` assertions and it() blocks. describe blocks whose
 * title doesn't start with an HTTP method + path are ignored.
 */
function parseTestFile(source: string, testFile: string): Map<string, OperationEvidence> {
  const byOperation = new Map<string, OperationEvidence>();
  const describeRe = /describe\(\s*["'`]([^"'`]+)["'`]/g;

  const segments: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = describeRe.exec(source)) !== null) {
    const title = match[1];
    const titleMatch = title.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/);
    if (segments.length > 0) segments[segments.length - 1].end = match.index;
    segments.push({
      key: titleMatch ? operationKey(titleMatch[1], titleMatch[2]) : '',
      start: match.index,
      end: source.length
    });
  }

  for (const segment of segments) {
    if (!segment.key) continue;
    const body = source.slice(segment.start, segment.end);
    const evidence =
      byOperation.get(segment.key) ??
      { testFile, statuses: new Map(), snippets: new Map(), testCount: 0 };

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

    byOperation.set(segment.key, evidence);
  }

  return byOperation;
}

/**
 * Scan the whole target repo for test files and index their evidence by
 * operation. When several files describe the same operation, the one with the
 * most it() blocks wins (ties broken alphabetically) — snippets must all cite
 * a single file.
 */
function collectTestEvidence(repoRoot: string): Map<string, OperationEvidence> {
  const best = new Map<string, OperationEvidence>();
  const testFiles = walk(repoRoot, (name) => TEST_FILE_RE.test(name)).sort();

  for (const testFileAbs of testFiles) {
    const testFile = path.relative(repoRoot, testFileAbs).split(path.sep).join('/');
    const parsed = parseTestFile(fs.readFileSync(testFileAbs, 'utf8'), testFile);
    for (const [key, evidence] of parsed) {
      const current = best.get(key);
      if (!current || evidence.testCount > current.testCount) {
        best.set(key, evidence);
      }
    }
  }
  return best;
}

// ============================================================================
// Report assembly
// ============================================================================

export function buildCoverageReport(): CoverageReport {
  const specPath = resolveSpecPath();
  if (!specPath) {
    throw new Error(
      `api-test-coverage: no OpenAPI spec found under ${TARGET_REPO_ROOT} — ` +
        'set SPECPROOF_REPO to the repo to audit, or SPECPROOF_SPEC to the spec file'
    );
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
    tags?: Array<{ name: string; description?: string }>;
    paths: Record<
      string,
      Record<string, { summary?: string; tags?: string[]; responses?: Record<string, { description?: string }> }>
    >;
  };

  const evidenceByOperation = collectTestEvidence(TARGET_REPO_ROOT);
  const tagOrder = (spec.tags ?? []).map((t) => t.name);
  const tagDescriptions = new Map((spec.tags ?? []).map((t) => [t.name, t.description ?? '']));
  const byTag = new Map<string, OperationCoverage[]>();

  for (const [specPathKey, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const methodEvidence = evidenceByOperation.get(operationKey(method, specPathKey));
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
        specPath: specPathKey,
        summary: operation.summary ?? '',
        testFile: methodEvidence?.testFile ?? null,
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
