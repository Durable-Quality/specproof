import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { detectTestFramework, findTestFiles } from "@/lib/api-test-coverage";

/**
 * Framework detection: which of the three assertion-compatible frameworks a
 * suggested test should be written for, and where in the repo it should land.
 * Every fixture is a throwaway temp repo, so nothing here depends on the
 * checkout this suite runs from.
 */

const made: string[] = [];

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specproof-framework-"));
  made.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

function detect(root: string) {
  return detectTestFramework(root, findTestFiles(root));
}

afterEach(() => {
  for (const root of made.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("detectTestFramework", () => {
  it("believes what the test files import over what package.json declares", () => {
    const root = repo({
      "package.json": JSON.stringify({ devDependencies: { jest: "^29.0.0" } }),
      "tests/widgets.test.ts": 'import { describe, it } from "vitest";\n',
    });
    const framework = detect(root);
    expect(framework.id).toBe("vitest");
    expect(framework.detected).toBe(true);
    expect(framework.evidence).toBe("imported by tests/widgets.test.ts");
  });

  it("reads bun:test imports", () => {
    const root = repo({ "test/a.test.ts": 'import { expect } from "bun:test";\n' });
    expect(detect(root).id).toBe("bun");
  });

  it("falls back to a config file at the repo root", () => {
    const root = repo({
      "vitest.config.ts": "export default {};\n",
      "package.json": "{}",
    });
    expect(detect(root)).toMatchObject({ id: "vitest", detected: true, evidence: "vitest.config.ts" });
  });

  it("falls back to a declared dependency, then to the test script", () => {
    const byDep = repo({
      "package.json": JSON.stringify({ devDependencies: { jest: "^29.0.0" } }),
    });
    expect(detect(byDep)).toMatchObject({
      id: "jest",
      detected: true,
      evidence: "package.json dependency jest",
    });

    const byScript = repo({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) });
    expect(detect(byScript)).toMatchObject({
      id: "vitest",
      evidence: "package.json test script",
    });
  });

  it("recommends jest, naming the cause, when nothing usable is configured", () => {
    const empty = repo({ "package.json": "{}" });
    expect(detect(empty)).toMatchObject({
      id: "jest",
      detected: false,
      evidence: "no test framework found in this repo",
    });
  });

  it("names a framework whose assertions it cannot read rather than claiming it", () => {
    const root = repo({
      "package.json": JSON.stringify({ devDependencies: { mocha: "^10.0.0" } }),
    });
    const framework = detect(root);
    expect(framework.id).toBe("jest");
    expect(framework.detected).toBe(false);
    expect(framework.evidence).toContain("Mocha is configured");
  });

  it("puts new tests where the repo already keeps them", () => {
    const root = repo({
      "package.json": "{}",
      "src/__tests__/a.test.js": "",
      "src/__tests__/b.test.js": "",
      "tests/c.test.js": "",
    });
    expect(detect(root).testDir).toBe("src/__tests__");
  });

  it("falls back to a conventional directory, then to tests/", () => {
    const withTest = repo({ "package.json": "{}", "test/.keep": "" });
    expect(detect(withTest).testDir).toBe("test");
    expect(detect(repo({ "package.json": "{}" })).testDir).toBe("tests");
  });

  it("matches the extension the repo writes, falling back to tsconfig", () => {
    expect(detect(repo({ "tests/a.test.js": "" })).extension).toBe(".test.js");
    expect(detect(repo({ "tests/a.test.ts": "" })).extension).toBe(".test.ts");
    expect(detect(repo({ "tsconfig.json": "{}" })).extension).toBe(".test.ts");
    expect(detect(repo({ "package.json": "{}" })).extension).toBe(".test.js");
  });
});
