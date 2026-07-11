import { describe, expect, test } from "bun:test";
import { loadAppConfig } from "@open-superforecaster/config";
import { codexConfigOverrides } from "../src/agents";

describe("Codex agent compatibility", () => {
  test("pins a supported reasoning-effort wire value instead of inheriting user aliases", () => {
    const config = loadAppConfig({
      ...process.env,
      CODEX_REASONING_EFFORT: "xhigh",
    });

    expect(codexConfigOverrides(config)).toEqual({
      model_reasoning_effort: "xhigh",
    });
  });

  test("rejects obsolete reasoning-effort values before launching Smithers", () => {
    expect(() => loadAppConfig({
      ...process.env,
      CODEX_REASONING_EFFORT: "max",
    })).toThrow();
  });
});
