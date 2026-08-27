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
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  localRelayHost,
  startToolRelay,
  RELAY_RES_SUFFIX,
} from "../../src/tools/relay.ts";
import {
  CLIENT_TOOL_SPEC,
  RUN_TOOL_SPEC,
  TOOL_CALLBACK,
  cleanupRelayDirs,
  forgeRelayRequest,
  makeRelayDir,
  readRelayResponse,
  startGatewayRelay,
  stubToolCall,
  until,
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

/**
 * A park must not hold the caller's relay wait open.
 *
 * The gateway call executes INSIDE the caller's `relayToolCall`, which blocks on the response
 * file. If the park writes nothing, that wait runs to `RELAY_TIMEOUT_MS` (60s) and the prompt
 * cannot resolve until it returns — measured live at 59s and 135s between the approval card and
 * `stopReason=paused`, against ~30-50ms for the two pause kinds that work. The run request stays
 * open for that whole window, which is what the client reports as a failed run.
 *
 * A client-tool park on Pi is the opposite case and must stay as it is: it parks through Pi's own
 * extension, so writing an answer there would be wrong. Both halves are asserted, because the fix
 * is precisely that the two stopped being treated the same.
 */
describe("a gateway park answers the caller immediately", () => {
  it("writes the paused answer even when the disposition says not to (Pi)", async () => {
    // `writePausedAnswer: false` is the Pi disposition — the one that used to hang.
    const relay = await startGatewayRelay({ writePausedAnswer: false });
    const calls = stubToolCall({ created: true });
    try {
      const started = Date.now();
      await forgeRelayRequest(relay.dir, "park-1", {
        integration: "github",
        tool: "CREATE_ISSUE",
        arguments: { title: "bug" },
      });
      const response = await readRelayResponse(relay.dir, "park-1");
      const elapsed = Date.now() - started;

      assert.deepEqual(response, { ok: true, paused: true });
      assert.ok(
        elapsed < 2_000,
        `the caller must be answered promptly, not after the relay timeout (took ${elapsed}ms)`,
      );
      assert.equal(calls.bodies.length, 0, "and the call still did not run");
      assert.equal(relay.harness.pauses, 1, "the turn still parked");
    } finally {
      await relay.stop();
    }
  });

  it("the answer is not a success the model can act on", async () => {
    // `{ok: true, paused: true}` carries no `text`. On Pi it reaches `assertNotPaused` in
    // dispatch.ts, which throws, so the model sees an error for a call that did not run — never
    // a result. This pins the shape that guarantee rests on.
    const relay = await startGatewayRelay({ writePausedAnswer: false });
    stubToolCall({ created: true });
    try {
      await forgeRelayRequest(relay.dir, "park-2", {
        integration: "github",
        tool: "CREATE_ISSUE",
        arguments: { title: "bug" },
      });
      const response = await readRelayResponse(relay.dir, "park-2");

      assert.equal(response.paused, true);
      assert.equal(
        (response as { text?: string }).text,
        undefined,
        "a paused answer must carry no result text",
      );
    } finally {
      await relay.stop();
    }
  });

  it("a client-tool park on Pi still writes nothing", async () => {
    // Unchanged on purpose: Pi parks a client tool through its own extension.
    const dir = makeRelayDir();
    let paused = 0;
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      [CLIENT_TOOL_SPEC],
      TOOL_CALLBACK,
      undefined,
      {
        onClientTool: async () => "pendingApproval",
        onPause: () => {
          paused += 1;
        },
      },
      undefined,
      { writePausedAnswer: false },
    );
    await relay.ready;
    try {
      await forgeRelayRequest(
        dir,
        "client-park",
        { integration: "slack" },
        CLIENT_TOOL_SPEC.name,
      );
      await until(() => paused > 0, "the client-tool park");
      // Give the loop room to write an answer if it were going to.
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.equal(
        existsSync(join(dir, `client-park${RELAY_RES_SUFFIX}`)),
        false,
        "Pi's client-tool park must still write no answer file",
      );
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
