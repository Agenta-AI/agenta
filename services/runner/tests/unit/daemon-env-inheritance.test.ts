import { describe, expect, it } from "vitest";

import { buildDaemonEnv, closeInheritedEnv } from "../../src/engines/sandbox_agent/daemon.ts";

describe("closeInheritedEnv", () => {
  const runnerEnv: Record<string, string> = {
    PATH: "/usr/bin",
    HOME: "/home/runner",
    LANG: "en_US.UTF-8",
    AGENTA_API_KEY: "ak-secret",
    AGENTA_RUNNER_TOKEN: "rt-secret",
    ANTHROPIC_API_KEY: "sk-ant",
  };

  it("leaves no platform credential in what local() spawns", () => {
    const env = closeInheritedEnv({ PATH: "/adapters:/usr/bin", HOME: "/home/runner" }, runnerEnv);
    const spawned = { ...runnerEnv, ...env };

    expect(spawned.AGENTA_API_KEY).toBe("");
    expect(spawned.AGENTA_RUNNER_TOKEN).toBe("");
    expect(spawned.ANTHROPIC_API_KEY).toBe("");
  });

  it("keeps every key the run set", () => {
    const env = closeInheritedEnv(
      { PATH: "/adapters:/usr/bin", LANG: "en_US.UTF-8", OPENAI_API_KEY: "sk-run" },
      runnerEnv,
    );
    const spawned = { ...runnerEnv, ...env };

    expect(spawned.PATH).toBe("/adapters:/usr/bin");
    expect(spawned.LANG).toBe("en_US.UTF-8");
    expect(spawned.OPENAI_API_KEY).toBe("sk-run");
  });

  it("does not hand the runner's NODE_OPTIONS to a harness", () => {
    // It loads code (`--require`, `--inspect`), so it is not a neutral setting.
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require ./otel.js";
    try {
      expect(buildDaemonEnv("claude", { clearProviderEnv: true }).NODE_OPTIONS).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });

  it("copies the neutral OS settings a harness needs", () => {
    const previous = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      expect(buildDaemonEnv("claude", { clearProviderEnv: true }).TZ).toBe("UTC");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
