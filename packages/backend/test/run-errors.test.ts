import { describe, expect, test } from "bun:test";
import { TaskNotFoundError } from "../src/run-service";

describe("run service errors", () => {
  test("exposes missing tasks as a typed error without changing the message", () => {
    const error = new TaskNotFoundError("task-123");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TaskNotFoundError");
    expect(error.taskId).toBe("task-123");
    expect(error.message).toBe("Task not found: task-123");
  });
});
