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

describe("GET /tasks/{taskId}", () => {
  it("returns a task by id", async () => {
    const created = await api.post("/tasks", { title: "Write release notes" });
    const res = await api.get(`/tasks/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("returns 404 for an unknown task id", async () => {
    const res = await api.get("/tasks/task_does_not_exist");

    expect(res.status).toBe(404);
  });
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
});
