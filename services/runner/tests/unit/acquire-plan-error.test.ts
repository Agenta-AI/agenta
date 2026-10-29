/**
 * An error thrown while the run is planned (before any sandbox exists) reaches the client through
 * the public error contract like any other acquire failure: redacted, and for `inprocess` one
 * sentence with a reference instead of host paths and operator commands (QAP-3).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { acquireEnvironment } from "../../src/engines/sandbox_agent/environment.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

const HOST_ERROR = "cannot create the durable session cwd '/home/sandbox/agenta/mounts/p/s': EACCES. Run: sudo mkdir -p /var/lib/agenta/mounts";

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,inprocess";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});
afterEach(() => {
  delete process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS;
  delete process.env.AGENTA_RUNNER_DAYTONA_API_KEY;
  resetRunnerConfigCache();
});

describe("a planning error", () => {
  it("is withheld behind a reference for inprocess", async () => {
    const request = { harness: "pi_core", sandbox: "inprocess", messages: [{ role: "user", content: "hi" }] } as AgentRunRequest;
    const acquired = await acquireEnvironment(request, { createLocalCwd: () => { throw new Error(HOST_ERROR); } }, undefined, null);
    expect(acquired.ok).toBe(false);
    if (acquired.ok) return;
    expect(acquired.error).toMatch(/^The agent run failed \(reference [0-9a-f]{8}\)/);
    expect(acquired.error).not.toMatch(/sudo|home\/sandbox/);
  });

  it("is returned, not thrown, for local, as its redacted first line", async () => {
    const request = { harness: "pi_core", sandbox: "local", messages: [{ role: "user", content: "hi" }] } as AgentRunRequest;
    const acquired = await acquireEnvironment(request, { createLocalCwd: () => { throw new Error(`${HOST_ERROR} token=abc123`); } }, undefined, null);
    expect(acquired.ok).toBe(false);
    if (acquired.ok) return;
    expect(acquired.error).toContain("cannot create the durable session cwd");
    expect(acquired.error).not.toContain("abc123");
  });
});
