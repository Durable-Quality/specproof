// The test SpecProof suggests for a response nothing asserts.
//
// Deliberately free of `fs` and `path`: the same function runs in the browser,
// where the panel renders the suggestion from the checked-in proof with no
// target checkout behind it, and on the server, where the apply route writes
// it into the repo. One implementation means what the panel shows is exactly
// what apply writes.
//
// Every suggestion is written in the shape the analyzer reads back:
// `describe("METHOD /path")` around `expect(res.status).toBe(NNN)`. That is
// not a style preference — a suggestion SpecProof could not parse would leave
// the row stamped NO TEST after the test was applied.

import type { TestFrameworkId } from './api-test-coverage';

export interface SuggestionInput {
  method: string;
  /** The operation path as the spec writes it, `{param}` braces and all */
  specPath: string;
  /** The status code the suggested test asserts */
  status: string;
  /** Whether the operation declares a request body — it decides the fetch init */
  hasRequestBody: boolean;
  framework: TestFrameworkId;
  /**
   * Whether the target file already has a describe block for this operation
   * (the test is inserted into it) or has to be written from scratch.
   */
  mode: 'append' | 'create';
}

export interface SuggestedTest {
  /** The it() title, also the line the analyzer quotes back as evidence */
  title: string;
  /** The it() block, indented as it sits inside a top-level describe */
  block: string;
  /** `block` wrapped in its describe, for a file that has no such block yet */
  describeBlock: string;
  /** The whole file, for a target that doesn't exist yet */
  contents: string;
  /** What the panel shows: the file for `create`, the block for `append` */
  preview: string;
  /** The framework's import line; empty for Jest, whose globals need none */
  importLine: string;
  /** The declaration `block` reads the API's origin from */
  baseUrlLine: string;
}

const BASE_URL_LINE = 'const BASE_URL = process.env.API_URL ?? "http://localhost:3000";';

const IMPORT_LINE: Record<TestFrameworkId, string> = {
  vitest: 'import { describe, expect, it } from "vitest";',
  bun: 'import { describe, expect, it } from "bun:test";',
  // Jest injects describe/expect/it as globals, so an import here would be
  // noise in most repos and wrong in the ones configured without `injectGlobals`.
  jest: '',
};

/** `{task_id}` / `:taskId` / `[taskId]` → the identifier a const can be named */
function parameterNames(specPath: string): string[] {
  return specPath
    .split('/')
    .map((part) => part.match(/^\{(.+)\}$/)?.[1] ?? part.match(/^\[(.+)\]$/)?.[1] ?? part.match(/^:(.+)$/)?.[1])
    .filter((name): name is string => Boolean(name))
    .map((name) => name.replace(/[^A-Za-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()))
    .map((name) => name.replace(/[^A-Za-z0-9]/g, ''));
}

/**
 * The it() title. Phrased as the behaviour the status stands for rather than
 * as the code alone, because the title is what the audit view quotes back as
 * evidence once the test exists.
 */
function titleFor(status: string, lastParam: string | null): string {
  switch (status) {
    case '400':
      return 'returns 400 for a malformed request body';
    case '401':
      return 'returns 401 without credentials';
    case '403':
      return 'returns 403 for a caller without access';
    case '404':
      return `returns 404 when the ${lastParam ?? 'resource'} does not exist`;
    case '409':
      return 'returns 409 for a conflicting request';
    case '422':
      return 'returns 422 for a payload that fails validation';
    case '429':
      return 'returns 429 once the rate limit is exceeded';
    default:
      if (status.startsWith('2')) return `returns ${status} for a valid request`;
      if (status.startsWith('5')) return `returns ${status} when the handler fails`;
      return `returns ${status}`;
  }
}

/** The `fetch` init lines, past the method. */
function requestInit(input: SuggestionInput): string[] {
  const lines = [`      method: "${input.method.toUpperCase()}",`];
  if (input.status === '401') {
    lines.push('      // deliberately sent without an Authorization header');
  }
  if (input.hasRequestBody && !/^(get|delete|head)$/i.test(input.method)) {
    lines.push('      headers: { "content-type": "application/json" },');
    const payload =
      input.status === '400'
        ? '// TODO: a body the API should reject as malformed'
        : input.status === '422'
          ? '// TODO: a well-formed body whose values fail validation'
          : '// TODO: a valid payload for this operation';
    lines.push(`      ${payload}`);
    lines.push('      body: JSON.stringify({}),');
  }
  return lines;
}

export function buildSuggestedTest(input: SuggestionInput): SuggestedTest {
  const method = input.method.toUpperCase();
  const params = parameterNames(input.specPath);
  const lastParam = params.length > 0 ? params[params.length - 1] : null;
  const title = titleFor(input.status, lastParam);

  // A 404 is the one status whose whole point is an address that resolves to
  // nothing, so it gets a literal missing id rather than a placeholder the
  // reader has to fill in. Every other status wants an id that exists.
  const missingLast = input.status === '404' && lastParam !== null;
  let index = 0;
  const url = input.specPath
    .split('/')
    .map((part) => {
      if (!/^(?:\{.+\}|\[.+\]|:.+)$/.test(part)) return part;
      const name = params[index++];
      const isLast = index === params.length;
      return missingLast && isLast ? 'does-not-exist' : '${' + name + '}';
    })
    .join('/');

  const declared = missingLast ? params.slice(0, -1) : params;
  const body: string[] = [];
  if (declared.length > 0) {
    body.push('    // TODO: values that exist when this test runs');
    for (const name of declared) body.push(`    const ${name} = "REPLACE_ME";`);
    body.push('');
  }
  if (input.status.startsWith('5')) {
    body.push('    // TODO: arrange the failure this status stands for');
  }
  body.push('    const res = await fetch(`${BASE_URL}' + url + '`, {');
  body.push(...requestInit(input));
  body.push('    });');
  body.push('');
  body.push(`    expect(res.status).toBe(${input.status});`);

  const block = [`  it("${title}", async () => {`, ...body, '  });'].join('\n');
  const describeBlock = [`describe("${method} ${input.specPath}", () => {`, block, '});'].join('\n');
  const importLine = IMPORT_LINE[input.framework];
  const contents =
    [importLine, importLine ? '' : null, BASE_URL_LINE, '', describeBlock]
      .filter((line) => line !== null)
      .join('\n')
      .replace(/^\n/, '') + '\n';

  return {
    title,
    block,
    describeBlock,
    contents,
    preview: input.mode === 'create' ? contents.trimEnd() : block,
    importLine,
    baseUrlLine: BASE_URL_LINE,
  };
}
