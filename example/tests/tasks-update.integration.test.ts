import { beforeAll, describe, expect, it } from "vitest";

import { api, authenticate } from "./client";

beforeAll(async () => {
  const login = await api.post("/auth/login", {
    email: "ada@example.com",
    password: "correct horse battery staple",
  });
  authenticate(login.body.token ?? null);
});

describe("PATCH /tasks/{taskId}", () => {
  it("updates the fields of a task", async () => {
    const created = await api.post("/tasks", { title: "Refine the backlog" });
    const res = await api.patch(`/tasks/${created.body.id}`, {
      title: "Refine and prioritize the backlog",
    });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Refine and prioritize the backlog");
  });

  it("allows updating a single field", async () => {
    const created = await api.post("/tasks", { title: "Plan the offsite" });
    const res = await api.patch(`/tasks/${created.body.id}`, {
      status: "in_progress",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in_progress");
  });
});
