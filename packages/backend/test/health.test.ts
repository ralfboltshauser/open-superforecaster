import { describe, expect, test } from "bun:test";
import { loadAgentPolicy, loadAppConfig } from "@open-superforecaster/config";
import { resolveProviderAuthPath } from "../src/health";

describe("health agent auth paths", () => {
  test("uses the resolved CODEX_HOME rather than the generic profile root", () => {
    const config = loadAppConfig({
      ...process.env,
      HOME: "/home/example",
      CODEX_HOME: "/home/example/.codex",
      OPEN_SUPERFORECASTER_ROOT: process.cwd(),
    });
    const policy = loadAgentPolicy({
      ...process.env,
      AGENT_DEFAULT: "codex:default",
      AGENT_AUTH_ROOT: "./data/agent-auth",
    }, process.cwd());

    expect(resolveProviderAuthPath(config, policy, { provider: "codex", profile: "default" }))
      .toBe("/home/example/.codex");
  });
});
