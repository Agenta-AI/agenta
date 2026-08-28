/**
 * The approval identity, round-tripped: emitted card -> persisted part -> next turn -> gate.
 *
 * A key computed inside a test proves the two ends of an equation the test itself wrote. The
 * question that matters is different: does the answer a PERSON gives on the card the runner
 * emitted actually resolve the call the runner gated? Four hops decide that, and only the middle
 * one is not runner code:
 *
 *   1. the real gate emits the approval card (production wiring, via `runSandboxAgent`);
 *   2. the Vercel egress projects it to the tool part the frontend persists
 *      (`projectApprovalAsVercelEgressWould`, mirroring `stream.py` — the one simulated hop);
 *   3. the next turn folds that part back into the message history and the runner reads it
 *      (`extractApprovalDecisions`, for real);
 *   4. the gate consults it (`ApprovalResponder` + the real gate, for real).
 *
 * Hop 2 is Python, so this file mirrors it rather than running it. Its twin runs the real thing:
 * `sdks/python/oss/tests/pytest/unit/agents/adapters/test_vercel_stream_gateway_approval.py`
 * drives `agent_run_to_vercel_parts` with the card this gate emits and pins the name and
 * argument precedence the mirror copies. If that projection changes, that test is what should
 * fail first; this one fails second. Change one and change the other.
 *
 * This is the test that catches a card whose display has quietly replaced its identity. Against
 * the pre-fix gate — which emitted `github.CREATE_ISSUE` plus the inner arguments in the fields
 * the egress reads — hop 2 persists a different name and different arguments than hop 4 asks
 * about, so the approved call never runs and the assertion below fails.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-approval-roundtrip.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest, ChatMessage } from "../../src/protocol.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { approvedCallKey } from "../../src/responder.ts";
import { storedDecisionKeyShape } from "../../src/permission-plan.ts";
import {
  GATEWAY_POLICY,
  RUN_TOOL_SPEC,
  SEARCH_TOOL_SPEC,
  TOOL_CALLBACK,
  approvalCards,
  cleanupRelayDirs,
  forgeRelayRequest,
  projectApprovalAsVercelEgressWould,
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

const THE_CALL = {
  integration: "github",
  tool: "CREATE_ISSUE",
  arguments: { title: "bug", body: "it broke" },
};

function gatewayRequest(messages: ChatMessage[]): AgentRunRequest {
  return {
    harness: "claude",
    sandbox: "local",
    messages,
    customTools: [RUN_TOOL_SPEC, SEARCH_TOOL_SPEC],
    toolCallback: TOOL_CALLBACK,
    gatewayPolicy: GATEWAY_POLICY,
    permissions: { default: "allow_reads" },
  } as AgentRunRequest;
}

describe("an approval answered on the card resolves the call the gate raised", () => {
  it("round-trips through the persisted part and runs on the next turn", async () => {
    // ---- Turn 1: the gate raises a card for a compiled `ask`. ----
    const first = await startRelayFromProductionWiring(
      gatewayRequest([{ role: "user", content: "file the bug" }]),
    );
    const firstCalls = stubToolCall({ created: true });
    let persisted;
    try {
      await forgeRelayRequest(first.dir, "turn1-call", THE_CALL);
      await until(
        () => approvalCards(first.events).length > 0,
        "the approval card",
      );
      assert.equal(firstCalls.bodies.length, 0, "the ask did not execute");

      // ---- Hop 2: what the frontend persists for that card. ----
      persisted = projectApprovalAsVercelEgressWould(
        approvalCards(first.events)[0],
      );
    } finally {
      await first.stop();
    }

    // ---- Turn 2: the human said yes. The answer rides the history as the FE folds it. ----
    const second = await startRelayFromProductionWiring(
      gatewayRequest([
        { role: "user", content: "file the bug" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: persisted.toolCallId,
              toolName: persisted.toolName,
              input: persisted.input,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: persisted.toolCallId,
              output: { approved: true },
            },
          ],
        },
      ]),
    );
    const secondCalls = stubToolCall({ created: true, number: 41 });
    try {
      await forgeRelayRequest(second.dir, "turn2-call", THE_CALL);
      const response = await readRelayResponse(second.dir, "turn2-call");

      assert.equal(
        response.ok,
        true,
        "the approved call must run on the next turn, not re-park",
      );
      assert.equal(
        secondCalls.bodies.length,
        1,
        "the persisted answer must resolve the SAME call the gate raised",
      );
      assert.equal(
        approvalCards(second.events).length,
        0,
        "an answered call must not raise a second card",
      );
      assert.deepEqual(
        secondCalls.bodies[0].data.function.arguments,
        THE_CALL.arguments,
      );
    } finally {
      await second.stop();
    }
  });

  it("an answer for one call does not authorize a different one", async () => {
    const first = await startRelayFromProductionWiring(
      gatewayRequest([{ role: "user", content: "file the bug" }]),
    );
    stubToolCall({ created: true });
    let persisted;
    try {
      await forgeRelayRequest(first.dir, "turn1-call", THE_CALL);
      await until(
        () => approvalCards(first.events).length > 0,
        "the approval card",
      );
      persisted = projectApprovalAsVercelEgressWould(
        approvalCards(first.events)[0],
      );
    } finally {
      await first.stop();
    }

    const second = await startRelayFromProductionWiring(
      gatewayRequest([
        { role: "user", content: "file the bug" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: persisted.toolCallId,
              toolName: persisted.toolName,
              input: persisted.input,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: persisted.toolCallId,
              output: { approved: true },
            },
          ],
        },
      ]),
    );
    const calls = stubToolCall({ sent: true });
    try {
      // Same integration, a DIFFERENT tool, and the approval above is the only stored answer.
      await forgeRelayRequest(second.dir, "other-call", {
        integration: "slack",
        tool: "SEND_MESSAGE",
        arguments: { channel: "#general", text: "hi" },
      });
      const response = await readRelayResponse(second.dir, "other-call");

      assert.notEqual(response.ok, false, "it parks rather than being refused");
      assert.equal(calls.bodies.length, 0, "and it certainly does not run");
      assert.equal(approvalCards(second.events).length, 1);
    } finally {
      await second.stop();
    }
  });
});

describe("the persisted part is the identity the gate keyed on", () => {
  it("carries run_tool and the full outer arguments, not the display", async () => {
    const relay = await startRelayFromProductionWiring(
      gatewayRequest([{ role: "user", content: "file the bug" }]),
    );
    stubToolCall({ created: true });
    try {
      await forgeRelayRequest(relay.dir, "card-1", THE_CALL);
      await until(
        () => approvalCards(relay.events).length > 0,
        "the approval card",
      );
      const persisted = projectApprovalAsVercelEgressWould(
        approvalCards(relay.events)[0],
      );

      assert.equal(persisted.toolName, "run_tool");
      assert.deepEqual(persisted.input, THE_CALL);
      assert.equal(
        approvedCallKey(persisted.toolName, persisted.input),
        approvedCallKey("run_tool", THE_CALL),
        "the persisted part must key exactly as the gate does",
      );
    } finally {
      await relay.stop();
    }
  });

  it("the outer arguments survive both envelope unwrappers", () => {
    // The egress collapses a `{tool, server, arguments}` MCP envelope to the bare arguments, and
    // `tool` is one of its envelope keys — so `run_tool`'s outer arguments survive only because
    // `integration` sits beside it and is not an envelope key. The runner's own Codex unwrapper
    // has the same shape. Both are asserted here because a change to the argument schema that
    // dropped `integration` would silently collapse the approval identity to the inner
    // arguments, and nothing else in the suite would notice.
    const projected = projectApprovalAsVercelEgressWould({
      type: "interaction_request",
      id: "token-1",
      kind: "user_approval",
      payload: {
        toolCallId: "call-1",
        toolCall: {
          toolCallId: "call-1",
          resolvedName: "run_tool",
          rawInput: THE_CALL,
        },
      },
    });
    assert.deepEqual(projected.input, THE_CALL);

    assert.deepEqual(storedDecisionKeyShape("run_tool", THE_CALL), {
      toolName: "run_tool",
      args: THE_CALL,
    });
  });
});
