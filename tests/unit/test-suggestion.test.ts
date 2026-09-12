import { describe, expect, it } from "vitest";

import {
  parseTestFile,
  suggestedTestFileName,
  type TestFrameworkId,
} from "@/lib/api-test-coverage";
import { buildSuggestedTest } from "@/lib/test-suggestion";

/**
 * The suggested test has one hard requirement above all the cosmetic ones: the
 * analyzer has to be able to read it back. A suggestion SpecProof cannot parse
 * would leave the row stamped NO TEST after the test was applied, which is the
 * one outcome the feature cannot have. The round-trip below is that guard.
 */

const FRAMEWORKS: TestFrameworkId[] = ["vitest", "jest", "bun"];

function suggest(overrides: Partial<Parameters<typeof buildSuggestedTest>[0]> = {}) {
  return buildSuggestedTest({
    method: "get",
    specPath: "/widgets",
    status: "500",
    hasRequestBody: false,
    framework: "vitest",
    mode: "create",
    ...overrides,
  });
}

describe("buildSuggestedTest", () => {
  it.each(FRAMEWORKS)("writes a %s file the analyzer reads back as coverage", (framework) => {
    const suggestion = suggest({ framework, method: "post", specPath: "/widgets", status: "400", hasRequestBody: true });
    const evidence = parseTestFile(suggestion.contents, "tests/widgets-post.test.ts");

    const operation = evidence.get("post /widgets");
    expect(operation, `${framework} suggestion produced no evidence`).toBeDefined();
    expect(operation!.statuses.get("400")).toBe(1);
    expect(operation!.testCount).toBe(1);
    expect(operation!.snippets.get("400")?.[0].title).toBe(suggestion.title);
  });

  it.each(["200", "400", "401", "403", "404", "409", "422", "429", "500", "503"])(
    "reads back the %s it asserts, whatever the status means",
    (status) => {
      const suggestion = suggest({
        status,
        specPath: "/widgets/{widgetId}",
        method: "patch",
        hasRequestBody: true,
      });
      const evidence = parseTestFile(suggestion.contents, "t.test.ts");
      expect(evidence.get("patch /widgets/{}")?.statuses.get(status)).toBe(1);
    },
  );

  it("gives 404 a path that resolves to nothing, and other statuses one that exists", () => {
    const missing = suggest({ status: "404", specPath: "/widgets/{widgetId}" });
    expect(missing.block).toContain("/widgets/does-not-exist");
    expect(missing.title).toBe("returns 404 when the widgetId does not exist");
    expect(missing.block).not.toContain("REPLACE_ME");

    const present = suggest({ status: "200", specPath: "/widgets/{widgetId}" });
    expect(present.block).toContain('const widgetId = "REPLACE_ME";');
    expect(present.block).toContain("${widgetId}");
  });

  it("sends a body only when the operation declares one", () => {
    expect(suggest({ method: "post", status: "201", hasRequestBody: true }).block).toContain(
      "body: JSON.stringify({})",
    );
    expect(suggest({ method: "post", status: "201", hasRequestBody: false }).block).not.toContain(
      "JSON.stringify",
    );
    // A body on a GET would be sent by no client the API has, declared or not.
    expect(suggest({ method: "get", status: "200", hasRequestBody: true }).block).not.toContain(
      "JSON.stringify",
    );
  });

  it("imports the framework that needs importing, and leaves jest's globals alone", () => {
    expect(suggest({ framework: "vitest" }).importLine).toBe(
      'import { describe, expect, it } from "vitest";',
    );
    expect(suggest({ framework: "bun" }).importLine).toBe(
      'import { describe, expect, it } from "bun:test";',
    );
    expect(suggest({ framework: "jest" }).importLine).toBe("");
    expect(suggest({ framework: "jest" }).contents.startsWith("const BASE_URL")).toBe(true);
  });

  it("previews the file it would create, or just the block it would append", () => {
    expect(suggest({ mode: "create" }).preview).toContain("describe(");
    expect(suggest({ mode: "append" }).preview).toBe(suggest({ mode: "append" }).block);
  });

  it("normalizes paths in colon and bracket styles too", () => {
    const suggestion = suggest({ specPath: "/widgets/:widget_id", status: "200" });
    expect(suggestion.block).toContain('const widgetId = "REPLACE_ME";');
  });
});

describe("suggestedTestFileName", () => {
  it("names the file after the operation", () => {
    expect(suggestedTestFileName("GET", "/tasks", ".test.ts")).toBe("tasks-get.test.ts");
    expect(suggestedTestFileName("delete", "/tasks/{taskId}", ".test.js")).toBe(
      "tasks-task-id-delete.test.js",
    );
    expect(suggestedTestFileName("POST", "/auth/login", ".test.ts")).toBe(
      "auth-login-post.test.ts",
    );
    expect(suggestedTestFileName("GET", "/", ".test.ts")).toBe("root-get.test.ts");
  });
});
