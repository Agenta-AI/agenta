/**
 * An in-process harness host as `acquireEnvironment` builds it, with the real Pi agent loop, a
 * scripted model server and the local Daytona stand-in. For tests that exercise whole turns:
 * approvals, Stop, the silence watchdog and a runner restart.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionPersistDriver, type SessionEvent, type SessionPermissionRequest } from "sandbox-agent";
import type { InProcessLimits } from "../../src/engines/inprocess/harness-host.ts";
import { ConversationRegistry } from "../../src/engines/inprocess/conversation-registry.ts";
import { InProcessHarnessHost } from "../../src/engines/inprocess/harness-host.ts";
import { SessionLedger } from "../../src/engines/inprocess/session-ledger.ts";
import type { InProcessAcpSession } from "../../src/engines/inprocess/pi/acp-session.ts";
import { boundedDaytonaApi } from "../../src/engines/inprocess/sandbox/daytona-api.ts";
import type { InRunnerRunFacts } from "../../src/engines/sandbox_agent/runtime-contracts.ts";
import { sandboxSettings, TEST_DEADLINES, testOwner } from "./inprocess-workspace.ts";
import { LocalDaytona } from "./local-daytona.ts";
import { LinkMounter, memoryObjects, type ObjectFaults, TEST_CREDENTIALS, TEST_TRANSCRIPT_CREDENTIALS } from "./local-drive.ts";

export const TEST_INPROCESS_CONFIG: InProcessLimits & { maxSessions: number } = {
  maxSessions: 50,
  turnIdleTimeoutMs: 5_000,
  turnModelSilenceTimeoutMs: 5_000,
  fileToolMaxBytes: 1024 * 1024,
  transcriptSaveTimeoutMs: 1_000,
};

export interface HostFixture {
  base: string;
  cwd: string;
  agent: string;
  /** Where the runner keeps Pi's conversation files on its own disk: one subfolder per workspace instance. */
  transcripts: string;
  /** The drive's prefixes the runner writes through the store, by prefix. */
  objects: Map<string, Map<string, Buffer>>;
  /** Set to delay or fail the store's puts. */
  faults: ObjectFaults;
  daytona: LocalDaytona;
  mounter: LinkMounter;
  /** A runner process: its own registry and hosts. Call again to "restart" the runner. */
  runner(options?: { config?: Partial<typeof TEST_INPROCESS_CONFIG>; owner?: string; ledger?: SessionLedger; log?: (message: string) => void }): RunnerFixture;
}

export interface RunnerFixture {
  registry: ConversationRegistry;
  ledger: SessionLedger;
  host(options?: { persist?: InMemorySessionPersistDriver; gating?: boolean }): {
    host: InProcessHarnessHost;
    persist: InMemorySessionPersistDriver;
  };
}

export interface TurnCapture {
  events: Array<Record<string, unknown>>;
  permissions: SessionPermissionRequest[];
  text(): string;
}

/** Collect a session's ACP updates and permission requests. */
export function capture(session: InProcessAcpSession): TurnCapture {
  const events: Array<Record<string, unknown>> = [];
  const permissions: SessionPermissionRequest[] = [];
  session.onEvent((event: SessionEvent) => {
    const update = (event.payload as { params?: { update?: Record<string, unknown> } }).params?.update;
    if (update) events.push(update);
  });
  session.onPermissionRequest((request) => permissions.push(request));
  return {
    events,
    permissions,
    text: () =>
      events
        .filter((e) => e.sessionUpdate === "agent_message_chunk")
        .map((e) => String((e.content as { text?: string })?.text ?? ""))
        .join(""),
  };
}

export function createHostFixture(
  modelBaseUrl: string,
  options: {
    /** The run's skills on the runner's disk, and the snapshot folder Pi reads them from, relative to the session folder. */
    skills?: Array<{ name: string; dir: string }>;
    skillSnapshot?: string;
  } = {},
): HostFixture {
  const skills = options.skills ?? [];
  const base = mkdtempSync(join(tmpdir(), "inprocess-host-"));
  const cwd = join(base, "runner", "mounts", "conv");
  const agent = `${cwd}-agent`;
  const skillDir = options.skillSnapshot ? join(cwd, options.skillSnapshot) : undefined;
  const sessionDir = join(cwd, "agents", "sessions", "pi");
  const runAgentDir = join(base, "run-agent-dir");
  for (const dir of [sessionDir, agent, runAgentDir]) mkdirSync(dir, { recursive: true });
  symlinkSync(agent, join(cwd, "agent-files"));
  writeFileSync(
    join(runAgentDir, "models.json"),
    JSON.stringify({
      providers: { mock: { baseUrl: modelBaseUrl, api: "openai-completions", apiKey: "$OPENAI_API_KEY", models: [{ id: "mock-1" }] } },
    }),
  );
  const daytona = new LocalDaytona(join(base, "sandbox"));
  const mounter = new LinkMounter(daytona, daytona.prefix);
  // The drive's prefixes the runner writes through the store, shared by every runner of the fixture.
  const objects = new Map<string, Map<string, Buffer>>();
  const faults: ObjectFaults = {};
  const facts = (gating: boolean): InRunnerRunFacts => ({
    conversationId: "conv-1",
    projectId: "project-1",
    credentialMode: "env",
    systemPrompt: "You are a test agent.",
    appendSystemPrompt: undefined,
    sandboxEnvironment: {},
    network: { networkBlockAll: false },
    skillSources: skills,
    drives: [
      { root: cwd, credentials: () => TEST_CREDENTIALS },
      { root: agent, credentials: () => TEST_CREDENTIALS },
    ],
    signTranscriptMount: async () => TEST_TRANSCRIPT_CREDENTIALS,
    harnessEnv: { PI_CODING_AGENT_DIR: runAgentDir, PI_CODING_AGENT_SESSION_DIR: sessionDir, ...(skillDir ? { PI_CODING_AGENT_SKILL_DIR: skillDir } : {}) },
    extensionEnv: gating ? { AGENTA_AGENT_BUILTIN_GATING: "true" } : {},
    modelEnvironment: { OPENAI_API_KEY: "test-key" },
    customProvider: { providerId: "mock", keyEnv: "OPENAI_API_KEY" },
  });
  return {
    base,
    cwd,
    agent,
    transcripts: `${cwd}-pi-sessions`,
    objects,
    faults,
    daytona,
    mounter,
    runner: (options = {}) => {
      const registry = new ConversationRegistry(
        sandboxSettings(),
        boundedDaytonaApi(daytona, TEST_DEADLINES),
        testOwner(options.owner ?? "runner-a"),
        () => {},
        { sandboxPrefix: join(base, "sandbox"), mounter, objects: memoryObjects(objects, faults) },
      );
      const config = { ...TEST_INPROCESS_CONFIG, ...options.config };
      const ledger = options.ledger ?? new SessionLedger({ maxSessions: config.maxSessions, heapPressureRatio: 0.99 });
      const runtime = { registry, config, ledger, log: options.log ?? (() => {}) };
      return {
        registry,
        ledger,
        host: (hostOptions = {}) => {
          const persist = hostOptions.persist ?? new InMemorySessionPersistDriver();
          const host = new InProcessHarnessHost(runtime, facts(!!hostOptions.gating), persist);
          return { host, persist };
        },
      };
    },
  };
}
