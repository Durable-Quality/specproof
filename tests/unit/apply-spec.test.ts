import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { loadSpec } from "@/lib/api-test-coverage";
import { describeStatus, documentResponse } from "@/lib/apply-spec";

/**
 * Writing a response into the audited repo's spec. The spec is the API's own
 * document, so the bar is higher than for a test file: the edit must add the
 * one key it claims to and leave everything else — comments, quoting, key
 * order — as the author wrote it.
 */

const made: string[] = [];

function specFile(name: string, contents: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specproof-spec-"));
  made.push(root);
  const file = path.join(root, name);
  fs.writeFileSync(file, contents);
  return file;
}

const YAML = `openapi: 3.0.0
paths:
  # the widget list
  /widgets:
    get:
      summary: List widgets
      responses:
        "200":
          description: OK
`;

const JSON_SPEC = {
  openapi: "3.0.0",
  paths: {
    "/widgets": { get: { summary: "List widgets", responses: { "200": { description: "OK" } } } },
  },
};

afterEach(() => {
  for (const root of made.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("documentResponse", () => {
  it("adds the response to a YAML spec without disturbing what is already there", () => {
    const file = specFile("openapi.yaml", YAML);
    expect(documentResponse(file, "get", "/widgets", "500")).toEqual({
      added: true,
      description: "Unexpected server error",
    });

    const written = fs.readFileSync(file, "utf8");
    expect(written).toContain("# the widget list");
    expect(written).toContain('"500":');
    expect(written).toContain("description: Unexpected server error");
    // The status stays a string key, as OpenAPI requires — an unquoted 500
    // would be a number.
    expect(written).not.toMatch(/^\s+500:/m);
    expect(loadSpec(file).paths?.["/widgets"].get.responses).toEqual({
      "200": { description: "OK" },
      "500": { description: "Unexpected server error" },
    });
  });

  it("adds the response to a JSON spec at the indentation it already uses", () => {
    const file = specFile("openapi.json", JSON.stringify(JSON_SPEC, null, 4) + "\n");
    expect(documentResponse(file, "get", "/widgets", "404").added).toBe(true);

    const written = fs.readFileSync(file, "utf8");
    expect(written).toContain('\n    "openapi"');
    expect(written.endsWith("\n")).toBe(true);
    expect(loadSpec(file).paths?.["/widgets"].get.responses?.["404"]).toEqual({
      description: "Not found",
    });
  });

  it("creates the path, method, and responses map when the spec has none", () => {
    const file = specFile("openapi.yaml", "openapi: 3.0.0\n");
    documentResponse(file, "POST", "/gadgets", "400");
    expect(loadSpec(file).paths?.["/gadgets"].post.responses?.["400"]).toEqual({
      description: "Invalid request",
    });
  });

  it("leaves a status the spec already documents alone", () => {
    const file = specFile("openapi.yaml", YAML);
    expect(documentResponse(file, "get", "/widgets", "200")).toEqual({
      added: false,
      description: "OK",
    });
    expect(fs.readFileSync(file, "utf8")).toBe(YAML);
  });

  it("never writes an empty description, which would only trade one stamp for another", () => {
    for (const status of ["200", "404", "500", "599"]) {
      expect(describeStatus(status)).not.toBe("");
    }
    expect(describeStatus("599")).toBe("Response 599");
  });
});
