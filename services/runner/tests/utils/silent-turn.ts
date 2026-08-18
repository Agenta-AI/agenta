/**
 * A fake harness for driving turns that produce NOTHING.
 *
 * The silent-failure class of bug (ASD-EST100) is defined by what a turn does NOT contain: no
 * assistant text, no error, no pause. Pinning it needs a harness whose turn output is exactly
 * what a test asks for, so `tests/unit/silent-turn-contract.test.ts` and
 * `tests/unit/daytona-transcript-recovery.test.ts` drive `runSandboxAgent` through this.
 *
 * Two choices matter, and both are deliberate:
 *
 * 1. It wires the REAL otel run (`createSandboxAgentOtel`), not a stub that returns a canned
 *    output string. Output has to be produced by streaming ACP updates, the way a harness
 *    produces it, or the tests would assert against a fixture instead of against the code that
 *    decides whether a turn was empty. It also means the banner stripper and the terminal `done`
 *    event are the real ones, so event ORDER can be asserted.
 * 2. The sandbox serves files through `readFsFile`, the same daemon file API the Daytona paths
 *    use (`usage.ts`, `pi-assets.ts`). That is what lets a test stand a Pi transcript up inside a
 *    remote sandbox without a live Daytona.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import type { RelayHost } from "../../src/tools/relay.ts";
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import {
  runSandboxAgent,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";
import { piSessionWorkspaceDir } from "../../src/engines/sandbox_agent/pi-assets.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";

/** The harness's native session id, which a completed turn records for continuity. */
export const AGENT_SESSION_ID = "agent-session-1";

/** Stands in for the tool relay's file host, which these runs never start. */
const unusedRelay = async (): Promise<never> => {
  throw new Error("the tool relay is not wired in silent-turn tests");
};
const unusedRelayHost: RelayHost = {
  list: unusedRelay,
  read: unusedRelay,
  write: unusedRelay,
  rename: unusedRelay,
  remove: unusedRelay,
};

/** The session id every run in these suites uses, so tests can read the continuity store. */
export const SESSION_ID = "session-under-test";

/** An ACP text delta, in the `{payload:{update}}` envelope `session.onEvent` delivers. */
export function textChunk(text: string): Record<string, unknown> {
  return {
    payload: {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  };
}

/** An ACP tool-call announcement, same envelope. */
export function toolCallChunk(
  toolCallId: string,
  title = "bash",
): Record<string, unknown> {
  return {
    payload: {
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title,
        status: "pending",
      },
    },
  };
}

/**
 * Enable the Daytona provider for a test, and drop the memoized config so the run plan reads the
 * enabled set. Daytona placement is under test (it is the cloud path, and the one where the
 * swallowed-error reader is switched off), so both suites need this in `beforeEach`.
 */
export function enableDaytonaProvider(): void {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
}

export interface SilentTurnOptions {
  /** ACP updates the harness streams before its prompt settles. Empty = a turn with no output. */
  promptEvents?: Array<Record<string, unknown>>;
  /** Make the prompt itself throw (the transport-failure path). */
  promptError?: Error;
  /** Raise a permission gate mid-prompt, then hang — the shape a parked turn has. */
  park?: boolean;
  /** The run's working directory; a local Pi transcript is read from under it. */
  cwd?: string;
  /**
   * A Pi transcript the sandbox serves for ANY `.jsonl` path. The in-sandbox transcript
   * directory is the reader's to choose, so a test pins that a transcript is read at all rather
   * than hard-coding a path the fix has not picked yet.
   */
  sandboxTranscript?: string;
}

export interface SilentTurnRun {
  result: Awaited<ReturnType<typeof runSandboxAgent>>;
  /** Events the engine emitted live, in order — the stream the playground renders. */
  events: AgentEvent[];
  /** Every path read through the sandbox's daemon file API, in order. */
  readFsFilePaths: string[];
  store: SessionContinuityStore;
}

/**
 * Run one turn against the fake harness and return the wire result plus the live event stream.
 *
 * `request` is merged over a minimal valid request, so a test names only what it is pinning
 * (harness, sandbox placement).
 */
export async function runSilentTurn(
  request: Partial<AgentRunRequest>,
  options: SilentTurnOptions = {},
): Promise<SilentTurnRun> {
  const readFsFilePaths: string[] = [];
  const store = new SessionContinuityStore();
  const events: AgentEvent[] = [];
  const cwd = options.cwd ?? "/tmp/agenta-silent-turn-cwd";

  let eventHandler: ((event: unknown) => void) | undefined;
  let permissionHandler: ((request: unknown) => void) | undefined;
  // A parked turn's prompt never settles on its own; the managed cancel resolves it, mirroring
  // what the sandbox-agent package does on `destroySession` (the same model `fakeHarness` in
  // `tests/unit/sandbox-agent-orchestration.test.ts` carries — keep the two in step).
  let resolveHungPrompt: ((value: unknown) => void) | undefined;

  const session = {
    id: "session-1",
    agentSessionId: AGENT_SESSION_ID,
    onEvent(handler: (event: unknown) => void) {
      eventHandler = handler;
    },
    onPermissionRequest(handler: (request: unknown) => void) {
      permissionHandler = handler;
    },
    async respondPermission() {},
    async prompt() {
      for (const event of options.promptEvents ?? []) eventHandler?.(event);
      if (options.promptError) throw options.promptError;
      if (options.park) {
        permissionHandler?.({
          id: "perm-1",
          availableReplies: ["once", "always", "reject"],
          toolCall: { toolCallId: "tool-1", name: "edit", title: "edit" },
        });
        return new Promise((resolve) => {
          resolveHungPrompt = resolve;
        });
      }
      return { stopReason: "end_turn" };
    },
  };

  const sandbox = {
    async mkdirFs() {},
    // `exitCode: 0` makes the Daytona bootstrap's `test -x <pinned pi>` succeed, i.e. the image
    // already has Pi baked in — otherwise the run dies during setup and never reaches a turn.
    async runProcess() {
      return { exitCode: 0 };
    },
    async writeFsFile() {},
    async deleteFsEntry() {},
    async createSession() {
      return session;
    },
    async destroySession() {
      resolveHungPrompt?.({ stopReason: "cancelled" });
    },
    async destroySandbox() {},
    async dispose() {},
    async readFsFile({ path }: { path: string }) {
      readFsFilePaths.push(path);
      const content = path.endsWith(".jsonl")
        ? options.sandboxTranscript
        : undefined;
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return new TextEncoder().encode(content);
    },
  };

  const deps: SandboxAgentDeps = {
    log: () => {},
    createLocalCwd: (durable?: string) => durable ?? cwd,
    createDaytonaCwd: (durable?: string) => durable ?? cwd,
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ provider: true }) as any,
    createPersist: () => ({}) as any,
    startSandboxAgent: (async () => sandbox) as any,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as any,
    probeCapabilities: async () => ({
      source: "probed",
      capabilities: {
        mcpTools: true,
        toolCalls: true,
        usage: true,
        streamingDeltas: true,
      },
    }),
    applyModel: async (_session, model) => model ?? "resolved-model",
    createOtel: createSandboxAgentOtel,
    startToolRelay: (() => ({ stop: async () => {} })) as any,
    // The relay never runs (`startToolRelay` is stubbed), so these only have to satisfy the
    // shape. An unreachable host is the honest stub: a test that starts depending on the relay
    // fails loudly here instead of quietly reading an empty directory.
    localRelayHost: () => unusedRelayHost,
    sandboxRelayHost: () => unusedRelayHost,
    responderFactory: () => ({
      async onPermission() {
        return { kind: options.park ? "pendingApproval" : "allow" } as const;
      },
      async onClientTool() {
        return { kind: "deny" } as const;
      },
    }),
    sessionContinuityStore: store,
  };

  const result = await runSandboxAgent(
    {
      harness: "pi_core",
      messages: [{ role: "user", content: "hello" }],
      sessionId: SESSION_ID,
      ...request,
    } as AgentRunRequest,
    (event) => events.push(event),
    undefined,
    deps,
  );

  return { result, events, readFsFilePaths, store };
}

/** A Pi session transcript whose last assistant turn failed with `message`. */
export function piTranscriptWithError(cwd: string, message: string): string {
  return (
    [
      JSON.stringify({ type: "session", version: 3, id: "sess-failed", cwd }),
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: message,
        },
      }),
    ].join("\n") + "\n"
  );
}

/**
 * Write a failed Pi transcript into `cwd` where the reader looks for it — the local equivalent of
 * a sandbox whose harness died on a provider rejection.
 */
export function seedFailedTranscript(cwd: string, message: string): void {
  const dir = piSessionWorkspaceDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "sess-failed.jsonl"),
    piTranscriptWithError(cwd, message),
  );
}
