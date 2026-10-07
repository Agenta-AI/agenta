/**
 * With `inprocess` off (not in AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS), the runner never loads the
 * in-process code or reads its settings: importing the server, building its pools and a run that
 * asks for `inprocess` all leave that module unloaded. Importing the server is slow on a loaded
 * machine, hence the longer timeouts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRunnerConfigCache } from "../../../src/config/runner-config.ts";

const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../src/engines/inprocess/index.ts", async (importOriginal) => {
  loads.count += 1;
  return importOriginal();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  resetRunnerConfigCache();
  loads.count = 0;
});

describe("the in-process provider behind the flag", () => {
  it("is never loaded, nor its settings read, on a runner without it", async () => {
    vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local");
    vi.stubEnv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", "local");
    // A malformed in-process setting must not matter while the provider is off.
    vi.stubEnv("AGENTA_RUNNER_INPROCESS_MAX_SESSIONS", "not-a-number");
    resetRunnerConfigCache();
    const server = await import("../../../src/server.ts");
    expect(loads.count).toBe(0);
    await expect(server.inProcessDeps()).rejects.toThrow(/not enabled/);
    expect(loads.count).toBe(0);
  }, 30_000);

  it("is loaded on the first in-process run once enabled", async () => {
    vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,inprocess");
    vi.stubEnv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", "local");
    vi.stubEnv("AGENTA_RUNNER_DAYTONA_API_KEY", "test-key");
    resetRunnerConfigCache();
    const server = await import("../../../src/server.ts");
    expect(loads.count).toBe(0);
    const deps = await server.inProcessDeps();
    expect(deps.inRunnerHarness).toBeDefined();
    expect(loads.count).toBe(1);
  }, 30_000);
});
