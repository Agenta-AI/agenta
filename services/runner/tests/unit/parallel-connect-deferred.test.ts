/**
 * Two connections asked for in one step must not freeze the session.
 *
 * THE DEFECT THIS PINS. The agent calls `request_connection` twice in one step. The first call
 * reaches the relay, parks, and pauses the turn. The next harness frame runs the sibling sweep,
 * which closes the second call as not executed so the agent asks again next turn. The second
 * call reached the relay only after that sweep, and it still parked: it saved a pending
 * client_tool interaction row. The chat already showed the call as closed, so no card answered
 * the row, and the server, which continues a turn only when no row on it is pending, never
 * continued the turn. Seen live with the two rows about 100 ms apart.
 *
 * This drives the real engine, the real tracer, the real responder and the real relay loop over
 * a real directory, in that exact order. Only the harness and the API are fakes.
 *
 * Run: pnpm exec vitest run tests/unit/parallel-connect-deferred.test.ts
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest, ResolvedToolSpec } from "../../src/protocol.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import { localRelayHost, startToolRelay } from "../../src/tools/relay.ts";
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import { TOOL_NOT_EXECUTED_PAUSED } from "../../src/tracing/otel.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import {
  cleanupRelayDirs,
  forgeRelayRequest,
  makeRelayDir,
} from "../utils/gateway.ts";

const API_BASE = "https://api.example";

const CONNECT_SPEC = {
  name: "request_connection",
  kind: "client",
  render: { kind: "connect" },
} as ResolvedToolSpec;

/** One harness `tool_call` frame, as Claude's ACP adapter announces an internal-MCP call. */
function toolCallFrame(toolCallId: string, integration: string) {
  return {
    payload: {
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title: `mcp__agenta-tools__${CONNECT_SPEC.name}`,
        rawInput: { integration },
        status: "pending",
      },
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  if (!predicate()) {
    throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
  }
}

let interactionPosts: Array<{
  token: string;
  kind: string;
  toolCallId?: string;
}>;

beforeEach(() => {
  vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local");
  vi.stubEnv("AGENTA_API_URL", API_BASE);
  vi.stubEnv("AGENTA_API_INTERNAL_URL", API_BASE);
  resetRunnerConfigCache();
  interactionPosts = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/sessions/interactions/") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      interactionPosts.push({
        token: body.token,
        kind: body.kind,
        toolCallId: body.data?.tool_call_id ?? body.data?.request?.tool_call_id,
      });
    }
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRunnerConfigCache();
  cleanupRelayDirs();
});

describe("two connections asked for in one step", () => {
  it("parks the first, and the second, closed by the sweep first, leaves no pending row", async () => {
    let relayDir = "";
    const harness = fakeHarness({
      promptEvents: [
        toolCallFrame("tc-exa", "exa"),
        toolCallFrame("tc-gmail", "gmail"),
      ],
      afterPromptGates: async (emit) => {
        // The first call parks and pauses the turn.
        await forgeRelayRequest(
          relayDir,
          "relay-exa",
          { integration: "exa" },
          CONNECT_SPEC.name,
        );
        await waitFor(() => interactionPosts.length > 0);
        // Any frame while paused runs the sibling sweep, which closes the second call.
        emit({
          payload: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "" },
            },
          },
        });
        // Only now does the second call reach the relay.
        await forgeRelayRequest(
          relayDir,
          "relay-gmail",
          { integration: "gmail" },
          CONNECT_SPEC.name,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
      hangPrompt: true,
    });
    // The real responder: no stored browser output, so a connect call is pending.
    delete (harness.deps as { responderFactory?: unknown }).responderFactory;
    let tracer: ReturnType<typeof createSandboxAgentOtel> | undefined;
    harness.deps.createOtel = ((
      options: Parameters<typeof createSandboxAgentOtel>[0],
    ) => {
      tracer = createSandboxAgentOtel({ ...options, emitSpans: false });
      return tracer;
    }) as never;
    harness.deps.startToolRelay = ((...args: unknown[]) => {
      relayDir = makeRelayDir();
      return startToolRelay(
        localRelayHost(),
        relayDir,
        args[2] as never,
        args[3] as never,
        args[4] as never,
        args[5] as never,
        args[6] as never,
        (args[7] ?? {}) as never,
      );
    }) as never;

    const request = {
      harness: "claude",
      sandbox: "local",
      sessionId: "session-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "connect exa and gmail" }],
      customTools: [CONNECT_SPEC],
      telemetry: {
        exporters: {
          otlp: {
            endpoint: `${API_BASE}/otlp/v1/traces`,
            headers: { authorization: "ApiKey test" },
          },
        },
      },
    } as unknown as AgentRunRequest;

    const result = await runSandboxAgent(
      request,
      undefined,
      undefined,
      harness.deps,
    );
    // Let the fire-and-forget row posts land.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(result.stopReason, "paused");
    assert.ok(tracer, "the real tracer ran");
    assert.equal(
      tracer!.wasForceSettled("tc-gmail"),
      true,
      "the sweep must have closed the second call first, or this test proves nothing",
    );
    const cards = tracer!
      .events()
      .filter(
        (event) =>
          event.type === "interaction_request" && event.kind === "client_tool",
      );
    assert.deepEqual(
      cards.map(
        (event) =>
          (event as { payload: { toolCallId?: string } }).payload.toolCallId,
      ),
      ["tc-exa"],
      "only the first call gets a card",
    );
    assert.deepEqual(
      interactionPosts.map((post) => post.kind),
      ["client_tool"],
      "only the first call saves a durable row; a second row would be the one nothing answers",
    );
    const closedGmail = tracer!
      .events()
      .find(
        (event) => event.type === "tool_result" && event.id === "tc-gmail",
      ) as { output?: string } | undefined;
    assert.equal(closedGmail?.output, TOOL_NOT_EXECUTED_PAUSED);
  });
});
