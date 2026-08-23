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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
 * enabled set. Daytona placement is under test (it is the cloud path, where the swallowed-error
 * reader goes through the sandbox's file API), so both suites need this in `beforeEach`.
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
  /** Abort a still-pending prompt, the shape a user-cancelled turn has. */
  cancel?: boolean;
  /**
   * The run's working directory. On a local run a Pi transcript is read from under it; on a
   * Daytona run it is the workspace path INSIDE the sandbox, which is the cwd Pi stamps on the
   * transcript it writes there, so a remote test must pass the same path it seeds the transcript
   * with or the reader will (correctly) disown it.
   */
  cwd?: string;
  /**
   * A Pi transcript the sandbox writes while the prompt runs, then serves at the reader's
   * contractual location: the file
   * `TRANSCRIPT_FILENAME` inside `piSessionWorkspaceDir(cwd)`. The fake honors the daemon
   * contract rather than answering promiscuously — `ls` lists only that directory (any other
   * directory fails the way a real `ls` does) and `readFsFile` serves only that exact path —
   * so a reader that lists the wrong directory or joins the path wrong fails here instead of
   * passing against a fake that serves everything.
   */
  sandboxTranscript?: string;
  /** A stale Pi transcript that already exists before this turn starts. */
  initialSandboxTranscript?: string;
  /** A Pi transcript written to the local workspace while the prompt runs. */
  localTranscript?: string;
}

/** One `runProcess` invocation the fake sandbox received, for pinning the daemon contract. */
export interface RecordedRunProcessCall {
  command?: string;
  args?: string[];
  timeoutMs?: number;
}

export interface SilentTurnRun {
  result: Awaited<ReturnType<typeof runSandboxAgent>>;
  /** Events the engine emitted live, in order — the stream the playground renders. */
  events: AgentEvent[];
  /** Every path read through the sandbox's daemon file API, in order. */
  readFsFilePaths: string[];
  /** Every process the sandbox was asked to run, in order (command, args, timeoutMs). */
  runProcessCalls: RecordedRunProcessCall[];
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
  const runProcessCalls: RecordedRunProcessCall[] = [];
  const store = new SessionContinuityStore();
  const events: AgentEvent[] = [];
  // A run without an explicit cwd still gets a private one. A fixed shared /tmp path would let a
  // stray Pi transcript left by any other run (or an earlier failed one) be picked up as this
  // turn's swallowed error — which would silently flip the empty-turn expectations and look
  // exactly like the fix landing. Cleaned up below, since only this call knows it owns it.
  const ownedCwd = options.cwd
    ? undefined
    : mkdtempSync(join(tmpdir(), "agenta-silent-turn-run-"));
  const cwd = options.cwd ?? (ownedCwd as string);

  let eventHandler: ((event: unknown) => void) | undefined;
  let permissionHandler: ((request: unknown) => void) | undefined;
  // A parked turn's prompt never settles on its own; the managed cancel resolves it, mirroring
  // what the sandbox-agent package does on `destroySession` (the same model `fakeHarness` in
  // `tests/unit/sandbox-agent-orchestration.test.ts` carries — keep the two in step).
  let resolveHungPrompt: ((value: unknown) => void) | undefined;
  const abortController = new AbortController();

  // Where the seeded transcript lives inside the fake sandbox: the same location the reader
  // derives from the run's cwd, so path agreement is part of what these runs pin.
  const remoteTranscriptDir = piSessionWorkspaceDir(cwd);
  const remoteTranscriptPath = join(remoteTranscriptDir, TRANSCRIPT_FILENAME);
  let remoteTranscript = options.initialSandboxTranscript;

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
      if (options.sandboxTranscript !== undefined)
        remoteTranscript = options.sandboxTranscript;
      if (options.localTranscript !== undefined) {
        mkdirSync(remoteTranscriptDir, { recursive: true });
        writeFileSync(remoteTranscriptPath, options.localTranscript);
      }
      for (const event of options.promptEvents ?? []) eventHandler?.(event);
      if (options.promptError) throw options.promptError;
      if (options.cancel) {
        queueMicrotask(() => abortController.abort());
        return new Promise((resolve) => {
          resolveHungPrompt = resolve;
        });
      }
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
    // Matches the real daemon contract, not a promiscuous fake:
    //  - Non-`ls` commands answer `exitCode: 0` so the Daytona bootstrap's `test -x <pinned pi>`
    //    succeeds (the image already has Pi baked in) — otherwise the run dies during setup and
    //    never reaches a turn.
    //  - `ls` answers on STDOUT, the way `sandboxRelayHost.list` reads it in `src/tools/relay.ts`
    //    (`String(ls?.stdout ?? "").split("\n")`), and honors its `args`: only the transcript
    //    directory exists, any other directory fails the way a real `ls` fails. Every call is
    //    recorded (command, args, timeoutMs) so tests can pin what the daemon was asked.
    async runProcess(input?: RecordedRunProcessCall) {
      runProcessCalls.push({ ...input });
      if (input?.command === "stat") {
        const path = input.args?.at(-1);
        if (path !== remoteTranscriptPath || remoteTranscript === undefined)
          return { exitCode: 1, stdout: "" };
        return {
          exitCode: 0,
          stdout: `${new TextEncoder().encode(remoteTranscript).length}\n`,
        };
      }
      if (input?.command !== "ls") return { exitCode: 0, stdout: "" };
      const dir = input.args?.at(-1);
      if (dir !== remoteTranscriptDir)
        return {
          exitCode: 2,
          stdout: "",
          stderr: `ls: cannot access '${dir}'`,
        };
      const listing = remoteTranscript ? `${TRANSCRIPT_FILENAME}\n` : "";
      return { exitCode: 0, stdout: listing };
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
    // Serves ONLY the seeded transcript at its exact path, like a real filesystem would.
    async readFsFile({ path }: { path: string }) {
      readFsFilePaths.push(path);
      const content =
        path === remoteTranscriptPath ? remoteTranscript : undefined;
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

  try {
    const result = await runSandboxAgent(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        sessionId: SESSION_ID,
        ...request,
      } as AgentRunRequest,
      (event) => events.push(event),
      options.cancel ? abortController.signal : undefined,
      deps,
    );

    return { result, events, readFsFilePaths, runProcessCalls, store };
  } finally {
    if (ownedCwd) rmSync(ownedCwd, { recursive: true, force: true });
  }
}

/**
 * Pi's transcript format, in ONE place.
 *
 * Every test that stands a Pi transcript up — here and in `sandbox-agent-pi-error.test.ts` —
 * encodes it through this, so a Pi schema change cannot leave two hand-rolled copies agreeing
 * with each other and both wrong about the format the reader parses.
 *
 * `recordCwd` overrides the cwd stamped on the `session` record, to simulate a stale or copied
 * transcript (the reader matches on it).
 */
export function piTranscript(
  cwd: string,
  name: string,
  messages: Array<Record<string, unknown>>,
  recordCwd: string = cwd,
): string {
  return (
    [
      JSON.stringify({ type: "session", version: 3, id: name, cwd: recordCwd }),
      ...messages.map((message) => JSON.stringify(message)),
    ].join("\n") + "\n"
  );
}

/** Write a transcript into `piSessionWorkspaceDir(cwd)`, flat, the way Pi does. */
export function writePiTranscript(
  cwd: string,
  name: string,
  messages: Array<Record<string, unknown>>,
  recordCwd: string = cwd,
): void {
  const dir = piSessionWorkspaceDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, piTranscriptFileName(name)),
    piTranscript(cwd, name, messages, recordCwd),
  );
}

/** Pi's persisted filename shape: timestamp followed by the session id. */
export function piTranscriptFileName(sessionId: string): string {
  return `2026-08-23T00-00-00-000Z_${sessionId}.jsonl`;
}

/** The one transcript these suites stand up; also what the fake sandbox's `ls` reports. */
const TRANSCRIPT_NAME = AGENT_SESSION_ID;
export const TRANSCRIPT_FILENAME = piTranscriptFileName(TRANSCRIPT_NAME);

/** The messages of a session whose last assistant turn failed with `message`. */
function failedTurnMessages(message: string): Array<Record<string, unknown>> {
  return [
    {
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: message,
      },
    },
  ];
}

/** A Pi session transcript whose last assistant turn failed with `message`. */
export function piTranscriptWithError(cwd: string, message: string): string {
  return piTranscript(cwd, TRANSCRIPT_NAME, failedTurnMessages(message));
}

/**
 * Write a failed Pi transcript into `cwd` where the reader looks for it — the local equivalent of
 * a sandbox whose harness died on a provider rejection.
 */
export function seedFailedTranscript(cwd: string, message: string): void {
  writePiTranscript(cwd, TRANSCRIPT_NAME, failedTurnMessages(message));
}
