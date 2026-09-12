// Documents a response in the audited repo's OpenAPI spec — the other half of
// closing a `MISSING FROM SPEC` + `NO TEST` row.
//
// A gap with no test and no documentation is two holes, not one: the test
// proves the response happens, the spec says it is meant to. Applying only the
// test would leave the row stamped MISSING FROM SPEC forever, so apply writes
// both and says so.
//
// Formatting is preserved as far as each format allows. YAML goes through
// `parseDocument`, which keeps comments, quoting style, and key order intact
// and touches only the lines it adds. JSON is re-serialized at the indentation
// the file already uses — the one unavoidable side effect being that JS orders
// integer-like keys (status codes) ascending, which is the order specs are
// written in anyway.

import fs from 'fs';

import { parseDocument } from 'yaml';

/**
 * The description written for a status SpecProof is documenting on the
 * author's behalf. A response with an empty description renders as
 * NO DESCRIPTION, so leaving it blank would trade one stamp for another; these
 * are the plain meanings of the codes, not a claim about this API's behaviour
 * beyond the one the row already makes.
 */
const DESCRIPTIONS: Record<string, string> = {
  '200': 'OK',
  '201': 'Created',
  '202': 'Accepted',
  '204': 'No content',
  '400': 'Invalid request',
  '401': 'Authentication required',
  '403': 'Not permitted',
  '404': 'Not found',
  '409': 'Conflict',
  '410': 'Gone',
  '415': 'Unsupported media type',
  '422': 'Validation failed',
  '429': 'Too many requests',
  '500': 'Unexpected server error',
  '502': 'Upstream error',
  '503': 'Service unavailable',
  '504': 'Upstream timeout',
};

export function describeStatus(status: string): string {
  return DESCRIPTIONS[status] ?? `Response ${status}`;
}

export interface SpecEdit {
  /** Whether the spec was changed (false when it already documented the status) */
  added: boolean;
  /** The description written */
  description: string;
}

/** The indentation a JSON file already uses, so re-serializing matches it. */
function jsonIndent(source: string): number {
  const indented = source.match(/\n([ \t]+)\S/);
  if (!indented) return 2;
  return indented[1].startsWith('\t') ? 2 : indented[1].length;
}

/**
 * Add `status` to an operation's `responses` in the spec at `specFile`.
 * A no-op when the spec already documents it, so applying a second status to
 * the same operation can't disturb the first.
 */
export function documentResponse(
  specFile: string,
  method: string,
  specPath: string,
  status: string
): SpecEdit {
  const description = describeStatus(status);
  const source = fs.readFileSync(specFile, 'utf8').replace(/^\uFEFF/, '');
  const at = ['paths', specPath, method.toLowerCase(), 'responses', status];

  if (/\.ya?ml$/i.test(specFile)) {
    const doc = parseDocument(source);
    if (doc.getIn(at) !== undefined) return { added: false, description };
    doc.setIn([...at, 'description'], description);
    fs.writeFileSync(specFile, String(doc));
    return { added: true, description };
  }

  const spec = JSON.parse(source) as Record<string, never>;
  let node: Record<string, unknown> = spec;
  for (const key of at.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  if (node[status] !== undefined) return { added: false, description };
  node[status] = { description };
  fs.writeFileSync(specFile, JSON.stringify(spec, null, jsonIndent(source)) + '\n');
  return { added: true, description };
}
