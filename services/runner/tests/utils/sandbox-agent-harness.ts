/**
 * The fake sandbox, session and trace-run harness the run-turn-level tests compose the REAL
 * engine with.
 *
 * It stands in for TRANSPORT only — the sandbox handle, the ACP session, the trace run, and the
 * workspace — so `runSandboxAgent` still builds its own run plan, permission plan, responder,
 * relay guard and gateway gate exactly as production does. A test that injects those itself
 * proves nothing about the composition, which is why this harness lives here rather than inside
 * one test file: `sandbox-agent-orchestration.test.ts` and the gateway composition tests must
 * drive the same engine wiring.
 */
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import type { PermissionDecision } from "../../src/responder.ts";
import type { SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";

export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface FakeOptions {
  request?: Partial<AgentRunRequest>;
  cwd?: string;
  capabilities?: Record<string, unknown>;
  promptResult?: Record<string, unknown>;
  promptEvent?: Record<string, unknown>;
  promptEvents?: Array<Record<string, unknown>>;
  afterPromptEvents?: () => Promise<void> | void;
  postPermissionEvents?: Array<Record<string, unknown>>;
  // Runs after the permission gates AND their follow-on events, which is the only window in
  // which a test can act on a tool call the harness has both gated and opened. A gateway run
  // needs exactly that window: the ACP gate on the outer `run_tool` must have been answered
  // before the relay receives the call the gateway then parks.
  afterPromptGates?: () => Promise<void> | void;
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
  afterDestroySession?: () => Promise<void> | void;
}

export function fakeHarness(options: FakeOptions = {}) {
  const calls = {
    daemonAgent: "",
    daemonOptions: undefined as
      | { clearProviderEnv?: boolean; provider?: string; deployment?: string }
      | undefined,
    providerArgs: [] as unknown[],
    mkdirFsPaths: [] as string[],
    sandboxWrites: [] as Array<{ path: string; body: string }>,
    startOptions: undefined as any,
    createSessionOptions: undefined as any,
    promptBlocks: undefined as any,
    runStart: undefined as any,
    otelOptions: undefined as any,
    workspacePlan: undefined as any,
    workspacePiSkillSnapshot: undefined as any,
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
    deniedToolCallIds: [] as Array<string | undefined>,
    handledUpdates: [] as unknown[],
  };
  const events: AgentEvent[] = [];
  const logs: string[] = [];
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
      await options.afterPromptGates?.();
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
    async mkdirFs({ path }: { path: string }) {
      calls.mkdirFsPaths.push(path);
    },
    // Transport: a Daytona run uploads the in-sandbox MCP shim and its public tool specs before
    // it can advertise tools at all. Recorded rather than discarded, because what a run writes
    // INTO the sandbox is exactly what an in-sandbox process can read back.
    async writeFsFile({ path }: { path: string }, body: unknown) {
      calls.sandboxWrites.push({ path, body: String(body ?? "") });
    },
    async createSession(opts: any) {
      calls.createSessionOptions = opts;
      return session;
    },
    async destroySession(id: string) {
      calls.sessionDestroyed += 1;
      void id;
      if (options.destroySessionError) throw options.destroySessionError;
      await options.afterDestroySession?.();
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
    handleUpdate(update: any) {
      calls.handledUpdates.push(update);
    },
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
    // The live-resume reject path calls this WITHOUT optional chaining, so a stub that omits
    // it turns any test exercising a resume deny into a TypeError rather than an assertion.
    markToolCallDenied(toolCallId?: string) {
      calls.deniedToolCallIds.push(toolCallId);
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
    openToolCallIds() {
      return [];
    },
    traceId() {
      return "trace-1";
    },
  };

  const deps: SandboxAgentDeps = {
    log: (message) => logs.push(message),
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
    prepareWorkspace: (async ({ plan, piSkillSnapshot }: any) => {
      calls.workspacePlan = plan;
      calls.workspacePiSkillSnapshot = piSkillSnapshot;
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

  return { calls, deps, events, logs };
}
