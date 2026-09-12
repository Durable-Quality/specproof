import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The apply route, end to end against a throwaway target repo: a gap named by
 * the panel becomes a test on disk that the analyzer then reads back as
 * coverage. That last step is the whole point — a row that stays stamped
 * NO TEST after applying would mean the feature wrote something no one reads.
 *
 * The route and the analyzer both read SPECPROOF_REPO at module load, so every
 * case re-imports them under vi.resetModules() after pointing the env var at
 * its own fixture.
 */

const SPEC = {
  openapi: "3.0.0",
  paths: {
    // Covered: one asserted status, one gap the suggestion appends to the file.
    "/widgets": {
      get: { summary: "List widgets", responses: { "200": { description: "OK" } } },
    },
    // Untested: every row a gap, and no test file to append to.
    "/gadgets/{gadgetId}": {
      delete: { summary: "Delete a gadget", responses: { "204": { description: "Gone" } } },
    },
  },
};

let repoRoot: string;
let appRoot: string;

function write(relative: string, contents: string) {
  const file = path.join(repoRoot, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

async function route() {
  vi.resetModules();
  return import("@/app/api/suggested-test/route");
}

async function report() {
  vi.resetModules();
  const { buildCoverageReport } = await import("@/lib/api-test-coverage");
  return buildCoverageReport(repoRoot);
}

function post(body: unknown) {
  return new Request("http://localhost/api/suggested-test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** The status row as the current audit sees it. */
async function row(method: string, specPath: string, code: string) {
  const operation = (await report()).tags
    .flatMap((tag) => tag.operations)
    .find((op) => op.method === method && op.specPath === specPath);
  return operation?.statuses.find((status) => status.code === code);
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specproof-route-"));
  // Stands in for the SpecProof package directory, so the route refreshes a
  // throwaway artifact rather than this repo's committed one.
  appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specproof-app-"));
  fs.mkdirSync(path.join(appRoot, "app"));
  process.env.SPECPROOF_APP_ROOT = appRoot;
  process.env.SPECPROOF_REPO = repoRoot;
  delete process.env.SPECPROOF_SPEC;
  write("openapi.json", JSON.stringify(SPEC, null, 2));
  write("package.json", JSON.stringify({ name: "target", devDependencies: { vitest: "^4" } }));
  write(
    "tests/widgets.test.ts",
    [
      'import { describe, expect, it } from "vitest";',
      "",
      'describe("GET /widgets", () => {',
      '  it("returns the widgets", async () => {',
      "    const res = await fetch(`${BASE_URL}/widgets`);",
      "",
      "    expect(res.status).toBe(200);",
      "  });",
      "});",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  delete process.env.SPECPROOF_REPO;
  delete process.env.SPECPROOF_APP_ROOT;
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(appRoot, { recursive: true, force: true });
});

describe("the apply route", () => {
  it("reports the audited repo as writable", async () => {
    const { GET } = await route();
    await expect((await GET()).json()).resolves.toEqual({
      writable: true,
      repo: repoRoot,
      reason: null,
    });
  });

  it("says why it cannot apply when the repo has no spec", async () => {
    fs.rmSync(path.join(repoRoot, "openapi.json"));
    const { GET, POST } = await route();
    const capability = await (await GET()).json();
    expect(capability.writable).toBe(false);
    expect(capability.reason).toContain("no OpenAPI spec");

    const refused = await POST(post({ method: "get", specPath: "/widgets", status: "500" }));
    expect(refused.status).toBe(409);
  });

  it("appends to the file that already describes the operation, and closes the gap", async () => {
    expect(await row("get", "/widgets", "500")).toMatchObject({ assertions: 0, expected: true });

    const { POST } = await route();
    const response = await POST(post({ method: "get", specPath: "/widgets", status: "500" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      file: "tests/widgets.test.ts",
      created: false,
    });

    // Re-audited: the row the panel was opened on is now proven, by a snippet
    // that cites the file the route wrote.
    const covered = await row("get", "/widgets", "500");
    expect(covered?.assertions).toBe(1);
    expect(covered?.snippets).toHaveLength(1);
    expect(covered?.snippets[0].title).toBe("returns 500 when the handler fails");
  });

  it("creates a file for an operation with no tests at all", async () => {
    const before = await row("delete", "/gadgets/{gadgetId}", "404");
    expect(before?.assertions).toBe(0);

    const { POST } = await route();
    const response = await POST(
      post({ method: "delete", specPath: "/gadgets/{gadgetId}", status: "404" }),
    );
    const result = await response.json();
    expect(result).toMatchObject({ file: "tests/gadgets-gadget-id-delete.test.ts", created: true });
    expect(fs.existsSync(path.join(repoRoot, result.file))).toBe(true);

    const covered = await row("delete", "/gadgets/{gadgetId}", "404");
    expect(covered?.assertions).toBe(1);
    expect(covered?.snippets[0].title).toBe("returns 404 when the gadgetId does not exist");
  });

  it("covers every gap an operation has, one apply at a time", async () => {
    const { POST } = await route();
    for (const status of ["204", "404", "500"]) {
      const response = await POST(
        post({ method: "delete", specPath: "/gadgets/{gadgetId}", status }),
      );
      expect(response.status, `applying ${status}`).toBe(200);
    }

    const operation = (await report()).tags
      .flatMap((tag) => tag.operations)
      .find((op) => op.specPath === "/gadgets/{gadgetId}");
    expect(operation?.gapCount).toBe(0);
    expect(operation?.coveredCount).toBe(3);
  });

  it("documents the response in the spec when the spec is the other half of the gap", async () => {
    // The synthesized 500: no test asserts it and the spec never lists it.
    expect(await row("get", "/widgets", "500")).toMatchObject({
      documented: false,
      expected: true,
    });

    const { POST } = await route();
    const result = await (
      await POST(post({ method: "get", specPath: "/widgets", status: "500" }))
    ).json();
    expect(result).toMatchObject({
      specFile: "openapi.json",
      specDescription: "Unexpected server error",
      refreshError: null,
    });

    // Both holes closed at once: the row now reads VERIFIED against a
    // description the spec carries, with no MISSING FROM SPEC stamp left.
    expect(await row("get", "/widgets", "500")).toMatchObject({
      documented: true,
      description: "Unexpected server error",
      assertions: 1,
    });
  });

  it("leaves the spec alone for a gap it already documents", async () => {
    const before = fs.readFileSync(path.join(repoRoot, "openapi.json"), "utf8");
    const { POST } = await route();
    const result = await (
      await POST(post({ method: "delete", specPath: "/gadgets/{gadgetId}", status: "204" }))
    ).json();

    expect(result.specFile).toBeNull();
    expect(fs.readFileSync(path.join(repoRoot, "openapi.json"), "utf8")).toBe(before);
  });

  it("refreshes the audit view's artifact so the applied row reads as covered", async () => {
    const proof = path.join(appRoot, "app/proof.generated.json");
    expect(fs.existsSync(proof)).toBe(false);

    const { POST } = await route();
    await POST(post({ method: "get", specPath: "/widgets", status: "500" }));

    const refreshed = JSON.parse(fs.readFileSync(proof, "utf8"));
    const status = refreshed.tags
      .flatMap((tag: { operations: Array<Record<string, never>> }) => tag.operations)
      .find((op: Record<string, string>) => op.specPath === "/widgets")
      .statuses.find((s: Record<string, string>) => s.code === "500");
    expect(status.assertions).toBe(1);
  });

  it("refuses a status a test already asserts", async () => {
    const { POST } = await route();
    const response = await POST(post({ method: "get", specPath: "/widgets", status: "200" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("already asserted"),
    });
  });

  it("refuses rows the spec does not have", async () => {
    const { POST } = await route();
    expect((await POST(post({ method: "get", specPath: "/nope", status: "200" }))).status).toBe(404);
    expect((await POST(post({ method: "get", specPath: "/widgets", status: "418" }))).status).toBe(
      404,
    );
  });

  it("refuses a body that does not name an operation", async () => {
    const { POST } = await route();
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ method: "get" }))).status).toBe(400);
  });
});
