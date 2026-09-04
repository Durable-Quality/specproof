import { beforeAll, describe, expect, it } from "vitest";

import { api, authenticate } from "./client";

beforeAll(async () => {
  const login = await api.post("/auth/login", {
    email: "ada@example.com",
    password: "correct horse battery staple",
  });
  authenticate(login.body.token ?? null);
});

describe("GET /tasks/{taskId}", () => {
  it("returns a task by id", async () => {
    const created = await api.post("/tasks", { title: "Write release notes" });
    const res = await api.get(`/tasks/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("includes the task title in the response", async () => {
    const created = await api.post("/tasks", { title: "Draft the roadmap" });
    const res = await api.get(`/tasks/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Draft the roadmap");
  });

  it("returns 404 for an unknown task id", async () => {
    const res = await api.get("/tasks/task_does_not_exist");

    expect(res.status).toBe(404);
  });
});
