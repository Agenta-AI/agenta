/**
 * Unit tests for sandbox-agent engine orchestration with fake sandbox/session handles.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-orchestration.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import {
  createSandboxAgentOtel,
  TOOL_NOT_EXECUTED_PAUSED,
} from "../../src/tracing/otel.ts";
import { PendingApprovalPauseController } from "../../src/engines/sandbox_agent/pause.ts";
import { buildPiGateEnvelope } from "../../src/engines/sandbox_agent/pi-gate-envelope.ts";
import { USER_MCP_UNSUPPORTED_MESSAGE } from "../../src/tools/mcp-bridge.ts";
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
  promptEvent?: Record<string, unknown>;
  promptEvents?: Array<Record<string, unknown>>;
  afterPromptEvents?: () => Promise<void> | void;
  postPermissionEvents?: Array<Record<string, unknown>>;
  streamUsage?: Record<string, number>;
  output?: string;
  promptError?: Error;
  permissionDecision?: PermissionDecision | "pendingApproval";
  emitPermission?: boolean;
  permissionToolCallId?: string;
  permissionToolName?: string;
  permissionRawInput?: unknown;
  permissionRequests?: Array<Record<string, unknown>>;
  // Model Claude-over-ACP: the prompt NEVER resolves on its own after a permission gate. The
  // runner must end the turn another way (the park -> destroySession -> cancel path, F-040).
  hangPrompt?: boolean;
  // Make the managed cancel reject (and NOT resolve the hung prompt), so the only thing that
  // ends the turn is the local park signal — proves the run still terminates if cancel fails.
  destroySessionError?: Error;
  // Mirrors what the real sandbox-agent package does when the caller's AbortSignal fires mid-
  // prompt: resolve the in-flight prompt with a cancelled stop reason. Lets a hung-prompt fixture
  // stand in for a wedged harness that a run-limits deadline (which aborts `startOptions.signal`)
  // must be able to unstick.
  abortSignalCancelsHungPrompt?: boolean;
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
      const promptEvents = options.promptEvents ?? [
        options.promptEvent ?? { payload: { update: { kind: "noop" } } },
      ];
      for (const event of promptEvents) eventHandler?.(event);
      await options.afterPromptEvents?.();
      if (options.emitPermission) {
        const permissionRequests = options.permissionRequests ?? [
          {
            id: "perm-1",
            availableReplies: ["once", "always", "reject"],
            toolCall: {
              toolCallId: options.permissionToolCallId ?? "tool-1",
              name: options.permissionToolName ?? "edit",
              title: options.permissionToolName ?? "edit",
              rawInput: options.permissionRawInput,
              input: options.permissionRawInput,
            },
          },
        ];
        for (const request of permissionRequests) permissionHandler?.(request);
      }
      if (options.postPermissionEvents?.length) {
        if (options.emitPermission) await flushPromises();
        for (const event of options.postPermissionEvents) eventHandler?.(event);
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
    settleOpenToolCalls(
      _isExcluded: (id: string) => boolean,
      _message: string,
    ) {},
    traceId() {
      return "trace-1";
    },
  };

  const deps: SandboxAgentDeps = {
    log: () => {},
    createLocalCwd: (durable?: string) =>
      durable ?? options.cwd ?? "/tmp/agenta-fake-cwd",
    createDaytonaCwd: (durable?: string) =>
      durable ?? "/home/sandbox/agenta-fake-cwd",
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
      if (options.abortSignalCancelsHungPrompt && opts.signal) {
        opts.signal.addEventListener("abort", () => {
          resolveHungPrompt?.({ stopReason: "cancelled" });
        });
      }
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
        return { kind: options.permissionDecision ?? "allow" } as const;
      },
      async onClientTool() {
        return { kind: "deny" } as const;
      },
    }),
  };

  return { calls, deps, events };
}

describe("PendingApprovalPauseController", () => {
  it("tracks paused tool-call ids", () => {
    const pause = new PendingApprovalPauseController(() => {});

    assert.equal(pause.isPausedToolCall(undefined), false);
    assert.equal(pause.isPausedToolCall("tool-1"), false);

    pause.markPausedToolCall("tool-1");

    assert.equal(pause.isPausedToolCall("tool-1"), true);
    assert.equal(pause.isPausedToolCall("tool-2"), false);
  });
});

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

  it("re-signs, remounts, and retries local workspace prep on durable cwd ENOTCONN", async () => {
    const { calls, deps } = fakeHarness();
    const seenMountAccessKeys: string[] = [];
    let signCalls = 0;
    let mountCalls = 0;
    let workspaceCalls = 0;
    let mountCallsBeforeFirstWorkspace = 0;
    let cleanupCalls = 0;

    deps.signSessionMountCredentials = (async () => {
      signCalls += 1;
      return {
        endpoint: "http://seaweedfs:8333",
        region: "us-east-1",
        bucket: "agenta-store",
        prefix: "mounts/proj-1/mount-1",
        accessKey: `AK-${signCalls}`,
        secretKey: `SK-${signCalls}`,
        sessionToken: `TOK-${signCalls}`,
      };
    }) as any;
    deps.mountStorage = (async (_cwd: string, creds: any) => {
      mountCalls += 1;
      seenMountAccessKeys.push(creds.accessKey);
      return true;
    }) as any;
    deps.unmountStorage = (async () => true) as any;
    deps.prepareWorkspace = (async ({ plan }: any) => {
      workspaceCalls += 1;
      if (workspaceCalls === 1) {
        mountCallsBeforeFirstWorkspace = mountCalls;
        const err = new Error("ENOTCONN: Transport endpoint is not connected");
        (err as Error & { code?: string }).code = "ENOTCONN";
        throw err;
      }
      calls.workspacePlan = plan;
      return {
        cleanup: async () => {
          cleanupCalls += 1;
        },
      };
    }) as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "sess-1",
        telemetry: {
          exporters: {
            otlp: {
              headers: { authorization: "ApiKey run" },
            },
          },
        },
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(signCalls, 2, "initial sign + re-sign after ENOTCONN");
    assert.equal(mountCalls, 2, "initial mount + remount after ENOTCONN");
    assert.deepEqual(seenMountAccessKeys, ["AK-1", "AK-2"]);
    assert.equal(
      mountCallsBeforeFirstWorkspace,
      1,
      "local durable cwd is mounted before first workspace write",
    );
    assert.equal(workspaceCalls, 2, "workspace prep is retried once");
    assert.equal(
      calls.createSessionOptions.cwd,
      "/tmp/agenta/mounts/proj-1/mount-1",
    );
    assert.equal(cleanupCalls, 1);
  });

  it("re-signs and remounts when an ACP event reports durable cwd ENOTCONN during prompt", async () => {
    const { deps } = fakeHarness({
      promptEvents: [
        {
          payload: {
            update: {
              kind: "tool_result",
              content:
                "realpath '/tmp/agenta/mounts/proj-1/mount-1/.restore_test': Transport endpoint is not connected",
            },
          },
        },
        {
          payload: {
            update: {
              kind: "tool_result",
              content:
                "realpath '/tmp/agenta/mounts/proj-1/mount-1/README.md': ENOTCONN",
            },
          },
        },
      ],
    });
    const seenMountAccessKeys: string[] = [];
    let signCalls = 0;
    let mountCalls = 0;
    let unmountCalls = 0;

    deps.signSessionMountCredentials = (async () => {
      signCalls += 1;
      return {
        endpoint: "http://seaweedfs:8333",
        region: "us-east-1",
        bucket: "agenta-store",
        prefix: "mounts/proj-1/mount-1",
        accessKey: `AK-${signCalls}`,
        secretKey: `SK-${signCalls}`,
        sessionToken: `TOK-${signCalls}`,
      };
    }) as any;
    deps.mountStorage = (async (_cwd: string, creds: any) => {
      mountCalls += 1;
      seenMountAccessKeys.push(creds.accessKey);
      return true;
    }) as any;
    deps.unmountStorage = (async () => {
      unmountCalls += 1;
    }) as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "sess-1",
        telemetry: {
          exporters: {
            otlp: {
              headers: { authorization: "ApiKey run" },
            },
          },
        },
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(
      signCalls,
      2,
      "initial sign + one capped runtime re-sign after ENOTCONN",
    );
    assert.equal(
      mountCalls,
      2,
      "initial mount + one capped runtime remount after ENOTCONN",
    );
    assert.deepEqual(seenMountAccessKeys, ["AK-1", "AK-2"]);
    assert.equal(
      unmountCalls,
      1,
      "cleanup waits for runtime remount before unmount",
    );
  });

  it("skips the durable cwd delete when unmount is not confirmed", async () => {
    // A failed/still-mounted unmount must never be followed by rmSync on the cwd — that would
    // delete through a possibly-live FUSE mount into the durable store.
    const { calls, deps } = fakeHarness();
    deps.signSessionMountCredentials = (async () => ({
      endpoint: "http://seaweedfs:8333",
      region: "us-east-1",
      bucket: "agenta-store",
      prefix: "mounts/proj-1/mount-1",
      accessKey: "AK-1",
      secretKey: "SK-1",
    })) as any;
    deps.mountStorage = (async () => true) as any;
    // Simulate an unconfirmed unmount (still mounted after the detach attempt).
    deps.unmountStorage = (async () => false) as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "sess-1",
        telemetry: {
          exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
        },
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(
      calls.workspaceCleanup,
      0,
      "cwd delete is skipped when unmount is not confirmed",
    );
  });

  it("still deletes the cwd once unmount is confirmed gone", async () => {
    const { calls, deps } = fakeHarness();
    deps.signSessionMountCredentials = (async () => ({
      endpoint: "http://seaweedfs:8333",
      region: "us-east-1",
      bucket: "agenta-store",
      prefix: "mounts/proj-1/mount-1",
      accessKey: "AK-1",
      secretKey: "SK-1",
    })) as any;
    deps.mountStorage = (async () => true) as any;
    deps.unmountStorage = (async () => true) as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "sess-1",
        telemetry: {
          exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
        },
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(
      calls.workspaceCleanup,
      1,
      "cwd delete proceeds once unmount is confirmed",
    );
  });

  it("Daytona mounts the durable cwd before workspace materialization", async () => {
    const { calls, deps } = fakeHarness();
    let mountCallsBeforeWorkspace = 0;
    deps.signSessionMountCredentials = (async () => ({
      endpoint: "http://seaweedfs:8333",
      region: "us-east-1",
      bucket: "agenta-store",
      prefix: "mounts/proj-1/mount-1",
      accessKey: "AK-1",
      secretKey: "SK-1",
    })) as any;
    deps.discoverTunnelEndpoint = (async () => "https://tunnel.example") as any;
    let mountCalls = 0;
    deps.mountStorageRemote = (async () => {
      mountCalls += 1;
      return true;
    }) as any;
    deps.prepareWorkspace = (async ({ plan }: any) => {
      mountCallsBeforeWorkspace = mountCalls;
      calls.workspacePlan = plan;
      return { cleanup: async () => {} };
    }) as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sandbox: "daytona",
        sessionId: "sess-1",
        telemetry: {
          exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
        },
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(mountCalls, 1, "remote mount is attempted");
    assert.equal(
      mountCallsBeforeWorkspace,
      1,
      "the durable cwd is mounted before workspace materialization writes into it",
    );
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
      [],
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
    assert.deepEqual(calls.toolRelayArgs?.slice(0, 4), [
      "local-relay-host",
      // Relay scratch lives off the geesefs mount: host tmpdir/agenta/relay/<cwd basename>.
      join(tmpdir(), "agenta", "relay", "agenta-fake-cwd"),
      [{ name: "server_tool", kind: "callback" }],
      undefined,
    ]);
    // The relay carries execution only (no permissions argument): no runContext here.
    assert.equal(calls.toolRelayArgs?.[4], undefined);
    // Trailing arg is the relay callbacks object (client-tool + park handlers).
    assert.deepEqual(
      Object.keys((calls.toolRelayArgs?.[5] ?? {}) as object).sort(),
      ["onClientTool", "onPause"],
    );
    // A Pi run passes the execution guard: the relay dir is sandbox-writable, so every execute
    // record is re-checked runner-side (a forged record must not run an ask/deny tool).
    assert.equal(typeof calls.toolRelayArgs?.[6], "function");
    // The 8th argument carries the log sink: without it the relay skips pickup
    // telemetry (and its per-request stat) entirely, so the engine must pass one.
    assert.equal(
      typeof (calls.toolRelayArgs?.[7] as { log?: unknown } | undefined)?.log,
      "function",
    );
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
    // The relay dir is sandbox-writable on every harness, so a Claude run gets the execution
    // guard too — its non-Pi shape enforces the hard deny boundary against forged records
    // while `ask` stays with Claude's own harness dialog (see buildRelayExecutionGuard; the
    // non-Pi semantics are pinned in tool-relay-guard.test.ts).
    assert.equal(typeof calls.toolRelayArgs?.[6], "function");
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
      error: USER_MCP_UNSUPPORTED_MESSAGE,
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

  // A throw from otel.finish() in the error path must not mask the real run error.
  it("still returns the run error when otel.finish() throws in the error path", async () => {
    const { calls, deps } = fakeHarness({ promptError: new Error("boom") });
    deps.createOtel = ((otelOptions: any) => {
      calls.otelOptions = otelOptions;
      return {
        start() {},
        handleUpdate() {},
        emitEvent(event: AgentEvent) {
          void event;
        },
        usage() {
          return { input: 0, output: 0, total: 0, cost: 0 };
        },
        setUsage() {},
        finish() {
          calls.runFinished += 1;
          throw new Error("tracing finish blew up");
        },
        recordError(message: string, provider?: string) {
          calls.recordedErrors.push({ message, provider });
        },
        output() {
          return "";
        },
        async flush() {
          calls.runFlushed += 1;
        },
        events() {
          return [];
        },
        settleOpenToolCalls() {},
        traceId() {
          return "trace-1";
        },
      };
    }) as any;

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
    // The signal handed to the harness is merged with the run-limits deadline signal
    // (AbortSignal.any), so it is no longer the identical object — but aborting the caller's
    // controller must still abort the merged signal the harness observes.
    assert.equal(calls.startOptions.signal.aborted, false);
    controller.abort();
    assert.equal(calls.startOptions.signal.aborted, true);
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

  it("never puts the OTLP bearer in the local Pi daemon's env", async () => {
    const { calls, deps } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        telemetry: {
          exporters: {
            otlp: {
              endpoint: "https://otlp.example.test/v1/traces",
              headers: { authorization: "Bearer reusable-caller-token" },
            },
          },
        },
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    const env = calls.providerArgs[1] as Record<string, string>;
    // The harness-readable env carries a file path, never the bearer itself.
    assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, undefined);
    assert.equal(typeof env.AGENTA_AGENT_OTLP_AUTH_FILE, "string");
    assert.equal(JSON.stringify(env).includes("reusable-caller-token"), false);
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

// These exercise the engine's default ApprovalResponder by dropping the `responderFactory`
// override the fake otherwise installs, so we test the real allow, pause, and resume wiring.
describe("runSandboxAgent default ApprovalResponder wiring", () => {
  function depsWithDefaultResponder() {
    const { calls, deps } = fakeHarness({ emitPermission: true });
    delete deps.responderFactory; // fall through to the engine's ApprovalResponder
    return { calls, deps };
  }

  it("absent permissions use allow_reads and pause an unrated gate", async () => {
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
    if (!result.ok) return;
    assert.equal(result.stopReason, "paused");
    assert.deepEqual(calls.permissionReplies, []);
  });

  it("effective ask with no decision pauses the tool, no harness reply (F-024)", async () => {
    const { calls, deps } = depsWithDefaultResponder();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "conv-1",
        permissions: { default: "ask" },
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

  it("settles serialized write-tool sibling calls before pause teardown", async () => {
    const { deps } = fakeHarness({
      promptEvents: [
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-a",
              title: "commit_revision",
              rawInput: { revision: "r1" },
            },
          },
        },
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-b",
              title: "create_subscription",
              rawInput: { plan: "pro" },
            },
          },
        },
      ],
      emitPermission: true,
      permissionToolCallId: "tool-a",
      permissionToolName: "commit_revision",
      permissionRawInput: { revision: "r1" },
      hangPrompt: true,
    });
    delete deps.responderFactory;
    deps.createOtel = createSandboxAgentOtel as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        permissions: { default: "ask" },
        messages: [{ role: "user", content: "commit and subscribe" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stopReason, "paused");

    const interactions = result.events?.filter(
      (event) => event.type === "interaction_request",
    );
    assert.equal(interactions?.length, 1);
    assert.equal((interactions?.[0] as any).payload?.toolCallId, "tool-a");

    const toolResults = result.events
      ?.filter((event) => event.type === "tool_result")
      .map((event) => ({
        id: (event as any).id,
        output: (event as any).output,
        isError: (event as any).isError,
      }));
    assert.deepEqual(toolResults, [
      {
        id: "tool-b",
        output: TOOL_NOT_EXECUTED_PAUSED,
        isError: true,
      },
    ]);
    assert.equal(
      toolResults?.some((event) => event.id === "tool-a"),
      false,
    );
  });

  it("settles a latch-loser sibling when read-only permission requests race", async () => {
    const readOnlySpec = (name: string) => ({
      name,
      kind: "callback",
      readOnly: true,
      permission: "ask",
    });
    const { deps } = fakeHarness({
      promptEvents: [
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-a",
              title: "read_alpha",
              rawInput: { path: "a" },
            },
          },
        },
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-b",
              title: "read_beta",
              rawInput: { path: "b" },
            },
          },
        },
      ],
      emitPermission: true,
      permissionRequests: [
        {
          id: "perm-a",
          availableReplies: ["once", "always", "reject"],
          toolCall: {
            toolCallId: "tool-a",
            name: "read_alpha",
            title: "read_alpha",
            rawInput: { path: "a" },
            input: { path: "a" },
            spec: readOnlySpec("read_alpha"),
          },
        },
        {
          id: "perm-b",
          availableReplies: ["once", "always", "reject"],
          toolCall: {
            toolCallId: "tool-b",
            name: "read_beta",
            title: "read_beta",
            rawInput: { path: "b" },
            input: { path: "b" },
            spec: readOnlySpec("read_beta"),
          },
        },
      ],
      hangPrompt: true,
    });
    delete deps.responderFactory;
    deps.createOtel = createSandboxAgentOtel as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        permissions: { default: "ask" },
        messages: [{ role: "user", content: "read both" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stopReason, "paused");

    const interactions = result.events?.filter(
      (event) => event.type === "interaction_request",
    );
    assert.equal(interactions?.length, 1);
    assert.equal((interactions?.[0] as any).payload?.toolCallId, "tool-a");

    const toolResults = result.events
      ?.filter((event) => event.type === "tool_result")
      .map((event) => ({
        id: (event as any).id,
        output: (event as any).output,
        isError: (event as any).isError,
      }));
    assert.deepEqual(toolResults, [
      {
        id: "tool-b",
        output: TOOL_NOT_EXECUTED_PAUSED,
        isError: true,
      },
    ]);
  });

  it("settles a sibling whose announcement arrives AFTER the pause (teardown race)", async () => {
    // The live incident shape: the sibling's `tool_call` announcement rides the ACP event
    // stream and can arrive at the runner AFTER the gate won the latch and the pause-time
    // sweep already ran. The event-handler re-sweep must settle it deterministically.
    const { deps } = fakeHarness({
      promptEvents: [
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-a",
              title: "commit_revision",
              rawInput: { revision: "r1" },
            },
          },
        },
      ],
      emitPermission: true,
      permissionToolCallId: "tool-a",
      permissionToolName: "commit_revision",
      permissionRawInput: { revision: "r1" },
      // Announced only after the permission gate fired (and the pause ran its sweep).
      postPermissionEvents: [
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-late",
              title: "request_connection",
              rawInput: { integration: "slack" },
            },
          },
        },
      ],
      hangPrompt: true,
    });
    delete deps.responderFactory;
    deps.createOtel = createSandboxAgentOtel as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        permissions: { default: "ask" },
        messages: [{ role: "user", content: "commit and connect" }],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stopReason, "paused");
    const toolResults = result.events
      ?.filter((event) => event.type === "tool_result")
      .map((event) => ({
        id: (event as any).id,
        output: (event as any).output,
        isError: (event as any).isError,
      }));
    assert.deepEqual(toolResults, [
      {
        id: "tool-late",
        output: TOOL_NOT_EXECUTED_PAUSED,
        isError: true,
      },
    ]);
  });

  it("emits the deferred sibling result before the paused turn is done", async () => {
    const emitted: AgentEvent[] = [];
    const { deps } = fakeHarness({
      promptEvents: [
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-a",
              title: "commit_revision",
              rawInput: { revision: "r1" },
            },
          },
        },
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-b",
              title: "create_subscription",
              rawInput: { plan: "pro" },
            },
          },
        },
      ],
      emitPermission: true,
      permissionToolCallId: "tool-a",
      permissionToolName: "commit_revision",
      permissionRawInput: { revision: "r1" },
      hangPrompt: true,
    });
    delete deps.responderFactory;
    deps.createOtel = createSandboxAgentOtel as any;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        permissions: { default: "ask" },
        messages: [{ role: "user", content: "commit and subscribe" }],
      } as AgentRunRequest,
      (event) => emitted.push(event),
      undefined,
      deps,
    );
    await flushPromises();

    assert.equal(result.ok, true);
    const interactionIndex = emitted.findIndex(
      (event) => event.type === "interaction_request",
    );
    const siblingResultIndex = emitted.findIndex(
      (event) => event.type === "tool_result" && (event as any).id === "tool-b",
    );
    const doneIndex = emitted.findIndex((event) => event.type === "done");

    assert.notEqual(interactionIndex, -1, "approval request is emitted");
    assert.notEqual(siblingResultIndex, -1, "sibling result is emitted");
    assert.notEqual(doneIndex, -1, "done is emitted");
    assert.ok(
      interactionIndex < siblingResultIndex,
      "approval request is emitted before the teardown sweep runs",
    );
    assert.ok(
      siblingResultIndex < doneIndex,
      "sibling result reaches the live sink before turn finish",
    );
  });

  it("drops teardown tool updates after a Pi approval pause while keeping other ids", async () => {
    // The Pi ask arrives as an ACP permission request carrying the gate envelope (the dialog
    // plane); the pause must suppress the GATED call's teardown updates while the sibling is
    // settled deterministically.
    const { deps } = fakeHarness({
      promptEvents: [
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-1",
              title: "approval_needed",
            },
          },
        },
        {
          payload: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-2",
              title: "other_tool",
            },
          },
        },
      ],
      emitPermission: true,
      permissionDecision: "pendingApproval",
      permissionRequests: [
        {
          id: "perm-pi",
          availableReplies: ["once", "reject"],
          toolCall: {
            toolCallId: "pi-ui-synthetic",
            title: "agenta-approval",
            rawInput: {
              method: "confirm",
              title: "agenta-approval",
              message: buildPiGateEnvelope({
                gate: "pi-custom-tool",
                toolName: "approval_needed",
                toolCallId: "tool-1",
                input: { path: "a" },
              }),
            },
          },
        },
      ],
      postPermissionEvents: [
        {
          payload: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-1",
              status: "failed",
              content: [{ content: { type: "text", text: "aborted" } }],
            },
          },
        },
        {
          payload: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-2",
              status: "failed",
              content: [{ content: { type: "text", text: "other failed" } }],
            },
          },
        },
      ],
    });
    deps.createOtel = createSandboxAgentOtel as any;

    const result = await runSandboxAgent(
      {
        harness: "pi_core",
        permissions: { default: "ask" },
        messages: [{ role: "user", content: "use the tool" }],
        customTools: [
          { name: "approval_needed", kind: "callback", permission: "ask" },
        ],
      } as AgentRunRequest,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.stopReason, "paused");
    assert.deepEqual(
      result.events
        ?.filter((event) => event.type === "interaction_request")
        .map((event) => ({
          id: (event as any).id,
          kind: (event as any).kind,
          toolCallId: (event as any).payload?.toolCallId,
        })),
      [{ id: "perm-pi", kind: "user_approval", toolCallId: "tool-1" }],
    );
    assert.deepEqual(
      result.events
        ?.filter((event) => event.type === "tool_result")
        .map((event) => ({
          id: (event as any).id,
          output: (event as any).output,
          isError: (event as any).isError,
        })),
      [{ id: "tool-2", output: TOOL_NOT_EXECUTED_PAUSED, isError: true }],
    );
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
      delete deps.responderFactory; // engine ApprovalResponder -> pauses (effective ask, no decision)
      return { calls, deps };
    })();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "conv-1",
        permissions: { default: "ask" },
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
        permissions: { default: "ask" },
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
        permissions: { default: "ask" },
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
describe("runTurn run-limits deadline (split path)", () => {
  // Tiny real-ms limits injected through the run-limits DI seam: the integration path exercises
  // the real createRunLimits (timers + trip wiring), so the windows are a few ms and driven by
  // real timers. TTFB (5ms) is the shortest, so a silent harness trips it first.
  const fastLimits = {
    resolveRunLimits: () => ({
      totalMs: 50,
      idleMs: 50,
      ttfbMs: 5,
      toolCallMs: 50,
    }),
  };

  it("ends a wedged never-responding turn as an error so the finally reclaims the sandbox", async () => {
    // The harness comes up but the prompt never resolves on its own — a wedged run. With no
    // deadline it would hold the sandbox forever; the tripped TTFB limit must end the turn.
    const { calls, deps } = fakeHarness({ hangPrompt: true });

    const result = await runSandboxAgent(
      { harness: "claude", messages: [{ role: "user", content: "hello" }] },
      undefined,
      undefined,
      { ...deps, ...fastLimits },
    );

    // The run RETURNED (did not hang) as a failure, and the teardown finally reclaimed the sandbox.
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error ?? "", /first response|deadline|idle|run limit/i);
    assert.equal(calls.sandboxDestroyed, 1);
    assert.equal(calls.sandboxDisposed, 1);
  });

  it("does NOT trip a turn that paused for human input, even past every deadline window", async () => {
    // A gated tool call parks the turn (pause path), which retires the deadlines via notePaused.
    // With tiny limits a wedged turn WOULD trip almost immediately — so a clean `paused` finish
    // (never a deadline error) proves the pause exemption held. The prompt hangs; only the local
    // park signal ends the turn. Setup mirrors the F-040 park test (real ApprovalResponder).
    const { calls, deps } = (() => {
      const { calls, deps } = fakeHarness({
        emitPermission: true,
        hangPrompt: true,
      });
      delete deps.responderFactory; // engine ApprovalResponder -> pauses (ask, no stored decision)
      return { calls, deps };
    })();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        sessionId: "conv-paused",
        permissions: { default: "ask" },
        messages: [{ role: "user", content: "edit the file" }],
      },
      undefined,
      undefined,
      { ...deps, ...fastLimits },
    );
    await flushPromises();

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Paused, not a deadline error: the pause path — not a tripped limit — ended the turn.
    assert.equal(result.stopReason, "paused");
    assert.equal(calls.sandboxDestroyed, 1);
  });
});
