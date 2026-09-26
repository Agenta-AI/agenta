/**
 * The in-runner harness host: what `acquireEnvironment` holds for an `inprocess` run where other
 * providers hold a sandbox-agent daemon handle. It offers the same surface the environment and the
 * turn code call (sessions, runner file calls, processes, park and delete), so the shared turn,
 * approval and continuity code runs unchanged.
 *
 * Sessions are Pi SDK sessions in this process (`pi/`). Every Pi tool (`read`, `ls`, `grep`,
 * `find`, `write`, `edit`, `bash`) and every other process runs in the conversation's command
 * sandbox, on its mount of the drive, never on the runner host: the runner opens no path the model
 * chose and mounts nothing. Pi's conversation file is on the runner's disk and in a drive prefix of
 * its own that the sandbox cannot reach (`workspace/transcript-store.ts`).
 *
 * Lifecycle: the host holds the conversation's workspace once; the teardown the runner
 * already has decides park or delete and calls `pauseSandbox` or `destroySandbox`, which give the
 * hold back. Nothing here stops or deletes a sandbox on its own.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type CredentialStore } from "pi-coding-agent-pi-ai";
import type { InMemorySessionPersistDriver, SessionRecord } from "sandbox-agent";
import { agentMountPath } from "../sandbox_agent/agent-mount.ts";
import type { InRunnerRunFacts } from "../sandbox_agent/runtime-contracts.ts";
import type { ConversationRegistry } from "./conversation-registry.ts";
import type { ConversationWorkspace, SandboxPreparation } from "./conversation-workspace.ts";
import { InProcessAcpSession } from "./pi/acp-session.ts";
import { SubscriptionCredentialStore } from "./pi/credentials.ts";
import { ExtensionUiChannel } from "./pi/extension-ui-channel.ts";
import { openPiSession } from "./pi/pi-session-factory.ts";
import type { SandboxRequirements } from "./sandbox/command-sandbox.ts";
import { createSandboxBashTool } from "./tools/bash-tool.ts";
import { EditDiffs } from "./tools/edit-diffs.ts";
import { buildFileTools, type SandboxToolAccess } from "./tools/file-tools.ts";
import { publishSkillSnapshot } from "./workspace/skill-snapshot.ts";
import { withPublicCode } from "../sandbox_agent/errors.ts";
import type { SessionLedger } from "./session-ledger.ts";

type Log = (message: string) => void;

/** The file tools' read limit and the turn watchdog's windows. */
export interface InProcessLimits {
  /** Largest file the file tools read whole. */
  fileToolMaxBytes: number;
  /** A turn with no sign of life for this long, between steps, ends with an error. */
  turnIdleTimeoutMs: number;
  /** The same, while a model request, a compaction or a retry wait is in flight. */
  turnModelSilenceTimeoutMs: number;
  /** How long the end of a turn waits for the conversation file to reach the drive. */
  transcriptSaveTimeoutMs: number;
}

export const INPROCESS_LIMITS: InProcessLimits = {
  fileToolMaxBytes: 64 * 1024 * 1024,
  turnIdleTimeoutMs: 120_000,
  turnModelSilenceTimeoutMs: 600_000,
  transcriptSaveTimeoutMs: 15_000,
};

export interface InProcessRuntime {
  registry: ConversationRegistry;
  config: InProcessLimits;
  /** Every in-process session of this runner: admission and memory accounting. */
  ledger: SessionLedger;
  log: Log;
}

/** Executable files of the run's skills, by their path inside the skill snapshot. */
async function skillModes(snapshotDir: string | undefined, sources: Array<{ name: string; dir: string }>): Promise<Map<string, number>> {
  const modes = new Map<string, number>();
  if (!snapshotDir) return modes;
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const st = await stat(join(dir, name)).catch(() => undefined);
      if (st?.isDirectory()) await walk(join(dir, name), join(rel, name));
      else if (st?.isFile() && st.mode & 0o111) modes.set(join(snapshotDir, rel, name), st.mode & 0o777);
    }
  };
  for (const skill of sources) await walk(skill.dir, skill.name);
  return modes;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export const INPROCESS_NEEDS_DRIVE_MESSAGE =
  "This agent's sandbox runs its files on the file store, and no file store is attached to this run (a run needs a session, and the deployment needs object storage). Use the 'local' or 'daytona' sandbox for this agent, or run it in a session.";

export class InProcessHarnessHost {
  private readonly sessions = new Map<string, InProcessAcpSession>();
  private readonly preparations: SandboxPreparation[] = [];
  private workspace: ConversationWorkspace | undefined;
  private leasing: Promise<ConversationWorkspace> | undefined;
  private released = false;

  constructor(
    private readonly runtime: InProcessRuntime,
    private readonly facts: InRunnerRunFacts,
    private readonly persist: InMemorySessionPersistDriver,
  ) {}

  /** The command sandbox's Daytona id (for the turn row and logs; another runner never uses it). */
  get sandboxId(): string | undefined {
    return this.workspace?.sandbox.sandboxId;
  }

  /** Owner setup that runs in the command sandbox once per disk, before its first command. */
  onFirstCommand(preparation: SandboxPreparation): void {
    this.preparations.push(preparation);
  }

  private get requirements(): SandboxRequirements {
    return { network: this.facts.network, environment: this.facts.sandboxEnvironment };
  }

  private get log(): Log {
    return this.runtime.log;
  }

  // ---- The conversation's workspace --------------------------------------------------------- //

  private workspaceFor(cwd: string): Promise<ConversationWorkspace> {
    if (this.workspace) return Promise.resolve(this.workspace);
    this.leasing ??= (async () => {
      const session = this.facts.drives.find((d) => d.root === cwd);
      if (!session || !this.facts.conversationId || !this.facts.signTranscriptMount) {
        throw withPublicCode(new Error(INPROCESS_NEEDS_DRIVE_MESSAGE), "runner_error");
      }
      const agent = this.facts.drives.find((d) => d.root === agentMountPath(cwd));
      const skillDir = this.facts.harnessEnv.PI_CODING_AGENT_SKILL_DIR;
      const { conversationId, projectId } = this.facts;
      const workspace = this.runtime.registry.hold({
        key: `inprocess:${projectId ?? "-"}:${conversationId}`,
        conversationId,
        projectId,
        cwd,
        drive: agent ? [session, agent] : [session],
        ...(agent ? { agentRoot: agent.root } : {}),
        skillModes: await skillModes(skillDir, this.facts.skillSources),
        signTranscriptMount: this.facts.signTranscriptMount,
        ...(this.facts.usage ? { usage: this.facts.usage } : {}),
      });
      // The runner built the skill snapshot on its own disk; the sandbox reads it from the drive.
      if (skillDir) workspace.prepareDrive(publishSkillSnapshot(cwd, skillDir, this.runtime.registry.objects(session.credentials), this.log));
      this.workspace = workspace;
      return workspace;
    })();
    return this.leasing;
  }

  private sessionTools(sessionId: string, cwd: string, workspace: ConversationWorkspace, diffs: EditDiffs): ToolDefinition<any, any>[] {
    const bash = createSandboxBashTool(
      cwd,
      (request) => workspace.runCommand({ ...request, requirements: this.requirements, preparations: this.preparations }),
      (output) => this.runtime.ledger.trackOutput(sessionId, output),
    );
    const access: SandboxToolAccess = {
      read: (signal, step) => workspace.read(this.requirements, signal, step),
      change: (signal, step) => workspace.change(this.requirements, signal, step),
      inSandbox: (path) => workspace.inSandbox(path),
      tmpDir: workspace.tmpDir,
      maxFileBytes: this.runtime.config.fileToolMaxBytes,
    };
    return [...buildFileTools(cwd, access, diffs), bash];
  }

  /** The start of a turn: the sandbox's view of the drive is refreshed before its next tool call. */
  startTurn(): void {
    this.workspace?.startTurn();
  }

  private credentialStore(): CredentialStore {
    const home = this.facts.harnessEnv.PI_CODING_AGENT_DIR;
    // Only a subscription run reads a login, and only its own connection's. A managed run gets
    // its keys from the run's model environment and must not inherit an operator login.
    if (this.facts.credentialMode === "runtime_provided" && home) return new SubscriptionCredentialStore(home);
    return new InMemoryCredentialStore();
  }

  private async openSession(cwd: string, localId: string | undefined, resumeAgentSessionId?: string) {
    const id = localId ?? randomUUID();
    const ledger = this.runtime.ledger;
    // The seat is taken before anything is awaited, and given back if the session never opens.
    ledger.admit(id);
    try {
      return await this.buildSession(id, cwd, localId, resumeAgentSessionId);
    } catch (err) {
      if (!this.sessions.has(id)) ledger.close(id);
      throw err;
    }
  }

  private async buildSession(id: string, cwd: string, localId: string | undefined, resumeAgentSessionId?: string) {
    const ledger = this.runtime.ledger;
    const workspace = await this.workspaceFor(cwd);
    const transcripts = workspace.transcripts;
    await transcripts.restore();
    const ui = new ExtensionUiChannel();
    const diffs = new EditDiffs();
    const home = this.facts.harnessEnv.PI_CODING_AGENT_DIR;
    const modelsPath = home ? join(home, "models.json") : undefined;
    const customKey = this.facts.customProvider ? this.facts.modelEnvironment[this.facts.customProvider.keyEnv] : undefined;
    const opened = await openPiSession({
      cwd,
      sessionDir: transcripts.dir,
      skillDir: this.facts.harnessEnv.PI_CODING_AGENT_SKILL_DIR,
      modelsPath: modelsPath && (await exists(modelsPath)) ? modelsPath : undefined,
      ...(this.facts.customProvider && customKey ? { customProvider: { providerId: this.facts.customProvider.providerId, key: customKey } } : {}),
      modelEnv: this.facts.modelEnvironment,
      credentials: this.credentialStore(),
      systemPrompt: this.facts.systemPrompt,
      appendSystemPrompt: this.facts.appendSystemPrompt,
      tools: this.sessionTools(id, cwd, workspace, diffs),
      extensionEnv: { ...this.facts.harnessEnv, ...this.facts.extensionEnv },
      uiContext: ui,
      ...(resumeAgentSessionId ? { resumeAgentSessionId } : {}),
      log: this.log,
    });
    const session = new InProcessAcpSession({
      localId: id,
      eventIndexStart: await this.nextEventIndex(localId),
      cwd,
      session: opened.session,
      runtime: opened.runtime,
      ui,
      editDiffs: diffs,
      watchdog: { idleMs: this.runtime.config.turnIdleTimeoutMs, modelMs: this.runtime.config.turnModelSilenceTimeoutMs },
      cleanup: opened.cleanup,
      onTurnEnd: (file) => {
        const size = file ? statSync(file, { throwIfNoEntry: false })?.size : undefined;
        if (size !== undefined) ledger.setTranscriptBytes(id, size);
      },
      saveTranscript: () => transcripts.save(),
      transcriptSaveTimeoutMs: this.runtime.config.transcriptSaveTimeoutMs,
      log: this.log,
    });
    return { session, resumed: opened.resumed };
  }

  /** The next event index of each session this host recorded events for; a reopen reads it here. */
  private readonly nextIndex = new Map<string, number>();

  /** The next event index of `localId`: known when this host recorded its events, else read from the store once. */
  private async nextEventIndex(localId: string | undefined): Promise<number> {
    if (!localId) return 0;
    const known = this.nextIndex.get(localId);
    if (known !== undefined) return known;
    let max = -1;
    let cursor: string | undefined;
    do {
      const page = await this.persist.listEvents({ sessionId: localId, ...(cursor ? { cursor } : {}), limit: 500 });
      for (const event of page.items) max = Math.max(max, event.eventIndex);
      cursor = page.nextCursor;
    } while (cursor);
    return max + 1;
  }

  private attach(session: InProcessAcpSession): InProcessAcpSession {
    this.sessions.set(session.id, session);
    session.onEvent((event) => {
      this.nextIndex.set(session.id, Math.max(this.nextIndex.get(session.id) ?? 0, event.eventIndex + 1));
      void this.persist.insertEvent(session.id, event).catch(() => {});
    });
    return session;
  }

  // ---- Agent and session surface ---------------------------------------------------------- //

  async getAgent(agent: string): Promise<unknown> {
    if (agent !== "pi") throw new Error(`inprocess runs only the pi harness, not '${agent}'`);
    return {
      id: "pi",
      installed: true,
      capabilities: {
        textMessages: true,
        images: true,
        fileAttachments: false,
        mcpTools: false,
        toolCalls: true,
        reasoning: true,
        planMode: false,
        permissions: true,
        streamingDeltas: true,
        sessionLifecycle: true,
      },
    };
  }

  async createSession(request: { id?: string; agent: string; cwd: string; sessionInit?: SessionRecord["sessionInit"] }): Promise<InProcessAcpSession> {
    if (request.agent !== "pi") throw new Error(`inprocess runs only the pi harness, not '${request.agent}'`);
    const t0 = Date.now();
    const { session } = await this.openSession(request.cwd, request.id);
    this.log(`[inprocess] session created id=${session.id} pi=${session.agentSessionId} ms=${Date.now() - t0}`);
    await this.persist.updateSession({ ...session.toRecord(), ...(request.sessionInit ? { sessionInit: request.sessionInit } : {}) });
    return this.attach(session);
  }

  async resumeSession(localSessionId: string): Promise<InProcessAcpSession> {
    const live = this.sessions.get(localSessionId);
    if (live) return live;
    const record = await this.persist.getSession(localSessionId);
    const cwd = record?.sessionInit?.cwd;
    if (!record?.agentSessionId || !cwd) throw new Error(`inprocess: no resumable record for ${localSessionId}`);
    const t0 = Date.now();
    const { session, resumed } = await this.openSession(cwd, localSessionId, record.agentSessionId);
    this.attach(session);
    const replayed = resumed ? await session.replayHistory() : 0;
    this.log(`[inprocess] session resumed id=${localSessionId} loaded=${resumed} replayed=${replayed} ms=${Date.now() - t0}`);
    return session;
  }

  /** ACP cancel is a notification: fire it and return. */
  async cancelSession(id: string): Promise<void> {
    void this.sessions.get(id)?.cancel();
  }

  async destroySession(id: string): Promise<unknown> {
    const session = this.sessions.get(id);
    if (!session) return null;
    this.sessions.delete(id);
    this.runtime.ledger.close(id);
    await session.dispose();
    return session.toRecord();
  }

  // ---- Runner files: callers are runner code, never the model; the runner's own disk ---------- //

  async writeFsFile(query: { path: string }, body: string | Uint8Array | ArrayBuffer): Promise<unknown> {
    await mkdir(dirname(query.path), { recursive: true });
    await writeFile(query.path, body instanceof ArrayBuffer ? new Uint8Array(body) : body);
    return { path: query.path };
  }

  async readFsFile(query: { path: string }): Promise<Uint8Array> {
    return new Uint8Array(await readFile(query.path));
  }

  async mkdirFs(query: { path: string }): Promise<unknown> {
    await mkdir(query.path, { recursive: true });
    return { path: query.path };
  }

  async statFs(query: { path: string }): Promise<unknown> {
    const st = await stat(query.path);
    return { path: query.path, entryType: st.isDirectory() ? "directory" : "file", size: st.size, modified: st.mtime.toISOString() };
  }

  async moveFs(request: { from: string; to: string }): Promise<unknown> {
    await mkdir(dirname(request.to), { recursive: true });
    await rename(request.from, request.to);
    return { from: request.from, to: request.to };
  }

  async deleteFsEntry(query: { path: string; recursive?: boolean }): Promise<unknown> {
    await rm(query.path, { recursive: !!query.recursive, force: true });
    return { path: query.path };
  }

  // ---- Processes: the command sandbox, never the runner host -------------------------------- //

  async runProcess(request: { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<unknown> {
    const workspace = this.workspace;
    if (!workspace) throw new Error("inprocess: no session is open, so there is no command sandbox to run processes in");
    const r = await workspace.runHelper([request.command, ...(request.args ?? [])], {
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.env ? { env: request.env } : {}),
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      requirements: this.requirements,
    });
    return { exitCode: r.exitCode, stdout: r.output, stderr: "", timedOut: r.timedOut };
  }

  // ---- Lifecycle ------------------------------------------------------------------------------ //

  private async closeSessions(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.destroySession(id).catch(() => {});
  }

  private async release(disposition: "park" | "delete"): Promise<void> {
    if (this.released) return;
    this.released = true;
    const workspace = this.workspace ?? (await this.leasing?.catch(() => undefined));
    if (!workspace) return;
    const stats = this.runtime.registry.release(workspace, disposition);
    this.log(`[inprocess] sandbox released (${disposition}) ${JSON.stringify(stats)}`);
  }

  /** Teardown decided "stop": the conversation keeps its sandbox, stopped, disk intact. */
  async pauseSandbox(): Promise<void> {
    await this.closeSessions();
    await this.release("park");
  }

  /** Teardown decided "delete". */
  async destroySandbox(): Promise<void> {
    await this.closeSessions();
    await this.release("delete");
  }

  /** Always runs last in teardown; parks if nothing decided yet. */
  async dispose(): Promise<void> {
    await this.closeSessions();
    await this.release("park");
  }
}
