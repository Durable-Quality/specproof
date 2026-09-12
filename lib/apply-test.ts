// Writes a suggested test into the audited repo — the other half of the
// suggestion the panel shows.
//
// Node-only, and deliberately narrow: the caller names an operation and a
// status, never a file body. The content written is rebuilt here from the
// spec, so the route below this can be handed nothing worth injecting.

import fs from 'fs';
import path from 'path';

import { operationKey } from './api-test-coverage';
import type { SuggestedTest } from './test-suggestion';

export interface ApplyResult {
  /** The file written, relative to the repo root */
  file: string;
  /** Whether the file had to be created */
  created: boolean;
  /** Whether the framework import line was added to an existing file */
  addedImport: boolean;
  /** Whether the BASE_URL declaration was added to an existing file */
  addedBaseUrl: boolean;
}

/** Re-indent a block that was built for a top-level describe. */
function indentBy(block: string, spaces: number): string {
  if (spaces === 0) return block;
  const pad = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((line) => (line.trim() === '' ? line : pad + line))
    .join('\n');
}

/**
 * Locate the describe block for one operation: its start offset and the
 * indentation it sits at. Matched through `operationKey` rather than on the
 * literal title, so a suite written `GET /tasks/:taskId` is found for a spec
 * that writes `/tasks/{taskId}` — the same equivalence the analyzer joins on.
 */
function findDescribe(
  source: string,
  method: string,
  specPath: string
): { start: number; indent: string } | null {
  const wanted = operationKey(method, specPath);
  const describeRe = /describe\(\s*["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = describeRe.exec(source)) !== null) {
    const title = match[1].match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/);
    if (!title || operationKey(title[1], title[2]) !== wanted) continue;
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    return { start: match.index, indent: source.slice(lineStart, match.index) };
  }
  return null;
}

/**
 * Reconcile the framework import with what the file already has. Three cases:
 * the file imports nothing from that module (add the line), it imports the
 * module but not every name the block needs (merge the missing ones into the
 * existing braces), or it has them all (leave it alone).
 *
 * The middle two are why an exact-string match isn't enough: a suite that
 * opens `import { beforeAll, describe, expect, it } from "vitest"` does not
 * contain the suggestion's import line verbatim, and adding it anyway
 * redeclares all three names and breaks the file.
 */
function reconcileImport(
  source: string,
  importLine: string
): { source: string; addedImport: boolean } {
  const wanted = importLine.match(/^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/);
  if (!wanted) return { source, addedImport: false };
  const names = wanted[1].split(',').map((name) => name.trim()).filter(Boolean);
  const module = wanted[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const existing = source.match(
    new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*["']${module}["'];?[ \\t]*$`, 'm')
  );
  if (!existing) return { source, addedImport: false }; // caller inserts the line

  const have = existing[1].split(',').map((name) => name.trim()).filter(Boolean);
  const missing = names.filter((name) => !have.includes(name));
  if (missing.length === 0) return { source, addedImport: false };
  return {
    source: source.replace(
      existing[0],
      existing[0].replace(existing[1], ` ${[...have, ...missing].join(', ')} `)
    ),
    addedImport: true,
  };
}

/** Whether the file already imports anything from the framework's module. */
function importsModule(source: string, importLine: string): boolean {
  const module = importLine.match(/from\s*["']([^"']+)["']/)?.[1];
  if (!module) return true;
  return new RegExp(`from\\s*["']${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(source);
}

/** The offset just past the file's last top-level import/require line. */
function endOfImports(source: string): number {
  const importRe = /^(?:import\s[^\n]*|const\s[^\n]*=\s*require\([^\n]*)\n/gm;
  let end = 0;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    end = match.index + match[0].length;
  }
  return end;
}

/**
 * Write `suggestion` into `file` (repo-relative) inside `repoRoot`.
 *
 * Three shapes, in the order they are tried: the file doesn't exist (write it
 * whole), the file has a describe block for this operation (insert the it()
 * block at the end of it, where the analyzer will find it under the same
 * title), or it doesn't (append a new describe block). The last two top up
 * whatever the inserted block depends on — the framework import and the
 * BASE_URL declaration — only when the file lacks them.
 */
export function applySuggestedTest(
  repoRoot: string,
  file: string,
  suggestion: SuggestedTest,
  operation: { method: string; specPath: string }
): ApplyResult {
  const target = path.resolve(repoRoot, file);
  const inside = path.relative(repoRoot, target);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`apply-test: refusing to write outside the audited repo: ${file}`);
  }

  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, suggestion.contents);
    return { file: inside, created: true, addedImport: false, addedBaseUrl: false };
  }

  let source = fs.readFileSync(target, 'utf8');
  // Asked of the file as it was found: the block about to be inserted reads
  // BASE_URL itself, so checking after the insertion would always find it.
  const addedBaseUrl = !/\bBASE_URL\b/.test(source);
  const merged = reconcileImport(source, suggestion.importLine);
  source = merged.source;
  // Only when the module isn't imported at all does a whole line get added;
  // otherwise reconcileImport has already topped up the names in place.
  const needsImportLine =
    suggestion.importLine !== '' && !importsModule(source, suggestion.importLine);
  const addedImport = merged.addedImport || needsImportLine;
  const describe = findDescribe(source, operation.method, operation.specPath);

  if (describe) {
    // The analyzer ends an it() block at the first `})` back at the block's own
    // indentation; the describe's own closer is found the same way, so the
    // insertion point is the one the parser would agree is inside it.
    const closer = `\n${describe.indent}})`;
    const closeIndex = source.indexOf(closer, describe.start);
    const at = closeIndex === -1 ? source.length : closeIndex;
    const block = indentBy(suggestion.block, describe.indent.length);
    source = `${source.slice(0, at)}\n\n${block}${source.slice(at)}`;
  } else {
    source = `${source.replace(/\n*$/, '')}\n\n${suggestion.describeBlock}\n`;
  }

  if (addedBaseUrl || needsImportLine) {
    // Below whatever the file already imports, so the additions read as part
    // of its preamble rather than as something bolted on above it.
    const at = endOfImports(source);
    const preamble = [
      needsImportLine ? suggestion.importLine : null,
      // A blank line between the import block and the declaration, the way
      // the file's own preamble is already spaced.
      addedBaseUrl ? `${at === 0 && !needsImportLine ? '' : '\n'}${suggestion.baseUrlLine}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
    const separator = at === 0 ? '\n\n' : '\n';
    source = `${source.slice(0, at)}${preamble}${separator}${source.slice(at)}`;
  }

  fs.writeFileSync(target, source);
  return { file: inside, created: false, addedImport, addedBaseUrl };
}
