/**
 * Tool calls read the run credential at send time, and an expired one ends retries.
 *
 * The run credential lives 15 minutes and a turn can run longer. The relay is built once per
 * turn, so every transport must read the CURRENT credential before each request, not the value
 * the turn started with. When the platform still answers `401 expired_signature`, the model gets
 * one terminal envelope instead of a retryable one.
 *
 * Run: pnpm exec vitest run tests/unit/tool-credential-rotation.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedToolSpec } from "../../src/protocol.ts";
import { callAgentaTool } from "../../src/tools/callback.ts";
import { buildConfigTextFetcher } from "../../src/tools/config-text.ts";
import { callDirect } from "../../src/tools/direct.ts";
import {
  RUN_CREDENTIAL_EXPIRED_ERROR,
  RunCredentialExpiredError,
  type ToolCallbackRuntime,
} from "../../src/tools/run-credential.ts";
import { TOOL_SEARCH_UNAVAILABLE_ERROR } from "../../src/tools/gateway-policy.ts";
import {
  buildApprovedContentWiring,
  createCommitAuthorizationState,
} from "../../src/engines/sandbox_agent/approved-content.ts";
import {
  SEARCH_TOOL_SPEC,
  cleanupRelayDirs,
  forgeRelayRequest,
  readRelayResponse,
  startGatewayRelay,
} from "../utils/gateway.ts";

const ENDPOINT = "https://api.example/tools/call";
const EXPIRED_BODY = JSON.stringify({
  detail: { message: "Unauthorized", reason: "expired_signature" },
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

const DIRECT_SPEC: ResolvedToolSpec = {
  name: "send_channel_message",
  kind: "callback",
  call: { method: "POST", path: "/channels/messages", args_into: "data" },
};

const CALLBACK_SPEC: ResolvedToolSpec = {
  name: "list_things",
  kind: "callback",
  callRef: "tools.agenta.list_things",
};

/** A callback whose credential the test rotates by assigning `current`. */
function rotatingCallback(initial: string) {
  const state = { current: initial };
  const callback: ToolCallbackRuntime = {
    endpoint: ENDPOINT,
    credential: () => state.current,
  };
  return { state, callback };
}

/** Answer every request with `respond`, recording the authorization header it carried. */
function stubFetch(
  respond: (url: string) => Response = () =>
    new Response(
      JSON.stringify({
        call: { data: { content: "{}" }, status: { code: "STATUS_CODE_OK" } },
      }),
      { status: 200 },
    ),
): Array<{ url: string; authorization: string | undefined }> {
  const sent: Array<{ url: string; authorization: string | undefined }> = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({ url: String(url), authorization: headers["authorization"] });
    return respond(String(url));
  }) as typeof fetch;
  return sent;
}

const expired = () => new Response(EXPIRED_BODY, { status: 401 });

describe("one relay, a rotated credential", () => {
  it("sends the current credential on direct, callback, search and config-text requests", async () => {
    const { state, callback } = rotatingCallback("Secret A");
    const relay = await startGatewayRelay({
      callback,
      specs: [DIRECT_SPEC, CALLBACK_SPEC, SEARCH_TOOL_SPEC],
    });
    const fetchText = buildConfigTextFetcher({
      callback,
      runContext: { workflow: { variant: { id: "variant-1" } } } as never,
    });
    try {
      const sent = stubFetch();
      await forgeRelayRequest(relay.dir, "direct-a", { text: "hi" }, DIRECT_SPEC.name);
      await readRelayResponse(relay.dir, "direct-a");
      assert.deepEqual(
        sent.map((s) => s.authorization),
        ["Secret A"],
      );

      state.current = "Secret B";
      sent.length = 0;
      await forgeRelayRequest(relay.dir, "direct-b", { text: "hi" }, DIRECT_SPEC.name);
      await readRelayResponse(relay.dir, "direct-b");
      await forgeRelayRequest(relay.dir, "callback-b", {}, CALLBACK_SPEC.name);
      await readRelayResponse(relay.dir, "callback-b");
      await forgeRelayRequest(
        relay.dir,
        "search-b",
        { query: "read an issue" },
        SEARCH_TOOL_SPEC.name,
      );
      await readRelayResponse(relay.dir, "search-b");
      await fetchText({ revisionId: "rev-1", target: ["x"] }).catch(() => {});

      assert.equal(sent.length, 4);
      assert.deepEqual(
        sent.map((s) => s.authorization),
        ["Secret B", "Secret B", "Secret B", "Secret B"],
      );
    } finally {
      await relay.stop();
    }
  });
});

describe("a 401 expired_signature is terminal", () => {
  it("throws the typed error from both transports", async () => {
    stubFetch(expired);
    await assert.rejects(
      () => callAgentaTool(ENDPOINT, "Secret A", "x", "t", {}),
      RunCredentialExpiredError,
    );
    await assert.rejects(
      () => callDirect("POST", "https://api.example/x", "Secret A", {}),
      RunCredentialExpiredError,
    );
  });

  for (const [name, response] of [
    [
      "a 401 with another reason",
      () =>
        new Response(
          JSON.stringify({ detail: { message: "Unauthorized", reason: "invalid_token" } }),
          { status: 401 },
        ),
    ],
    ["a 401 without a JSON body", () => new Response("<html>nope</html>", { status: 401 })],
    ["a 401 with a string detail", () => new Response('{"detail":"Unauthorized"}', { status: 401 })],
    ["a 403 that names expired_signature", () => new Response(EXPIRED_BODY, { status: 403 })],
  ] as Array<[string, () => Response]>) {
    it(`keeps today's error for ${name}`, async () => {
      stubFetch(response);
      await assert.rejects(
        () => callAgentaTool(ENDPOINT, "Secret A", "x", "t", {}),
        (err: Error) =>
          !(err instanceof RunCredentialExpiredError) && /HTTP 40[13]/.test(err.message),
      );
      await assert.rejects(
        () => callDirect("POST", "https://api.example/x", "Secret A", {}),
        (err: Error) =>
          !(err instanceof RunCredentialExpiredError) &&
          /direct tool call failed: HTTP 40[13]/.test(err.message),
      );
    });
  }

  it("keeps today's error for a transport failure", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;
    await assert.rejects(
      () => callAgentaTool(ENDPOINT, "Secret A", "x", "t", {}),
      (err: Error) => !(err instanceof RunCredentialExpiredError),
    );
    await assert.rejects(
      () => callDirect("POST", "https://api.example/x", "Secret A", {}),
      (err: Error) => err.message === "direct tool call failed",
    );
  });

  it("answers an ordinary tool and search with the run_credential_expired envelope", async () => {
    const relay = await startGatewayRelay({
      callback: rotatingCallback("Secret A").callback,
      specs: [DIRECT_SPEC, CALLBACK_SPEC, SEARCH_TOOL_SPEC],
    });
    try {
      stubFetch(expired);
      await forgeRelayRequest(relay.dir, "direct", {}, DIRECT_SPEC.name);
      await forgeRelayRequest(relay.dir, "callback", {}, CALLBACK_SPEC.name);
      await forgeRelayRequest(relay.dir, "search", { query: "q" }, SEARCH_TOOL_SPEC.name);
      for (const id of ["direct", "callback", "search"]) {
        const response = await readRelayResponse(relay.dir, id);
        assert.equal(response.ok, false, id);
        assert.deepEqual(
          JSON.parse(String(response.error)),
          RUN_CREDENTIAL_EXPIRED_ERROR,
          id,
        );
      }
    } finally {
      await relay.stop();
    }
  });

  it("still answers search with tool_search_unavailable for any other failure", async () => {
    const relay = await startGatewayRelay({
      callback: rotatingCallback("Secret A").callback,
      specs: [SEARCH_TOOL_SPEC],
    });
    try {
      stubFetch(() => new Response("boom", { status: 500 }));
      await forgeRelayRequest(relay.dir, "search", { query: "q" }, SEARCH_TOOL_SPEC.name);
      const response = await readRelayResponse(relay.dir, "search");
      assert.deepEqual(JSON.parse(String(response.error)), TOOL_SEARCH_UNAVAILABLE_ERROR);
    } finally {
      await relay.stop();
    }
  });
});

describe("an approved-content read with an expired credential", () => {
  const commitSpec: ResolvedToolSpec = {
    name: "commit_revision",
    kind: "callback",
    callRef: "tools.agenta.commit_revision",
    permission: "allow",
    readOnly: false,
  };
  const args = {
    workflow_revision: {
      base_revision_id: "rev-1",
      delta: {
        operations: [
          {
            operation: "set",
            target: ["parameters", "agent", "instructions"],
            value: { "@ag.file": ".agenta-imports/notes.md" },
          },
        ],
      },
    },
  };

  function wiring(log?: (msg: string) => void) {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-expired-"));
    mkdirSync(join(cwd, ".agenta-imports"), { recursive: true });
    writeFileSync(join(cwd, ".agenta-imports", "notes.md"), "new text\n");
    return buildApprovedContentWiring({
      state: createCommitAuthorizationState(),
      isDaytona: false,
      workspaceCwd: cwd,
      sandbox: undefined,
      callback: rotatingCallback("Secret A").callback,
      runContext: { workflow: { variant: { id: "variant-1" } } } as never,
      permissionPlan: { default: "allow", rules: [] },
      toolSpecs: [commitSpec],
      turnId: "turn-1",
      sessionId: "session-1",
      log,
    });
  }

  it("is not turned into a retryable source_base_unavailable on either path", async () => {
    stubFetch(expired);
    const logs: string[] = [];
    const w = wiring((msg) => logs.push(msg));

    const gate = await w.onResolveApprovedContent({
      toolName: commitSpec.name,
      toolCallId: "call-gate",
      args,
    });
    assert.equal(gate.ok, false);
    assert.deepEqual((gate as { detail?: unknown }).detail, RUN_CREDENTIAL_EXPIRED_ERROR);

    const relay = await w.authorizer(commitSpec, {
      toolName: commitSpec.name,
      toolCallId: "call-relay",
      args,
    } as never);
    assert.equal(relay.ok, false);
    assert.deepEqual(
      JSON.parse((relay as { reason: string }).reason),
      RUN_CREDENTIAL_EXPIRED_ERROR,
    );
    assert.deepEqual((relay as { detail?: unknown }).detail, RUN_CREDENTIAL_EXPIRED_ERROR);
    assert.ok(
      logs.includes(
        "[commit-auth] refused tool=commit_revision call=call-relay code=run_credential_expired",
      ),
      logs.join("\n"),
    );
  });

  it("keeps source_base_unavailable for a 401 that is not an expiry", async () => {
    stubFetch(() => new Response('{"detail":{"reason":"invalid_token"}}', { status: 401 }));
    const relay = await wiring().authorizer(commitSpec, {
      toolName: commitSpec.name,
      toolCallId: "call-relay",
      args,
    } as never);
    assert.equal(relay.ok, false);
    assert.match((relay as { reason: string }).reason, /^source_base_unavailable:/);
  });
});
