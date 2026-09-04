import { beforeAll, describe, expect, it } from "vitest";

import { api, authenticate } from "./client";

beforeAll(async () => {
  const login = await api.post("/auth/login", {
    email: "ada@example.com",
    password: "correct horse battery staple",
  });
  authenticate(login.body.token ?? null);
});

describe("GET /tasks", () => {
  it("lists tasks for the authenticated user", async () => {
    const res = await api.get("/tasks");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it("rejects requests without a bearer token", async () => {
    const res = await api.get("/tasks", { auth: false });

    expect(res.status).toBe(401);
  });
});
