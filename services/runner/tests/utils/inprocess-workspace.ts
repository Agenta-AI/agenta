/**
 * A conversation workspace wired to the local Daytona stand-in: runner folders on this machine
 * (the drive), a "sandbox" folder beside them that mounts the drive by a link, and the real
 * change order, mount and command code in between.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationRegistry } from "../../src/engines/inprocess/conversation-registry.ts";
import type { SandboxOwner } from "../../src/engines/inprocess/sandbox/sandbox-owner.ts";
import type { CommandResult, ConversationWorkspace } from "../../src/engines/inprocess/conversation-workspace.ts";
import type { CommandSandboxSettings, SandboxRequirements } from "../../src/engines/inprocess/sandbox/command-sandbox.ts";
import { boundedDaytonaApi, type DaytonaDeadlines } from "../../src/engines/inprocess/sandbox/daytona-api.ts";
import type { OutputTotals } from "../../src/engines/inprocess/sandbox/remote-command.ts";
import { LocalDaytona } from "./local-daytona.ts";
import { LinkMounter, memoryObjects, TEST_CREDENTIALS, TEST_TRANSCRIPT_CREDENTIALS } from "./local-drive.ts";

/** Short deadlines, so a call that never answers fails a test in seconds, not minutes. */
export const TEST_DEADLINES: DaytonaDeadlines = { controlMs: 1_500, startMs: 5_000, transferMs: 10_000 };

export const OPEN_NETWORK: SandboxRequirements = { network: { networkBlockAll: false }, environment: {} };

export function sandboxSettings(overrides: Partial<CommandSandboxSettings> = {}): CommandSandboxSettings {
  return {
    snapshot: "test-snapshot",
    labels: { "agenta.provider": "inprocess" },
    idleStopMs: 60_000,
    autoStopMinutes: 15,
    autoDeleteMinutes: 120,
    fingerprintKey: "test-key",
    ...overrides,
  };
}

/** One test runner process as a sandbox owner. */
export function testOwner(holder = "runner-a"): SandboxOwner {
  return { id: holder, deployment: "test-deployment" };
}

/** Registry seams for tests that only exercise the sandbox lifecycle: link mounts, no view refresh. */
export function testRegistryOptions(daytona: LocalDaytona, extra: { maxEntries?: number } = {}) {
  return { sandboxPrefix: daytona.prefix, mounter: new LinkMounter(daytona, daytona.prefix), objects: memoryObjects(), ...extra };
}

/** A conversation to hold, with a drive at `cwd` (which need not exist for lifecycle-only tests). */
export function testConversation(key: string, cwd = "/x") {
  return {
    key,
    conversationId: key,
    projectId: "p",
    cwd,
    drive: [{ root: cwd, credentials: () => TEST_CREDENTIALS }],
    skillModes: new Map<string, number>(),
    signTranscriptMount: async () => TEST_TRANSCRIPT_CREDENTIALS,
  };
}

export interface TestWorkspace {
  base: string;
  cwd: string;
  agent: string;
  sessions: string;
  prefix: string;
  daytona: LocalDaytona;
  mounter: LinkMounter;
  /** The drive's prefixes the runner writes through the store, by prefix. */
  objects: Map<string, Map<string, Buffer>>;
  registry: ConversationRegistry;
  workspace: ConversationWorkspace;
  /** A runner path as the sandbox sees it. */
  inSandbox(path: string): string;
  /** Run a model command as one transaction and collect its output (and the skips and totals the runner reported). */
  bash(
    command: string,
    options?: {
      signal?: AbortSignal;
      timeoutSeconds?: number;
      requirements?: SandboxRequirements;
      outputPath?: string;
      discardOutputUpTo?: { bytes: number; lines: number };
    },
  ): Promise<CommandResult & { output: string; skipped: number; totals: OutputTotals | undefined }>;
  logs: string[];
}

export function createTestWorkspace(options: {
  settings?: Partial<CommandSandboxSettings>;
  conversationId?: string;
  daytona?: LocalDaytona;
  base?: string;
  owner?: SandboxOwner;
  skillModes?: Map<string, number>;
} = {}): TestWorkspace {
  const base = options.base ?? mkdtempSync(join(tmpdir(), "inprocess-ws-"));
  const cwd = join(base, "runner", "mounts", "conv");
  const agent = `${cwd}-agent`;
  const sessions = join(cwd, "agents", "sessions", "pi");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(agent, { recursive: true });
  try {
    symlinkSync(agent, join(cwd, "agent-files"));
  } catch {}
  const prefix = join(base, "sandbox");
  const daytona = options.daytona ?? new LocalDaytona(prefix);
  const logs: string[] = [];
  const mounter = new LinkMounter(daytona, daytona.prefix);
  const objects = new Map<string, Map<string, Buffer>>();
  const registry = new ConversationRegistry(sandboxSettings(options.settings), boundedDaytonaApi(daytona, TEST_DEADLINES), options.owner ?? testOwner(), (m) => logs.push(m), {
    sandboxPrefix: daytona.prefix,
    mounter,
    objects: memoryObjects(objects),
  });
  const conversationId = options.conversationId ?? "conv-1";
  const workspace = registry.hold({
    key: `inprocess:project:${conversationId}`,
    conversationId,
    projectId: "project",
    cwd,
    drive: [
      { root: cwd, credentials: () => TEST_CREDENTIALS },
      { root: agent, credentials: () => TEST_CREDENTIALS },
    ],
    agentRoot: agent,
    skillModes: options.skillModes ?? new Map(),
    signTranscriptMount: async () => TEST_TRANSCRIPT_CREDENTIALS,
  });
  return {
    base,
    cwd,
    agent,
    sessions,
    prefix,
    daytona,
    mounter,
    objects,
    registry,
    workspace,
    logs,
    inSandbox: (path) => daytona.prefix + path,
    bash: async (command, opts = {}) => {
      let output = "";
      let skipped = 0;
      let totals: OutputTotals | undefined;
      const result = await workspace.runCommand({
        command,
        cwd,
        outputPath: opts.outputPath ?? `/tmp/agenta-output-test-${randomUUID()}.log`,
        output: {
          append: (d) => (output += d.toString()),
          skip: (bytes) => (skipped += bytes),
          settle: (t) => (totals = t),
        },
        requirements: opts.requirements ?? OPEN_NETWORK,
        preparations: [],
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.timeoutSeconds ? { timeoutSeconds: opts.timeoutSeconds } : {}),
        ...(opts.discardOutputUpTo ? { discardOutputUpTo: opts.discardOutputUpTo } : {}),
      });
      return { ...result, output, skipped, totals };
    },
  };
}
