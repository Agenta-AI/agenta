/**
 * The gate as PRODUCTION composes it, on all three delivery placements.
 *
 * Every other gateway test hands the relay a gate and a policy the test itself built. That
 * proves the gate works; it does not prove `runTurn` wires one. So these tests run the real
 * `runSandboxAgent` against a fake sandbox, capture the arguments the engine hands
 * `startToolRelay`, and then drive the REAL relay loop with those captured arguments. The
 * policy, the gate, the responder, the permission plan and the execution guard all come from
 * the engine. The test supplies only transport: a real directory and a real local relay host,
 * because the harness stubs those as strings.
 *
 * Three placements, because they are three different code paths in `runTurn`:
 *   - Pi, which loads tools through its bundled extension;
 *   - Claude on a local sandbox, which also builds an in-process loopback MCP gate above the
 *     relay (`!isPi && !isDaytona`);
 *   - Claude on Daytona, where the in-sandbox shim writes relay files directly.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-run-turn-composition.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import {
  GATEWAY_POLICY,
  RUN_TOOL_SPEC,
  SEARCH_TOOL_SPEC,
  TOOL_CALLBACK,
  cleanupRelayDirs,
  forgeRelayRequest,
  readRelayResponse,
  startRelayFromProductionWiring,
  stubToolCall,
  until,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

function gatewayRequest(overrides: Partial<AgentRunRequest>): AgentRunRequest {
  return {
    messages: [{ role: "user", content: "close issue 12" }],
    customTools: [RUN_TOOL_SPEC, SEARCH_TOOL_SPEC],
    toolCallback: TOOL_CALLBACK,
    gatewayPolicy: GATEWAY_POLICY,
    permissions: { default: "allow_reads" },
    ...overrides,
  } as AgentRunRequest;
}

const PLACEMENTS: Array<{ name: string; request: Partial<AgentRunRequest> }> = [
  { name: "Pi (bundled extension)", request: { harness: "pi_core" } },
  {
    name: "Claude on a local sandbox (loopback MCP above the relay)",
    request: { harness: "claude", sandbox: "local" },
  },
  {
    name: "Claude on Daytona (in-sandbox shim)",
    request: { harness: "claude", sandbox: "daytona" },
  },
];

for (const placement of PLACEMENTS) {
  describe(`the engine gates gateway calls on ${placement.name}`, () => {
    it("refuses a denied tool without reaching the provider", async () => {
      const relay = await startRelayFromProductionWiring(
        gatewayRequest(placement.request),
      );
      const calls = stubToolCall({ deleted: true });
      assert.deepEqual(
        relay.relayOpts.gatewayPolicy,
        GATEWAY_POLICY,
        "runTurn must pass the run's resolved policy to the relay",
      );
      try {
        await forgeRelayRequest(relay.dir, "deny-1", {
          integration: "github",
          tool: "DELETE_REPOSITORY",
          arguments: { repo: "agenta" },
        });
        const response = await readRelayResponse(relay.dir, "deny-1");

        assert.equal(response.ok, false);
        assert.equal(calls.bodies.length, 0);
      } finally {
        await relay.stop();
      }
    });

    it("refuses an integration the agent never configured", async () => {
      const relay = await startRelayFromProductionWiring(
        gatewayRequest(placement.request),
      );
      const calls = stubToolCall({ charged: true });
      try {
        await forgeRelayRequest(relay.dir, "unconfigured-1", {
          integration: "stripe",
          tool: "CREATE_CHARGE",
          arguments: { amount: 100 },
        });
        const response = await readRelayResponse(relay.dir, "unconfigured-1");

        assert.equal(response.ok, false);
        assert.ok(!String(response.error).includes("stripe"));
        assert.equal(calls.bodies.length, 0);
      } finally {
        await relay.stop();
      }
    });

    it("runs an allowed tool, with the connection read from the policy", async () => {
      const relay = await startRelayFromProductionWiring(
        gatewayRequest(placement.request),
      );
      const calls = stubToolCall({ issue: { number: 12 } });
      try {
        await forgeRelayRequest(relay.dir, "allow-1", {
          integration: "github",
          tool: "GET_ISSUE",
          arguments: { issue: 12 },
        });
        const response = await readRelayResponse(relay.dir, "allow-1");

        assert.equal(response.ok, true);
        assert.equal(calls.bodies.length, 1);
        assert.deepEqual(calls.bodies[0].context, {
          provider: "composio",
          integration: "github",
          connection: "github-work",
          tool: "GET_ISSUE",
          toolkit_version: "20250827_00",
        });
      } finally {
        await relay.stop();
      }
    });

    it("parks an ask on a real approval card instead of running or refusing", async () => {
      const relay = await startRelayFromProductionWiring(
        gatewayRequest(placement.request),
      );
      const calls = stubToolCall({ created: true });
      const cards = (): unknown[] =>
        relay.events.filter(
          (event) =>
            event.type === "interaction_request" &&
            event.kind === "user_approval",
        );
      try {
        await forgeRelayRequest(relay.dir, "ask-1", {
          integration: "github",
          tool: "CREATE_ISSUE",
          arguments: { title: "bug" },
        });
        // The card, not the response file: Pi parks through its own extension and the relay
        // writes no answer for it ("pi-native"), so waiting on a response would hang for the
        // one placement whose correct behavior is to write nothing.
        await until(() => cards().length > 0, "the approval card");

        assert.equal(cards().length, 1, "the engine raised one approval card");
        assert.equal(calls.bodies.length, 0, "a parked call never executes");
      } finally {
        await relay.stop();
      }
    });
  });
}

describe("a run with no gateway connection is unchanged", () => {
  it("wires no policy and no gate", async () => {
    const harness = fakeHarness();
    const result = await runSandboxAgent(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
        toolCallback: TOOL_CALLBACK,
      } as AgentRunRequest,
      undefined,
      undefined,
      harness.deps,
    );

    assert.equal(result.ok, true);
    const relayOpts = (harness.calls.toolRelayArgs?.[7] ?? {}) as Record<
      string,
      any
    >;
    assert.equal(relayOpts.gatewayPolicy, undefined);
  });
});
