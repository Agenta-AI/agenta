/**
 * M11, guarded at the seam that actually broke: the PRODUCT wiring.
 *
 * `RelayActivitySource.wait` has always declared a `signal`, and for a long time no caller
 * supplied one — an aborted turn left a wait parked on the 30 s safety poll until `stop()`
 * closed it. `relay-loop.test.ts` proves `startToolRelay` forwards a signal it is handed, but it
 * calls `startToolRelay` directly with a signal of its own, so deleting the argument at the one
 * real call site (`run-turn.ts`) leaves that suite green.
 *
 * So this drives the real engine with a real turn signal, takes the arguments the engine handed
 * `startToolRelay`, and starts the REAL relay with them against a wake source that records what
 * `wait` received. Both hops are asserted by identity, which is what makes deleting either one
 * fail here.
 *
 * Run: pnpm exec vitest run tests/unit/relay-turn-signal.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import { startToolRelay } from "../../src/tools/relay.ts";
import type { RelayHost } from "../../src/tools/relay.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import {
  GATEWAY_POLICY,
  RUN_TOOL_SPEC,
  SEARCH_TOOL_SPEC,
  TOOL_CALLBACK,
  cleanupRelayDirs,
  makeRelayDir,
  stubToolCall,
  until,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local";
  resetRunnerConfigCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

function relayRequest(): AgentRunRequest {
  return {
    messages: [{ role: "user", content: "close issue 12" }],
    customTools: [RUN_TOOL_SPEC, SEARCH_TOOL_SPEC],
    toolCallback: TOOL_CALLBACK,
    gatewayPolicy: GATEWAY_POLICY,
    permissions: { default: "allow_reads" },
    harness: "pi_core",
  } as unknown as AgentRunRequest;
}

/** A relay host whose wake source records every signal `wait` is given. */
function recordingHost(seen: Array<AbortSignal | undefined>): RelayHost {
  return {
    list: async () => [],
    read: async () => "",
    write: async () => {},
    rename: async () => {},
    remove: async () => {},
    statMtimeMs: async () => undefined,
    createActivitySource: () => ({
      wait: async ({ signal }: { timeoutMs: number; signal?: AbortSignal }) => {
        seen.push(signal);
        // Yield for a beat, so the assertion below runs against a loop that is waiting rather
        // than one spinning on an instantly-resolved wait.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "timeout" as const;
      },
      close: () => {},
      isHealthy: () => true,
      suspendsPolling: false,
    }),
  } as unknown as RelayHost;
}

describe("the turn's abort signal reaches the relay's wake source (M11)", () => {
  it("run-turn hands it to startToolRelay, which hands it to every wait", async () => {
    stubToolCall({ ok: true });
    const harness = fakeHarness();
    delete (harness.deps as { responderFactory?: unknown }).responderFactory;

    const controller = new AbortController();
    const result = await runSandboxAgent(
      relayRequest(),
      undefined,
      controller.signal,
      harness.deps,
    );
    assert.equal(
      result.ok,
      true,
      `the run itself must succeed: ${JSON.stringify(result)}`,
    );

    // Hop 1: run-turn -> startToolRelay. Identity, not "some signal": a different signal would
    // abort on something other than this turn.
    const args = harness.calls.toolRelayArgs;
    assert.ok(args, "the engine started a tool relay");
    const opts = (args[7] ?? {}) as { signal?: AbortSignal };
    assert.equal(
      opts.signal,
      controller.signal,
      "run-turn must pass the turn's own abort signal into the relay options",
    );

    // Hop 2: startToolRelay -> activitySource.wait, driving the real relay with what the engine
    // produced rather than options the test invented.
    const seen: Array<AbortSignal | undefined> = [];
    const relay = startToolRelay(
      recordingHost(seen),
      makeRelayDir(),
      args[2] as never,
      args[3] as never,
      args[4] as never,
      args[5] as never,
      args[6] as never,
      opts as never,
    );
    await relay.ready;
    try {
      await until(() => seen.length > 0, "the relay loop waited at least once");
      assert.ok(
        seen.every((signal) => signal === controller.signal),
        "every wait must carry the turn's signal",
      );
    } finally {
      await relay.stop();
    }
  });
});
