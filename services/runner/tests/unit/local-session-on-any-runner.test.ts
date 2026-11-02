/**
 * A local-provider session is not refused on a runner that did not start it.
 *
 * Acquire asks no runner-ownership question for a local session: the API binds each TURN to one
 * runner, and the chart keeps the local provider at one runner. So acquire goes straight to the
 * environment setup, and a replacement runner after a restart serves the session at once,
 * rebuilding it cold.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/local-session-on-any-runner.test.ts
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";

const heartbeatCalls: string[] = [];

vi.stubGlobal("fetch", async (url: string) => {
  if (String(url).includes("/sessions/streams/heartbeat")) heartbeatCalls.push(url);
  // Any coordination-plane answer here names another runner, so a probe would refuse the run.
  return new Response(JSON.stringify({ replica_id: "another-runner" }), {
    status: 200,
  });
});

const { acquireEnvironment } = await import("../../src/engines/sandbox_agent.ts");

const SENTINEL = "local-session-on-any-runner-stop-here";

beforeEach(() => {
  heartbeatCalls.length = 0;
});

describe("acquireEnvironment for a session on the local provider", () => {
  it("asks no runner-ownership question and reaches the sandbox start", async () => {
    const request: AgentRunRequest = {
      harness: "claude",
      messages: [{ role: "user", content: "hello" }],
      sessionId: "sess-on-a-second-runner",
      sandbox: "local",
    };
    let sandboxStarted = false;

    const result = await acquireEnvironment(request, {
      signSessionMountCredentials: async () => null,
      startSandboxAgent: (async () => {
        sandboxStarted = true;
        throw new Error(SENTINEL);
      }) as typeof import("sandbox-agent").SandboxAgent.start,
    });

    assert.equal(heartbeatCalls.length, 0, "acquire asked the coordination plane about the session's owner");
    assert.equal(sandboxStarted, true, "acquire stopped before the sandbox start");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.doesNotMatch(result.error, /single runner|is not the owner of session/);
  });
});
