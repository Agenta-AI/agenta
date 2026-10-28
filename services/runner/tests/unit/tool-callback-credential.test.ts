/**
 * Which credential a turn's tool calls carry, and who keeps it fresh.
 *
 * The callback credential is the platform run credential. The OTLP header may instead belong to
 * an external collector, and that key must never be refreshed against the platform or sent on a
 * tool call. A session-owned turn reuses the watchdog lease when it holds the same credential;
 * any other turn owns a lease for the callback credential, for that turn only.
 *
 * Run: pnpm exec vitest run tests/unit/tool-callback-credential.test.ts
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import {
  acquireEnvironment,
  runSandboxAgent,
  runTurn,
} from "../../src/engines/sandbox_agent.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { DEFAULT_PLATFORM_CREDENTIAL_REFRESH_INTERVAL_MS } from "../../src/sessions/auth.ts";
import {
  startToolCallbackRuntime,
  type ToolCallbackRuntime,
} from "../../src/tools/run-credential.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

const CALLBACK = {
  endpoint: "https://api.example/api/tools/call",
  authorization: "Secret S",
};

const realFetch = globalThis.fetch;
const realApiUrl = process.env.AGENTA_API_URL;
let refreshes: Array<{ url: string; authorization: string }>;

beforeEach(() => {
  process.env.AGENTA_API_URL = "https://api.example/api";
  refreshes = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const authorization = String(
      (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
    );
    if (String(url).includes("/access/permissions/check")) {
      refreshes.push({ url: String(url), authorization });
      return new Response(
        JSON.stringify({ credentials: `${authorization}-refreshed` }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
  if (realApiUrl === undefined) delete process.env.AGENTA_API_URL;
  else process.env.AGENTA_API_URL = realApiUrl;
});

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    harness: "claude",
    sandbox: "local",
    messages: [{ role: "user", content: "hi" }],
    customTools: [
      { name: "list_things", kind: "callback", callRef: "tools.agenta.list_things" },
    ],
    toolCallback: CALLBACK,
    ...overrides,
  } as AgentRunRequest;
}

/** Run one turn; mid-turn, let one refresh interval pass and read the relay's credential. */
async function credentialAfterOneRefresh(
  req: AgentRunRequest,
  turnOptions: { credential?: () => string } = {},
): Promise<string | undefined> {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let seen: string | undefined;
  const harness = fakeHarness({
    afterPromptEvents: async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_PLATFORM_CREDENTIAL_REFRESH_INTERVAL_MS);
      const runtime = harness.calls.toolRelayArgs?.[3] as ToolCallbackRuntime;
      seen = runtime.credential();
    },
  });
  const result = await runSandboxAgent(req, undefined, undefined, harness.deps, turnOptions);
  assert.equal(result.ok, true, JSON.stringify(result));
  return seen;
}

describe("the turn's tool credential", () => {
  it("is refreshed by the turn itself when the run has no Agenta tracing", async () => {
    const seen = await credentialAfterOneRefresh(request());

    assert.equal(seen, "Secret S-refreshed");
    assert.deepEqual(refreshes, [
      {
        url: "https://api.example/api/access/permissions/check?action=run_service&resource_type=service",
        authorization: "Secret S",
      },
    ]);
  });

  it("never carries or refreshes an external collector key", async () => {
    const seen = await credentialAfterOneRefresh(
      request({
        telemetry: {
          exporters: {
            otlp: {
              endpoint: "https://collector.example/v1/traces",
              headers: { authorization: "Bearer collector-key" },
            },
          },
        } as never,
      }),
    );

    assert.equal(seen, "Secret S-refreshed");
    assert.ok(refreshes.length > 0);
    assert.ok(
      refreshes.every((r) => r.authorization === "Secret S"),
      JSON.stringify(refreshes),
    );
  });

  it("reuses the session lease when it holds the callback credential", async () => {
    let watchdog = "Secret S";
    const seen = await credentialAfterOneRefresh(
      request({
        telemetry: {
          exporters: {
            otlp: {
              endpoint: "https://api.example/api/otlp/v1/traces",
              headers: { authorization: "Secret S" },
            },
          },
        } as never,
      }),
      {
        credential: () => {
          const current = watchdog;
          watchdog = "Secret W";
          return current;
        },
      },
    );

    assert.equal(seen, "Secret W", "the relay reads the watchdog lease");
    assert.deepEqual(refreshes, [], "the turn starts no second lease for the same credential");
  });

  it("binds a warm session's next turn to that turn's credential", async () => {
    const harness = fakeHarness();
    const first = request();
    const acquired = await acquireEnvironment(first, harness.deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    await runTurn(acquired.env, first, undefined, undefined, {});
    const firstRuntime = harness.calls.toolRelayArgs?.[3] as ToolCallbackRuntime;
    await runTurn(
      acquired.env,
      request({ toolCallback: { ...CALLBACK, authorization: "Secret S2" } }),
      undefined,
      undefined,
      {},
    );
    const secondRuntime = harness.calls.toolRelayArgs?.[3] as ToolCallbackRuntime;

    assert.notEqual(secondRuntime, firstRuntime);
    assert.equal(firstRuntime.credential(), "Secret S");
    assert.equal(secondRuntime.credential(), "Secret S2");
  });
});

describe("startToolCallbackRuntime", () => {
  it("sends nothing and refreshes nothing when the callback has no credential", async () => {
    vi.useFakeTimers();
    const { runtime, release } = startToolCallbackRuntime({ endpoint: CALLBACK.endpoint });
    await vi.advanceTimersByTimeAsync(DEFAULT_PLATFORM_CREDENTIAL_REFRESH_INTERVAL_MS * 2);

    assert.equal(runtime?.credential(), undefined);
    assert.deepEqual(refreshes, []);
    release();
  });

  it("stops refreshing at release", async () => {
    vi.useFakeTimers();
    const { runtime, release } = startToolCallbackRuntime(CALLBACK);
    release();
    await vi.advanceTimersByTimeAsync(DEFAULT_PLATFORM_CREDENTIAL_REFRESH_INTERVAL_MS * 2);

    assert.equal(runtime?.credential(), "Secret S");
    assert.deepEqual(refreshes, []);
  });
});
