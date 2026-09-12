import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseTestFile } from "@/lib/api-test-coverage";
import { applySuggestedTest } from "@/lib/apply-test";
import { buildSuggestedTest } from "@/lib/test-suggestion";

/**
 * Writing the suggestion into the audited repo. The assertion that matters in
 * every case is the same one the suggestion module guards: after applying, the
 * analyzer reads the file back and finds the status covered. A write that
 * lands somewhere the parser doesn't look has done nothing.
 */

const made: string[] = [];

function repo(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specproof-apply-"));
  made.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

function apply(
  root: string,
  file: string,
  options: { method?: string; specPath?: string; status?: string; mode?: "append" | "create" } = {},
) {
  const operation = {
    method: options.method ?? "get",
    specPath: options.specPath ?? "/widgets",
  };
  const suggestion = buildSuggestedTest({
    ...operation,
    status: options.status ?? "500",
    hasRequestBody: false,
    framework: "vitest",
    mode: options.mode ?? "append",
  });
  const result = applySuggestedTest(root, file, suggestion, operation);
  return { result, source: fs.readFileSync(path.join(root, file), "utf8") };
}

afterEach(() => {
  for (const root of made.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("applySuggestedTest", () => {
  it("creates the file, and the directory above it, when there is none", () => {
    const root = repo();
    const { result, source } = apply(root, "tests/widgets-get.test.ts", { mode: "create" });

    expect(result).toEqual({
      file: "tests/widgets-get.test.ts",
      created: true,
      addedImport: false,
      addedBaseUrl: false,
    });
    expect(parseTestFile(source, "t").get("get /widgets")?.statuses.get("500")).toBe(1);
  });

  it("inserts into the describe block that already covers the operation", () => {
    const root = repo({
      "tests/widgets.test.ts": [
        'import { describe, expect, it } from "vitest";',
        "",
        'const BASE_URL = "http://localhost:3000";',
        "",
        'describe("GET /widgets", () => {',
        '  it("returns 200", async () => {',
        "    const res = await fetch(`${BASE_URL}/widgets`);",
        "",
        "    expect(res.status).toBe(200);",
        "  });",
        "});",
        "",
      ].join("\n"),
    });
    const { result, source } = apply(root, "tests/widgets.test.ts");

    expect(result.created).toBe(false);
    expect(result.addedImport).toBe(false);
    expect(result.addedBaseUrl).toBe(false);
    // One describe, both statuses inside it — not a second block for the
    // same operation, which the analyzer would resolve by picking a winner.
    expect(source.match(/describe\(/g)).toHaveLength(1);
    const evidence = parseTestFile(source, "t").get("get /widgets");
    expect(evidence?.testCount).toBe(2);
    expect(evidence?.statuses.get("200")).toBe(1);
    expect(evidence?.statuses.get("500")).toBe(1);
  });

  it("matches a describe written in the repo's own path style", () => {
    const root = repo({
      "tests/widgets.test.ts": [
        'const BASE_URL = "x";',
        'describe("GET /widgets/:widgetId", () => {',
        '  it("returns 200", async () => {',
        "    expect(res.status).toBe(200);",
        "  });",
        "});",
        "",
      ].join("\n"),
    });
    const { source } = apply(root, "tests/widgets.test.ts", {
      specPath: "/widgets/{widgetId}",
      status: "404",
    });
    expect(source.match(/describe\(/g)).toHaveLength(1);
    expect(parseTestFile(source, "t").get("get /widgets/{}")?.testCount).toBe(2);
  });

  it("appends a new describe block to a file that covers other operations", () => {
    const root = repo({
      "tests/widgets.test.ts": [
        'import { describe, expect, it } from "vitest";',
        "",
        'const BASE_URL = "http://localhost:3000";',
        "",
        'describe("GET /gadgets", () => {',
        '  it("returns 200", async () => {',
        "    expect(res.status).toBe(200);",
        "  });",
        "});",
        "",
      ].join("\n"),
    });
    const { source } = apply(root, "tests/widgets.test.ts");

    expect(source.match(/describe\(/g)).toHaveLength(2);
    expect(parseTestFile(source, "t").get("get /widgets")?.statuses.get("500")).toBe(1);
    expect(parseTestFile(source, "t").get("get /gadgets")?.statuses.get("200")).toBe(1);
  });

  it("tops up only what the file is missing", () => {
    const root = repo({ "tests/widgets.test.ts": "// a suite with neither yet\n" });
    const { result, source } = apply(root, "tests/widgets.test.ts");

    expect(result).toMatchObject({ addedImport: true, addedBaseUrl: true });
    expect(source).toContain('import { describe, expect, it } from "vitest";');
    expect(source.match(/BASE_URL =/g)).toHaveLength(1);

    // Applying a second status must not add either a second time.
    const again = apply(root, "tests/widgets.test.ts", { status: "404" });
    expect(again.result).toMatchObject({ addedImport: false, addedBaseUrl: false });
    expect(again.source.match(/BASE_URL =/g)).toHaveLength(1);
    expect(again.source.match(/from "vitest"/g)).toHaveLength(1);
  });

  it("never redeclares names the file already imports from the framework", () => {
    // The shape that broke a real suite: every name is already there, just
    // alongside another, so the suggestion's import line is not a substring.
    const root = repo({
      "tests/widgets.test.ts": [
        'import { beforeAll, describe, expect, it } from "vitest";',
        "",
        'import { api } from "./client";',
        "",
        'describe("GET /widgets", () => {',
        '  it("returns 200", async () => {',
        "    expect(res.status).toBe(200);",
        "  });",
        "});",
        "",
      ].join("\n"),
    });
    const { result, source } = apply(root, "tests/widgets.test.ts");

    expect(result.addedImport).toBe(false);
    expect(source.match(/from "vitest"/g)).toHaveLength(1);
    expect(source).toContain('import { beforeAll, describe, expect, it } from "vitest";');
  });

  it("merges the names it needs into an import the file already has", () => {
    const root = repo({
      "tests/widgets.test.ts": ['import { beforeAll } from "vitest";', "", "// suite", ""].join(
        "\n",
      ),
    });
    const { result, source } = apply(root, "tests/widgets.test.ts");

    expect(result.addedImport).toBe(true);
    expect(source.match(/from "vitest"/g)).toHaveLength(1);
    expect(source).toContain('import { beforeAll, describe, expect, it } from "vitest";');
  });

  it("puts what it adds below the existing imports", () => {
    const root = repo({
      "tests/widgets.test.ts": ['import { api } from "./client";', "", "// suite", ""].join("\n"),
    });
    const { source } = apply(root, "tests/widgets.test.ts");
    const lines = source.split("\n");
    expect(lines[0]).toBe('import { api } from "./client";');
    expect(lines[1]).toContain("vitest");
    expect(lines[2]).toBe("");
    expect(lines[3]).toContain("BASE_URL");
  });

  it("refuses to write outside the audited repo", () => {
    const root = repo();
    expect(() => apply(root, "../escaped.test.ts")).toThrow(/outside the audited repo/);
  });
});
