import { describe, expect, it } from "vitest";

import { api } from "./client";

describe("POST /auth/login", () => {
  it("returns a session token for valid credentials", async () => {
    const res = await api.post("/auth/login", {
      email: "ada@example.com",
      password: "correct horse battery staple",
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^tk_/);
  });

  it("rejects invalid credentials", async () => {
    const res = await api.post("/auth/login", {
      email: "ada@example.com",
      password: "not-the-password",
    });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });
});
