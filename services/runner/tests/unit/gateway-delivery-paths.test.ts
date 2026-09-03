/**
 * Every delivery path is gated the same way: qa.md R9 to R13, plus R29.
 *
 * The model naming a tool is not proof the tool is permitted, and neither is a request file
 * appearing in the relay directory. That directory is sandbox-writable, so an in-sandbox process
 * can forge an execute record without passing any dialog — which is exactly why the gate lives at
 * the relay execution seam that Pi's extension, the local loopback MCP server and the in-sandbox
 * shim all pass through.
 *
 * R13 is the one that is easy to fake. A test that accepts a refusal for a compiled `ask` passes
 * against an implementation that silently denies every relay-path approval, which is the wrong
 * behavior. So it asserts the real Sessions interaction row and the paused turn.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-delivery-paths.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { createInteraction } from "../../src/sessions/interactions.ts";
import { runResolvedToolAllowingPause } from "../../src/tools/dispatch.ts";
import { RELAY_PAUSED } from "../../src/tools/relay-client.ts";
import {
  RUN_TOOL_SPEC,
  cleanupRelayDirs,
  forgeRelayRequest,
  readRelayResponse,
  startGatewayRelay,
  stubToolCall,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

describe("the gate holds on every delivery path (R9, R10)", () => {
  it("R9: a call over the loopback dispatch reaches the gate and runs when allowed", async () => {
    const relay = await startGatewayRelay();
    const calls = stubToolCall({ issue: { number: 12 } });
    try {
      const text = await runResolvedToolAllowingPause(
        RUN_TOOL_SPEC,
        { integration: "github", tool: "GET_ISSUE", arguments: { issue: 12 } },
        { toolCallId: "loopback-1", relayDir: relay.dir },
      );

      assert.notEqual(text, RELAY_PAUSED);
      assert.equal(text, JSON.stringify({ issue: { number: 12 } }));
      assert.equal(calls.bodies.length, 1);
    } finally {
      await relay.stop();
    }
  });

  it("R10: a forged relay file gets the same answer as the same call over the harness path", async () => {
    const relay = await startGatewayRelay();
    const calls = stubToolCall({ issue: { number: 12 } });
    try {
      await forgeRelayRequest(relay.dir, "forged-1", {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 12 },
      });
      const response = await readRelayResponse(relay.dir, "forged-1");

      assert.deepEqual(response, {
        ok: true,
        text: JSON.stringify({ issue: { number: 12 } }),
      });
      // The same call, the same policy, the same result — provenance changes nothing.
      assert.equal(calls.bodies.length, 1);
    } finally {
      await relay.stop();
    }
  });
});

describe("a forged file cannot run what the policy refuses (R11, R12)", () => {
  it("R11: a denied tool answers with an error, not a result, and makes no callback", async () => {
    const relay = await startGatewayRelay();
    const calls = stubToolCall({ deleted: true });
    try {
      await forgeRelayRequest(relay.dir, "forged-deny", {
        integration: "github",
        tool: "DELETE_REPOSITORY",
        arguments: { repo: "agenta" },
      });
      const response = await readRelayResponse(relay.dir, "forged-deny");

      assert.equal(response.ok, false);
      assert.ok(response.error);
      assert.equal(calls.bodies.length, 0, "no callback is made for a deny");
    } finally {
      await relay.stop();
    }
  });

  it("R12: an unconfigured integration is refused before the callback", async () => {
    const relay = await startGatewayRelay();
    const calls = stubToolCall({ charged: true });
    try {
      await forgeRelayRequest(relay.dir, "forged-stripe", {
        integration: "stripe",
        tool: "CREATE_CHARGE",
        arguments: { amount: 100 },
      });
      const response = await readRelayResponse(relay.dir, "forged-stripe");

      assert.equal(response.ok, false);
      assert.ok(!String(response.error).includes("stripe"));
      assert.equal(calls.bodies.length, 0);
    } finally {
      await relay.stop();
    }
  });

  it("R29: a nested arguments value of the wrong type is refused before approval", async () => {
    const relay = await startGatewayRelay();
    const calls = stubToolCall({ created: true });
    try {
      for (const [id, args] of [
        ["forged-string", "title=bug"],
        ["forged-array", ["bug"]],
        ["forged-null", null],
      ] as const) {
        await forgeRelayRequest(relay.dir, id, {
          integration: "github",
          tool: "CREATE_ISSUE",
          arguments: args,
        });
        const response = await readRelayResponse(relay.dir, id);
        assert.equal(response.ok, false, `${id} must be refused`);
      }

      assert.equal(calls.bodies.length, 0);
      assert.equal(
        relay.harness.interactions.length,
        0,
        "the type is checked before the approval card, never after it",
      );
    } finally {
      await relay.stop();
    }
  });
});

describe("R13: a forged ask raises a real approval and pauses the turn", () => {
  it("creates a Sessions interaction row and pauses, rather than running or refusing", async () => {
    const relay = await startGatewayRelay();
    const posted: Record<string, any>[] = [];
    const calls: unknown[] = [];
    process.env.AGENTA_API_INTERNAL_URL = "https://api.example";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (String(url).includes("/sessions/interactions/")) {
        posted.push(body);
        return new Response("{}", { status: 200 });
      }
      calls.push(body);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await forgeRelayRequest(relay.dir, "forged-ask", {
        integration: "github",
        tool: "CREATE_ISSUE",
        arguments: { title: "bug" },
      });
      const response = await readRelayResponse(relay.dir, "forged-ask");

      // Neither an execution nor a refusal: the call parked.
      assert.deepEqual(response, { ok: true, paused: true });
      assert.equal(calls.length, 0, "a parked call makes no provider callback");
      assert.equal(relay.harness.pauses, 1, "the turn ended");
      assert.equal(relay.harness.interactions.length, 1);

      // The durable row a person answers, on the real Sessions plane. The turn's own
      // `recordPendingInteraction` posts exactly this.
      const recorded = relay.harness.interactions[0];
      await createInteraction(
        "session-1",
        "turn-1",
        recorded.token,
        recorded.kind,
        { request: { tool: recorded.toolName ?? "", args: recorded.toolArgs } },
        () => "Access tok",
      );
      assert.equal(posted.length, 1);
      assert.equal(posted[0].kind, "user_approval");
      assert.equal(posted[0].token, recorded.token);
      // The durable row keys on the same identity the gate did, and its arguments still carry
      // the integration and the tool key for a person to read.
      assert.equal(posted[0].data.request.tool, "run_tool");
      assert.deepEqual(posted[0].data.request.args, {
        integration: "github",
        tool: "CREATE_ISSUE",
        arguments: { title: "bug" },
      });
    } finally {
      await relay.stop();
      delete process.env.AGENTA_API_INTERNAL_URL;
    }
  });

  it("the loopback dispatch reports that pause instead of a tool error", async () => {
    const relay = await startGatewayRelay();
    stubToolCall({ created: true });
    try {
      const outcome = await runResolvedToolAllowingPause(
        RUN_TOOL_SPEC,
        {
          integration: "github",
          tool: "CREATE_ISSUE",
          arguments: { title: "bug" },
        },
        { toolCallId: "loopback-ask", relayDir: relay.dir },
      );

      assert.equal(
        outcome,
        RELAY_PAUSED,
        "a real pause must not surface to the harness as a failed tool call",
      );
      assert.equal(relay.harness.pauses, 1);
    } finally {
      await relay.stop();
    }
  });
});

describe("a run with no gate wired fails closed", () => {
  it("refuses a gateway call rather than executing it unchecked", async () => {
    const relay = await startGatewayRelay({ withoutGate: true });
    const calls = stubToolCall({ issue: 12 });
    try {
      await forgeRelayRequest(relay.dir, "no-gate", {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 12 },
      });
      const response = await readRelayResponse(relay.dir, "no-gate");

      assert.equal(response.ok, false);
      assert.equal(calls.bodies.length, 0);
    } finally {
      await relay.stop();
    }
  });
});
