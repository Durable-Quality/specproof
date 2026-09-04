import { beforeAll, describe, expect, it } from "vitest";

import { api, authenticate } from "./client";

beforeAll(async () => {
  const login = await api.post("/auth/login", {
    email: "ada@example.com",
    password: "correct horse battery staple",
  });
  authenticate(login.body.token ?? null);
});

describe("POST /tasks", () => {
  it("creates a task and returns it", async () => {
    const res = await api.post("/tasks", {
      title: "Ship the Q3 roadmap",
      projectId: "proj_1",
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe("Ship the Q3 roadmap");
  });

  it("rejects a task without a title", async () => {
    const res = await api.post("/tasks", { projectId: "proj_1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("title is required");
  });

  it("rejects a due date in the past", async () => {
    const res = await api.post("/tasks", {
      title: "Time travel",
      dueDate: "1999-12-31",
    });

    expect(res.status).toBe(422);
  });
});
