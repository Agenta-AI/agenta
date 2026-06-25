/**
 * Unit tests for sandbox-agent engine orchestration with fake sandbox/session handles.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-orchestration.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import type { PermissionDecision } from "../../src/responder.ts";
import {
  runSandboxAgent,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";

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
    daemonOptions: undefined as { clearProviderEnv?: boolean } | undefined,
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
    applyModelArgs: [] as Array<{
      model: string | undefined;
      options: { strict?: boolean } | undefined;
    }>,
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
      return (
        options.promptResult ?? {
          stopReason: "complete",
          usage: { inputTokens: 6, outputTokens: 4 },
        }
      );
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
      return (
        options.streamUsage ?? { input: 0, output: 0, total: 0, cost: 0.25 }
      );
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
    buildDaemonEnv: (agent, daemonOptions) => {
      calls.daemonAgent = agent;
      calls.daemonOptions = daemonOptions;
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
    applyModel: async (_session, model, _log, options) => {
      calls.applyModelArgs.push({ model, options });
      return model ?? "resolved-model";
    },
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
    assert.deepEqual(result.messages, [
      { role: "assistant", content: "assistant output" },
    ]);
    assert.deepEqual(result.usage, {
      input: 6,
      output: 4,
      total: 10,
      cost: 0.25,
    });
    assert.equal(result.stopReason, "complete");
    assert.equal(result.sessionId, "session-1");
    assert.equal(result.model, "requested-model");
    assert.equal(result.traceId, "trace-1");
    assert.equal(result.capabilities?.streamingDeltas, false);
    assert.equal(calls.daemonAgent, "claude");
    assert.equal(calls.createSessionOptions.agent, "claude");
    assert.equal(calls.createSessionOptions.cwd, "/tmp/agenta-fake-cwd");
    assert.deepEqual(calls.promptBlocks, [{ type: "text", text: "hello" }]);
    assert.deepEqual(calls.runStart.messages, [
      { role: "user", content: "hello" },
    ]);
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
    assert.deepEqual(
      result.events?.filter((event) => event.type === "interaction_request"),
      [
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
      ],
    );
    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "always" },
    ]);
  });

  it("starts and stops the tool relay only when executable tools are present", async () => {
    const { calls, deps } = fakeHarness();

    // Pi delivers tools through its native extension (not the MCP bridge), so the relay path
    // is exercised on a Pi run. The MCP bridge is disabled in the sidecar (see the dedicated
    // test below), so a non-Pi harness can no longer take custom tools at all.
    const result = await runSandboxAgent(
      {
        harness: "pi_core",
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
      // Layer 3 (S3b): the resolved permission policy threaded into the relay. No
      // `permissionPolicy` on the request -> the headless default `auto`.
      "auto",
    ]);
    assert.equal(
      calls.toolRelayStops,
      2,
      "stopped after prompt and again in finally",
    );
  });

  it("fails a non-Pi run carrying custom tools because the MCP bridge is disabled", async () => {
    // Claude takes tools only over MCP, and the sidecar's stdio MCP bridge is disabled until
    // its security is fixed (parity with the removed code execution). So a Claude run with a
    // custom tool now surfaces the not-supported error instead of silently dropping or
    // unconfined-executing the tool.
    const { deps } = fakeHarness();

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

    assert.deepEqual(result, {
      ok: false,
      error: "MCP servers are not supported by the sidecar.",
    });
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

  it("passes the sandbox permission through to buildSandboxProvider", async () => {
    const { calls, deps } = fakeHarness();
    const sandboxPermission = {
      network: { mode: "allowlist" as const, allowlist: ["10.0.0.0/8"] },
      enforcement: "best_effort" as const,
    };

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sandbox: "daytona",
        prompt: "hello",
        sandboxPermission,
      },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    // sandboxId, env, binaryPath, piExtEnv, secrets, sandboxPermission
    assert.deepEqual(calls.providerArgs[5], sandboxPermission);
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

  it("clears inherited provider env on a managed run and applies ANTHROPIC_BASE_URL for claude", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        prompt: "hello",
        credentialMode: "env",
        secrets: { ANTHROPIC_API_KEY: "resolved" },
        endpoint: { baseUrl: "https://claude-gw.example/v1" },
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    // Managed run -> clear-then-apply: buildDaemonEnv is asked to clear the inherited provider env.
    assert.deepEqual(calls.daemonOptions, { clearProviderEnv: true });
    // The env handed to buildSandboxProvider carries only the resolved key + the custom base url.
    const env = calls.providerArgs[1] as Record<string, string>;
    assert.equal(env.ANTHROPIC_API_KEY, "resolved");
    assert.equal(env.ANTHROPIC_BASE_URL, "https://claude-gw.example/v1");
    assert.equal(env.ANTHROPIC_MODEL, undefined);
  });

  it("sets Claude Bedrock env and strict selected model pass-through", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        prompt: "hello",
        model: "anthropic.claude-x",
        deployment: "bedrock",
        credentialMode: "env",
        secrets: { AWS_ACCESS_KEY_ID: "AKIA" },
        endpoint: { region: "us-east-1" },
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    const env = calls.providerArgs[1] as Record<string, string>;
    assert.equal(env.CLAUDE_CODE_USE_BEDROCK, "1");
    assert.equal(env.AWS_ACCESS_KEY_ID, "AKIA");
    assert.equal(env.AWS_REGION, "us-east-1");
    assert.equal(env.ANTHROPIC_MODEL, "anthropic.claude-x");
    assert.equal(env.ANTHROPIC_CUSTOM_MODEL_OPTION, "anthropic.claude-x");
    assert.deepEqual(calls.applyModelArgs.at(-1), {
      model: "anthropic.claude-x",
      options: { strict: true },
    });
  });

  it("sets Claude Vertex env and selected model pass-through", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        prompt: "hello",
        model: "claude-sonnet-4",
        deployment: "vertex_ai",
        credentialMode: "env",
        secrets: {
          GOOGLE_CLOUD_PROJECT: "proj",
          GOOGLE_CLOUD_LOCATION: "us-central1",
        },
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    const env = calls.providerArgs[1] as Record<string, string>;
    assert.equal(env.CLAUDE_CODE_USE_VERTEX, "1");
    assert.equal(env.GOOGLE_CLOUD_PROJECT, "proj");
    assert.equal(env.ANTHROPIC_MODEL, "claude-sonnet-4");
  });

  it("does not clear provider env or set a base url on a runtime_provided run", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        prompt: "hello",
        credentialMode: "runtime_provided",
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    // runtime_provided -> keep the harness's own inherited env (do not clear).
    assert.deepEqual(calls.daemonOptions, { clearProviderEnv: false });
    const env = calls.providerArgs[1] as Record<string, string>;
    assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  });
});

// These exercise the engine's DEFAULT responder (HITLResponder) by dropping the
// `responderFactory` override the fake otherwise installs, so we test the real cross-turn
// wiring: headless parity, the park, and the resume.
describe("runSandboxAgent default HITL responder wiring", () => {
  function depsWithDefaultResponder() {
    const { calls, deps } = fakeHarness({ emitPermission: true });
    delete deps.responderFactory; // fall through to the engine's HITLResponder
    return { calls, deps };
  }

  it("headless (/invoke: no sessionId, no decisions) auto-allows — no regression", async () => {
    const { calls, deps } = depsWithDefaultResponder();

    const result = await runSandboxAgent(
      { harness: "claude", prompt: "edit the file" },
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    // Old PolicyResponder("auto") would have replied "always"; the default must match.
    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "always" },
    ]);
  });

  it("human surface (/messages: sessionId set) with no decision parks the tool (reject)", async () => {
    const { calls, deps } = depsWithDefaultResponder();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "conv-1",
        messages: [{ role: "user", content: "edit the file" }],
      },
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    // Park: decline the unapproved tool this turn (the interaction_request already prompted
    // the browser); the next turn carrying the decision resolves it.
    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "reject" },
    ]);
  });

  it("human surface with a stored approval resumes the tool (always)", async () => {
    const { calls, deps } = depsWithDefaultResponder();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "conv-1",
        messages: [
          { role: "user", content: "edit the file" },
          {
            // The cross-turn approval reply, keyed by the gated tool's name (cold replay
            // mints a fresh tool-call id "tool-1" each turn, so the name is the anchor).
            role: "tool",
            content: [
              {
                type: "tool_result",
                toolCallId: "tool-1",
                toolName: "edit",
                output: { approved: true },
              },
            ],
          },
          { role: "user", content: "continue" },
        ],
      },
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "always" },
    ]);
  });
});
