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
  // Model Claude-over-ACP: the prompt NEVER resolves on its own after a permission gate. The
  // runner must end the turn another way (the park -> destroySession -> cancel path, F-040).
  hangPrompt?: boolean;
  // Make the managed cancel reject (and NOT resolve the hung prompt), so the only thing that
  // ends the turn is the local park signal — proves the run still terminates if cancel fails.
  destroySessionError?: Error;
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
    sessionDestroyed: 0,
    toolRelayArgs: undefined as unknown[] | undefined,
    toolRelayStops: 0,
    permissionReplies: [] as Array<{ id: string; reply: string }>,
    applyModelArgs: [] as Array<{
      model: string | undefined;
      options: { strict?: boolean } | undefined;
    }>,
    runFinished: 0,
    runFlushed: 0,
    recordedErrors: [] as Array<{ message: string; provider?: string }>,
  };
  const events: AgentEvent[] = [];
  let eventHandler: ((event: any) => void) | undefined;
  let permissionHandler: ((request: any) => void) | undefined;
  // The in-flight prompt resolver, so a `destroySession` (the managed cancel) can resolve a
  // hung prompt with a cancelled stop reason — mirroring the real sandbox-agent package.
  let resolveHungPrompt: ((value: any) => void) | undefined;

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
      if (options.hangPrompt) {
        // Claude does not end a turn on an unanswered gate: the prompt hangs until the
        // managed cancel (destroySession) resolves it with a cancelled stop reason.
        return new Promise((resolve) => {
          resolveHungPrompt = resolve;
        });
      }
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
    async destroySession(id: string) {
      calls.sessionDestroyed += 1;
      void id;
      if (options.destroySessionError) throw options.destroySessionError;
      // Managed cancel: resolve any in-flight prompt with a cancelled stop reason (the runner
      // races this against the park signal, so the turn ends either way). Mirrors the package.
      resolveHungPrompt?.({ stopReason: "cancelled" });
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
    recordError(message: string, provider?: string) {
      calls.recordedErrors.push({ message, provider });
    },
    output() {
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
        source: "probed",
        capabilities: {
          mcpTools: true,
          toolCalls: true,
          usage: true,
          streamingDeltas: true,
          ...(options.capabilities ?? {}),
        },
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
      async onClientTool() {
        return "deny" as const;
      },
    }),
  };

  return { calls, deps, events };
}

describe("runSandboxAgent orchestration", () => {
  it("returns a successful one-shot result and cleans up acquired resources", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        messages: [{ role: "user", content: "hello" }],
        model: "requested-model",
      },
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
      { harness: "claude", messages: [{ role: "user", content: "hello" }] },
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
      {
        harness: "claude",
        messages: [{ role: "user", content: "edit the file" }],
      },
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
    // allow -> once (per-call grant), never always: a turn-wide grant would skip re-gating.
    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "once" },
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
        messages: [{ role: "user", content: "use the tool" }],
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

  it("delivers a non-Pi run's gateway tools over the internal HTTP MCP channel", async () => {
    // Claude takes tools only over MCP. The INTERNAL gateway-tool channel (distinct from the
    // disabled USER stdio MCP path) is restored over a loopback HTTP MCP server the runner
    // serves, so a Claude run with a gateway tool now SUCCEEDS and the tool is advertised to the
    // harness. This is the #4831 regression fix (project gateway-tool-mcp): the run no longer
    // hard-fails with the user-facing MCP-unsupported error.
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        messages: [{ role: "user", content: "use the tool" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(
      result.ok,
      true,
      "the run succeeds; gateway tools reach Claude",
    );
    const mcpServers =
      calls.createSessionOptions?.sessionInit?.mcpServers ?? [];
    assert.equal(
      mcpServers.length,
      1,
      "one internal MCP server delivered to the session",
    );
    assert.equal(mcpServers[0].name, "agenta-tools");
    assert.equal(
      mcpServers[0].type,
      "http",
      "delivered over http, not a stdio child process",
    );
    assert.match(
      mcpServers[0].url,
      /^http:\/\/127\.0\.0\.1:\d+\/mcp$/,
      "loopback url",
    );
    assert.deepEqual(mcpServers[0].headers, [], "no credential on the channel");
    // The internal server is opened then released, so its port does not leak past the run.
    assert.equal(calls.sandboxDestroyed, 1, "sandbox disposed in finally");
  });

  it("still refuses a run carrying a USER stdio MCP server (user gate untouched)", async () => {
    // The user-facing stdio MCP path stays disabled (parity with removed code execution); only
    // the internal gateway-tool channel was restored. A user-declared stdio MCP server is still
    // rejected up front with the user-facing message.
    const { deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        messages: [{ role: "user", content: "go" }],
        mcpServers: [{ name: "github", transport: "stdio", command: "npx" }],
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

  it("fails loud when a non-Pi harness probes mcpTools:false but the run carries tools", async () => {
    // A7: the capability gate runs BEFORE the MCP bridge, so a harness whose probe reports it
    // cannot receive tools fails with a SPECIFIC capability error (not the generic MCP-disabled
    // line, and never a silent drop). This is the silent-degradation case the staff review
    // flagged: a wrong/missing `mcpTools` flag must error, not change behavior quietly.
    const { calls, deps } = fakeHarness({ capabilities: { mcpTools: false } });

    const result = await runSandboxAgent(
      {
        harness: "claude",
        messages: [{ role: "user", content: "use the tool" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error ?? "", /harness 'claude' cannot receive tools/);
    assert.match(result.error ?? "", /mcpTools:false/);
    // The gate fires before the session is created, so no session/prompt happened.
    assert.equal(calls.createSessionOptions, undefined);
    // The acquired sandbox is still disposed in the finally.
    assert.equal(calls.sandboxDestroyed, 1);
  });

  it("does not gate tool delivery for a Pi run even when mcpTools is false", async () => {
    // Pi delivers tools through its native extension, not MCP, so a Pi run with tools and a
    // `mcpTools:false` probe must proceed (the gate exempts Pi).
    const { calls, deps } = fakeHarness({ capabilities: { mcpTools: false } });

    const result = await runSandboxAgent(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "use the tool" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.notEqual(calls.createSessionOptions, undefined);
  });

  it("flushes a partial trace and cleans up on prompt errors", async () => {
    const { calls, deps } = fakeHarness({ promptError: new Error("boom") });

    const result = await runSandboxAgent(
      { harness: "claude", messages: [{ role: "user", content: "explode" }] },
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
        messages: [{ role: "user", content: "hello" }],
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
      { harness: "claude", messages: [{ role: "user", content: "hello" }] },
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
        messages: [{ role: "user", content: "hello" }],
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
    // Tool-Search is disabled for every claude run so the agenta-tools MCP tools keep their
    // inputSchema (deferral would strip it -> empty tool input). The SDK only treats the exact
    // string "false"/"0"/"no"/"off" as off, so it must be the string "false".
    assert.equal(env.ENABLE_TOOL_SEARCH, "false");
  });

  it("does not set ENABLE_TOOL_SEARCH for a non-claude (pi) run", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    const env = calls.providerArgs[1] as Record<string, string>;
    // The Tool-Search toggle is Claude-specific: a Pi run must not carry it.
    assert.equal(env.ENABLE_TOOL_SEARCH, undefined);
  });

  it("sets Claude Bedrock env and strict selected model pass-through", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        messages: [{ role: "user", content: "hello" }],
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
        messages: [{ role: "user", content: "hello" }],
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
        messages: [{ role: "user", content: "hello" }],
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
      {
        harness: "claude",
        messages: [{ role: "user", content: "edit the file" }],
      },
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    // Headless auto-allow gates each call individually, so once (this call) is equivalent to
    // the old always and strictly safer — no turn-wide grant that skips re-gating.
    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "once" },
    ]);
  });

  it("human surface (/messages: sessionId set) with no decision PARKS the tool, no harness reply (F-024)", async () => {
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
    // Park: the interaction_request IS emitted (the FE prompts the browser) ...
    assert.deepEqual(
      result.events
        ?.filter((e) => e.type === "interaction_request")
        .map((e) => ({
          type: e.type,
          id: (e as any).id,
        })),
      [{ type: "interaction_request", id: "perm-1" }],
    );
    // ... but the harness gets NO reply: a `reject` here would make Claude emit a failed tool
    // call that clobbers the approval prompt on the same tool-call id (F-024). The turn ends
    // with the tool pending; the next turn carrying the decision resolves it.
    assert.deepEqual(calls.permissionReplies, []);
  });

  it("park ENDS the turn even when the prompt hangs: terminal stopReason 'paused', no harness reply (F-040)", async () => {
    // The real regression: Claude does NOT end a turn on an unanswered gate, so without the
    // park->cancel path `session.prompt()` blocks forever and the run never returns. With
    // hangPrompt the fake prompt never resolves on its own; the run must still RETURN, driven
    // by the park signal + the managed cancel.
    const { calls, deps } = (() => {
      const { calls, deps } = fakeHarness({
        emitPermission: true,
        hangPrompt: true,
      });
      delete deps.responderFactory; // engine HITLResponder -> parks (human surface, no decision)
      return { calls, deps };
    })();

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
    if (!result.ok) return;
    // The turn returns terminal-but-incomplete: `paused` tells the egress to emit a clean
    // `finish` so the FE can resume on the user's decision (no immortal-park hang, F-040).
    assert.equal(result.stopReason, "paused");
    // No reply reached the harness (no F-024 clobber).
    assert.deepEqual(calls.permissionReplies, []);
    // The session was cancelled (managed `session/cancel` via destroySession) ...
    assert.equal(calls.sessionDestroyed, 1);
    // ... and the sandbox was disposed in the finally — the parked turn does NOT leak it.
    assert.equal(calls.sandboxDestroyed, 1);
    assert.equal(calls.sandboxDisposed, 1);
    assert.equal(calls.workspaceCleanup, 1);
  });

  it("park terminates even if the managed cancel rejects (local park signal still ends the turn)", async () => {
    // Defense in depth: if destroySession throws (the daemon already tore down, a network
    // blip, etc.) and the prompt never resolves, the local `parkedSignal` must STILL end the
    // turn so the run returns and the `finally` disposes the sandbox (no hang, no leak).
    const { calls, deps } = (() => {
      const { calls, deps } = fakeHarness({
        emitPermission: true,
        hangPrompt: true,
        destroySessionError: new Error("session already gone"),
      });
      delete deps.responderFactory;
      return { calls, deps };
    })();

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
    if (!result.ok) return;
    assert.equal(result.stopReason, "paused");
    assert.equal(calls.sessionDestroyed, 1, "cancel was attempted");
    // The turn still ended and the sandbox was disposed despite the failed cancel.
    assert.equal(calls.sandboxDestroyed, 1);
    assert.equal(calls.sandboxDisposed, 1);
  });

  it("human surface with a stored approval resumes the tool (once)", async () => {
    const { calls, deps } = depsWithDefaultResponder();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "conv-1",
        messages: [
          { role: "user", content: "edit the file" },
          {
            // The cross-turn approval reply. Cold replay mints a fresh tool-call id "tool-1"
            // each turn, so the anchor is the tool's name + args (here a no-arg edit -> {}).
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
    // Resumes via the name+args anchor, then grants ONCE (per call), not always.
    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "once" },
    ]);
  });
});
