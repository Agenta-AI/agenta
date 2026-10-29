/** A gate raised late in a long turn must write its durable row with the current credential. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { runSandboxAgent, type SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";

const API_BASE = "https://api.agenta.test/api";
const INITIAL = "Secret initial";
const FRESH = "Secret fresh-at-gate";
const INITIAL_TIME = Date.parse("2026-10-04T22:13:34Z");
const MINUTE = 60_000;

let currentAuthorization = INITIAL;
let interactionPosts: Array<{ path: string; authorization: string; status: number }> = [];

beforeEach(() => {
  vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,daytona");
  vi.stubEnv("AGENTA_RUNNER_DAYTONA_API_KEY", "test-key");
  vi.stubEnv("AGENTA_API_URL", API_BASE);
  vi.stubEnv("AGENTA_API_INTERNAL_URL", API_BASE);
  currentAuthorization = INITIAL;
  interactionPosts = [];
  // The fake API accepts only the credential that is current at request time.
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const path = String(input);
    if (!path.includes("/sessions/interactions")) return new Response("{}", { status: 401 });
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const status = authorization === currentAuthorization ? 200 : 401;
    interactionPosts.push({ path, authorization, status });
    return new Response("{}", { status });
  });
  resetRunnerConfigCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(INITIAL_TIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetRunnerConfigCache();
});

function fakeGatedTurn() {
  let permissionHandler: ((req: unknown) => void) | undefined;
  let resolvePrompt: ((value: { stopReason: string }) => void) | undefined;
  const session = {
    id: "harness-session",
    agentSessionId: "native-session",
    onEvent() {},
    onPermissionRequest(handler: (req: unknown) => void) {
      permissionHandler = handler;
    },
    async respondPermission() {},
    async rollbackFailedTurn() { return true; },
    prompt() {
      // The gate opens 19 minutes into the turn, after the start-of-turn token expired.
      vi.setSystemTime(INITIAL_TIME + 19 * MINUTE);
      currentAuthorization = FRESH;
      permissionHandler?.({
        id: "permission-1",
        availableReplies: ["once", "reject"],
        toolCall: { toolCallId: "call-1", name: "request_input", rawInput: { message: "Approve?" } },
      });
      return new Promise<{ stopReason: string }>((resolve) => { resolvePrompt = resolve; });
    },
  };
  const sandbox: any = {
    sandboxId: "daytona/fake",
    sandboxProvider: { destroy: async () => {} },
    sandboxProviderRawId: "fake",
    createSession: async () => session,
    cancelSession: async () => { resolvePrompt?.({ stopReason: "cancelled" }); },
    destroySession: async () => { resolvePrompt?.({ stopReason: "cancelled" }); },
    pauseSandbox: async () => {},
    destroySandbox: async () => {},
    dispose: async () => {},
    runProcess: async () => ({ stdout: "", exitCode: 0 }),
  };
  const deps: SandboxAgentDeps = {
    log: () => {},
    createDaytonaCwd: () => "/tmp/fake-interaction-credential-turn",
    resolveSkillDirs: () => ({ skills: [], dropped: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ deleteSandbox: async () => {} }) as any,
    createPersist: () => ({}) as any,
    sessionContinuityStore: new SessionContinuityStore(),
    hydrateHarnessSessionFromDurable: async () => {},
    appendSessionTurn: Object.assign(async () => {}, { complete: async () => {} }) as any,
    startSandboxAgent: (async () => sandbox) as any,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as any,
    probeCapabilities: async () => ({
      source: "probed",
      capabilities: { mcpTools: true, toolCalls: true, usage: true, streamingDeltas: true },
    }),
    applyModel: async () => "resolved-model",
    createOtel: (() => ({
      start() {}, handleUpdate() {}, emitEvent() {}, setUsage() {}, recordError() {},
      usage: () => ({ input: 0, output: 0, total: 0 }),
      finish: () => "answer", output: () => "answer", flush: async () => {},
      events: () => [], settleOpenToolCalls() {}, traceId: () => "trace-1",
    })) as any,
    startToolRelay: (() => ({ stop: async () => {} })) as any,
    localRelayHost: (() => "unused") as any,
    sandboxRelayHost: (() => "unused") as any,
    responderFactory: () => ({
      onPermission: async () => ({ kind: "pendingApproval" }),
      onClientTool: async () => ({ kind: "pendingApproval" }),
    }) as any,
    readStoredSandboxPointer: async () => ({ sandboxId: "fake" }),
  };
  const request: AgentRunRequest = {
    harness: "claude", sandbox: "daytona", sessionId: "session-long-turn", turnId: "turn-1",
    messages: [{ role: "user", content: "work for a long time, then ask me" }],
    telemetry: { exporters: { otlp: { endpoint: `${API_BASE}/otlp/v1/traces`, headers: { authorization: INITIAL } } } },
  };
  return { request, deps, credential: () => currentAuthorization };
}

describe("interaction row credential rotation", () => {
  it("writes a late gate's interaction row with the current credential", async () => {
    const fake = fakeGatedTurn();
    await runSandboxAgent(fake.request, undefined, undefined, fake.deps, { credential: fake.credential });
    await vi.waitFor(() => assert.ok(interactionPosts.length > 0, "the gate wrote no interaction row"));
    const create = interactionPosts.filter((post) => post.path === `${API_BASE}/sessions/interactions/`);
    assert.ok(create.length > 0, "the gate wrote no interaction row");
    assert.deepEqual(create[0], {
      path: `${API_BASE}/sessions/interactions/`,
      authorization: FRESH,
      status: 200,
    });
  });
});
