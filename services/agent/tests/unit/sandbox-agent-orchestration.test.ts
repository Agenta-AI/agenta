/**
 * Unit tests for sandbox-agent engine orchestration with fake sandbox/session handles.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-orchestration.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import type { PermissionDecision } from "../../src/responder.ts";
import { runSandboxAgent, type SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface FakeOptions {
  request?: Partial<AgentRunRequest>;
  cwd?: string;
  capabilities?: Record<string, unknown>;
  promptResult?: Record<string, unknown>;
  streamUsage?: Record<string, number>;
  output?: string;
  promptError?: Error;
  permissionDecision?: PermissionDecision;
  emitPermission?: boolean;
}

function fakeHarness(options: FakeOptions = {}) {
  const calls = {
    daemonAgent: "",
    providerArgs: [] as unknown[],
    startOptions: undefined as any,
    createSessionOptions: undefined as any,
    promptBlocks: undefined as any,
    runStart: undefined as any,
    otelOptions: undefined as any,
    workspacePlan: undefined as any,
    workspaceCleanup: 0,
    sandboxDestroyed: 0,
    sandboxDisposed: 0,
    toolRelayArgs: undefined as unknown[] | undefined,
    toolRelayStops: 0,
    permissionReplies: [] as Array<{ id: string; reply: string }>,
    runFinished: 0,
    runFlushed: 0,
  };
  const events: AgentEvent[] = [];
  let eventHandler: ((event: any) => void) | undefined;
  let permissionHandler: ((request: any) => void) | undefined;

  const session = {
    id: "session-1",
    onEvent(handler: (event: any) => void) {
      eventHandler = handler;
    },
    onPermissionRequest(handler: (request: any) => void) {
      permissionHandler = handler;
    },
    async respondPermission(id: string, reply: string) {
      calls.permissionReplies.push({ id, reply });
    },
    async prompt(blocks: any) {
      calls.promptBlocks = blocks;
      eventHandler?.({ payload: { update: { kind: "noop" } } });
      if (options.emitPermission) {
        permissionHandler?.({
          id: "perm-1",
          availableReplies: ["once", "always", "reject"],
          toolCall: { toolCallId: "tool-1", name: "edit" },
        });
      }
      if (options.promptError) throw options.promptError;
      return options.promptResult ?? {
        stopReason: "complete",
        usage: { inputTokens: 6, outputTokens: 4 },
      };
    },
  };

  const sandbox = {
    async createSession(opts: any) {
      calls.createSessionOptions = opts;
      return session;
    },
    async destroySandbox() {
      calls.sandboxDestroyed += 1;
    },
    async dispose() {
      calls.sandboxDisposed += 1;
    },
  };

  const run = {
    start(input: any) {
      calls.runStart = input;
    },
    handleUpdate(_update: any) {},
    emitEvent(event: AgentEvent) {
      events.push(event);
    },
    usage() {
      return options.streamUsage ?? { input: 0, output: 0, total: 0, cost: 0.25 };
    },
    setUsage(usage: unknown) {
      events.push({ type: "usage", ...(usage as any) });
    },
    finish() {
      calls.runFinished += 1;
      return options.output ?? "assistant output";
    },
    async flush() {
      calls.runFlushed += 1;
    },
    events() {
      return events;
    },
    traceId() {
      return "trace-1";
    },
  };

  const deps: SandboxAgentDeps = {
    log: () => {},
    createLocalCwd: () => options.cwd ?? "/tmp/agenta-fake-cwd",
    createDaytonaCwd: () => "/home/sandbox/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: (agent) => {
      calls.daemonAgent = agent;
      return {};
    },
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: (...args: unknown[]) => {
      calls.providerArgs = args;
      return { provider: true } as any;
    },
    createPersist: () => ({}) as any,
    startSandboxAgent: (async (opts: any) => {
      calls.startOptions = opts;
      return sandbox;
    }) as any,
    prepareWorkspace: (async ({ plan }: any) => {
      calls.workspacePlan = plan;
      return {
        cleanup: async () => {
          calls.workspaceCleanup += 1;
        },
      };
    }) as any,
    probeCapabilities: async () =>
      ({
        mcpTools: true,
        usage: true,
        streamingDeltas: true,
        ...(options.capabilities ?? {}),
      }) as any,
    applyModel: async (_session, model) => model ?? "resolved-model",
    createOtel: ((otelOptions: any) => {
      calls.otelOptions = otelOptions;
      return run;
    }) as any,
    startToolRelay: ((...args: unknown[]) => {
      calls.toolRelayArgs = args;
      return {
        stop: async () => {
          calls.toolRelayStops += 1;
        },
      };
    }) as any,
    localRelayHost: (() => "local-relay-host") as any,
    sandboxRelayHost: (() => "sandbox-relay-host") as any,
    responderFactory: () => ({
      async onPermission() {
        return options.permissionDecision ?? "allow";
      },
    }),
  };

  return { calls, deps, events };
}

describe("runSandboxAgent orchestration", () => {
  it("returns a successful one-shot result and cleans up acquired resources", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      { harness: "claude", prompt: "hello", model: "requested-model" },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.output, "assistant output");
    assert.deepEqual(result.messages, [{ role: "assistant", content: "assistant output" }]);
    assert.deepEqual(result.usage, { input: 6, output: 4, total: 10, cost: 0.25 });
    assert.equal(result.stopReason, "complete");
    assert.equal(result.sessionId, "session-1");
    assert.equal(result.model, "requested-model");
    assert.equal(result.traceId, "trace-1");
    assert.equal(result.capabilities?.streamingDeltas, false);
    assert.equal(calls.daemonAgent, "claude");
    assert.equal(calls.createSessionOptions.agent, "claude");
    assert.equal(calls.createSessionOptions.cwd, "/tmp/agenta-fake-cwd");
    assert.deepEqual(calls.promptBlocks, [{ type: "text", text: "hello" }]);
    assert.deepEqual(calls.runStart.messages, [{ role: "user", content: "hello" }]);
    assert.equal(calls.runFinished, 1);
    assert.equal(calls.runFlushed, 1);
    assert.equal(calls.sandboxDestroyed, 1);
    assert.equal(calls.sandboxDisposed, 1);
    assert.equal(calls.workspaceCleanup, 1);
  });

  it("keeps terminal events empty on the streaming path", async () => {
    const { deps } = fakeHarness();
    const streamed: AgentEvent[] = [];

    const result = await runSandboxAgent(
      { harness: "claude", prompt: "hello" },
      (event) => streamed.push(event),
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.events, []);
    assert.equal(result.capabilities?.streamingDeltas, true);
    assert.deepEqual(streamed, []);
  });

  it("surfaces permission requests and answers them through the responder", async () => {
    const { calls, deps } = fakeHarness({ emitPermission: true });

    const result = await runSandboxAgent(
      { harness: "claude", prompt: "edit the file" },
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.events?.filter((event) => event.type === "interaction_request"), [
      {
        type: "interaction_request",
        id: "perm-1",
        kind: "permission",
        payload: {
          toolCallId: "tool-1",
          toolCall: { toolCallId: "tool-1", name: "edit" },
          availableReplies: ["once", "always", "reject"],
          options: undefined,
        },
      },
    ]);
    assert.deepEqual(calls.permissionReplies, [{ id: "perm-1", reply: "always" }]);
  });

  it("starts and stops the tool relay only when executable tools are present", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        prompt: "use the tool",
        customTools: [{ name: "server_tool", kind: "callback" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(calls.toolRelayArgs, [
      "local-relay-host",
      "/tmp/agenta-fake-cwd/.agenta-tools",
      [{ name: "server_tool", kind: "callback" }],
      undefined,
    ]);
    assert.equal(calls.toolRelayStops, 2, "stopped after prompt and again in finally");
  });

  it("flushes a partial trace and cleans up on prompt errors", async () => {
    const { calls, deps } = fakeHarness({ promptError: new Error("boom") });

    const result = await runSandboxAgent(
      { harness: "claude", prompt: "explode" },
      undefined,
      undefined,
      deps,
    );

    assert.deepEqual(result, { ok: false, error: "boom" });
    assert.equal(calls.runFinished, 1);
    assert.equal(calls.runFlushed, 1);
    assert.equal(calls.sandboxDestroyed, 1);
    assert.equal(calls.sandboxDisposed, 1);
    assert.equal(calls.workspaceCleanup, 1);
  });

  it("passes cancellation signals into SandboxAgent.start", async () => {
    const { calls, deps } = fakeHarness();
    const controller = new AbortController();

    const result = await runSandboxAgent(
      { harness: "claude", prompt: "hello" },
      undefined,
      controller.signal,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(calls.startOptions.signal, controller.signal);
  });
});
