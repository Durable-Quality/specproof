import { beforeAll, describe, expect, it } from "vitest";

import { api, authenticate } from "./client";

beforeAll(async () => {
  const login = await api.post("/auth/login", {
    email: "ada@example.com",
    password: "correct horse battery staple",
  });
  authenticate(login.body.token ?? null);
});

describe("DELETE /tasks/{taskId}", () => {
  it("returns 500 when the task store refuses the delete", async () => {
    // task_wedged is seeded to fail on delete, so the route's error path is
    // exercised end to end rather than mocked out.
    const res = await api.delete("/tasks/task_wedged");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("could not delete task");
  });
});
