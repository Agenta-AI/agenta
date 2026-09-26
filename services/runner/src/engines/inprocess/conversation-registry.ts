/**
 * The conversations this runner process holds a workspace for. Every environment of a
 * conversation holds the same `ConversationWorkspace`, so a conversation has one command sandbox,
 * one drive mount in it, one copy of Pi's conversation file and one order of changes however many
 * sessions it opens here.
 *
 * The last hold decides what happens to the sandbox: `park` stops it (disk kept, for this
 * runner's next command) and `delete` removes it. Both happen after any change in flight has
 * finished; neither blocks the caller, and shutdown waits for them (bounded). A conversation this
 * registry drops (deleted, or past capacity) has its sandbox deleted and its local conversation
 * files removed: it would never be used again, and the store keeps the files.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ConversationWorkspace } from "./conversation-workspace.ts";
import { CommandSandbox, CONVERSATION_LABEL, type CommandSandboxSettings, type CommandSandboxStats } from "./sandbox/command-sandbox.ts";
import type { DaytonaApi } from "./sandbox/daytona-api.ts";
import { SandboxDrive, type DriveMounter, type DriveRoot } from "./sandbox/sandbox-drive.ts";
import type { SandboxOwner } from "./sandbox/sandbox-owner.ts";
import { sleep } from "./sandbox/serial-queue.ts";
import { DriveObjects, type ObjectStore } from "./workspace/drive-objects.ts";
import { TranscriptStore, transcriptDir } from "./workspace/transcript-store.ts";
import type { MountCredentials } from "../sandbox_agent/mount.ts";
import type { SandboxUsageContext } from "../../metering/sandbox-usage.ts";

type Log = (message: string) => void;

export interface ConversationSpec {
  /** Scoped key: provider, project and conversation. */
  key: string;
  /** The durable conversation id. */
  conversationId: string;
  projectId: string | undefined;
  /** The session folder. */
  cwd: string;
  /** The drive's roots (the session folder, the agent folder) with the runner mounts' credentials. */
  drive: DriveRoot[];
  /** The agent folder the session folder's `agent-files` link names, when the link is managed. */
  agentRoot?: string;
  /** Executable skill files (runner path) and their modes. */
  skillModes: Map<string, number>;
  /** Signs the conversation-file prefix. */
  signTranscriptMount: () => Promise<MountCredentials | null>;
  /** Who the command sandbox's running seconds are reported for; absent, they are not metered. */
  usage?: SandboxUsageContext;
}

export interface RegistryOptions {
  maxEntries?: number;
  /** Where the runner's "/" sits in the sandbox; tests only. */
  sandboxPrefix?: string;
  /** How the sandbox mounts the drive (a test links a folder). */
  mounter: DriveMounter;
  /** One prefix of the drive as objects (a test keeps them in memory). */
  objects?: (credentials: () => MountCredentials | null | Promise<MountCredentials | null>) => ObjectStore;
}

export class ConversationRegistry {
  private readonly entries = new Map<string, ConversationWorkspace>();
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly settings: CommandSandboxSettings,
    private readonly api: DaytonaApi,
    readonly owner: SandboxOwner,
    private readonly log: Log,
    private readonly options: RegistryOptions,
  ) {}

  /** Hold the conversation's workspace; the same object for every environment. */
  hold(spec: ConversationSpec): ConversationWorkspace {
    let workspace = this.entries.get(spec.key);
    if (!workspace) {
      const labels: Record<string, string> = {
        [CONVERSATION_LABEL]: spec.conversationId,
        ...(spec.projectId ? { "agenta.project": spec.projectId } : {}),
      };
      const sandbox = new CommandSandbox(spec.key, this.settings, this.api, this.owner, labels, this.log);
      const drive = new SandboxDrive(spec.drive, this.options.mounter, {
        ...(spec.agentRoot ? { agentLink: { cwd: spec.cwd, agentRoot: spec.agentRoot } } : {}),
        ...(this.options.sandboxPrefix ? { sandboxPrefix: this.options.sandboxPrefix } : {}),
        log: this.log,
      });
      // Signed with the workspace's newest signer, which `hold` replaces for every environment.
      // Its own folder: a replacement for this conversation never shares one with this instance.
      const transcripts = new TranscriptStore(join(transcriptDir(spec.cwd), randomUUID()), this.objects(() => created.signTranscriptMount()), this.log);
      const created: ConversationWorkspace = new ConversationWorkspace(sandbox, drive, transcripts, spec.signTranscriptMount, this.log);
      workspace = created;
      this.entries.set(spec.key, workspace);
    } else {
      // The newest environment's credentials: an older environment's may have expired.
      workspace.drive.setRoots(spec.drive);
      workspace.signTranscriptMount = spec.signTranscriptMount;
    }
    workspace.drive.addModes(spec.skillModes);
    workspace.sandbox.useUsage(spec.usage);
    // Counted before pruning, so the entry being handed out is never the one evicted.
    workspace.sandbox.holders += 1;
    this.prune();
    return workspace;
  }

  /** One prefix of the drive as objects, with those credentials. */
  objects(credentials: () => MountCredentials | null | Promise<MountCredentials | null>): ObjectStore {
    return (this.options.objects ?? ((c) => new DriveObjects(c)))(credentials);
  }

  /** Give a hold back; the last one parks or deletes the sandbox in the background. */
  release(workspace: ConversationWorkspace, disposition: "park" | "delete"): CommandSandboxStats {
    const sandbox = workspace.sandbox;
    sandbox.holders = Math.max(0, sandbox.holders - 1);
    if (sandbox.holders === 0) {
      sandbox.releaseUsage();
      if (disposition === "delete") {
        if (this.entries.get(sandbox.key) === workspace) {
          this.entries.delete(sandbox.key);
        }
        this.track(this.drop(workspace));
      } else {
        this.track(sandbox.stop("parked"));
      }
    }
    return sandbox.snapshotStats();
  }

  /** A workspace this registry no longer holds: its sandbox and its local conversation files go. */
  private drop(workspace: ConversationWorkspace): Promise<void> {
    return workspace.sandbox.delete().finally(() => {
      workspace.sandbox.dispose();
      return workspace.transcripts.dispose();
    });
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch((err) => this.log(`[inprocess] sandbox teardown failed: ${String(err).slice(0, 160)}`));
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  /** Drop the least recently used parked entries past capacity, and delete their sandboxes. */
  private prune(): void {
    const max = this.options.maxEntries ?? 500;
    if (this.entries.size <= max) return;
    const parked = [...this.entries.values()]
      .filter((w) => w.sandbox.holders === 0 && !w.sandbox.inUse)
      .sort((a, b) => a.sandbox.lastUsedAt - b.sandbox.lastUsedAt);
    for (const workspace of parked.slice(0, this.entries.size - max)) {
      this.entries.delete(workspace.sandbox.key);
      this.track(this.drop(workspace));
    }
  }

  /** Operational counters over every conversation this runner holds (logged periodically). */
  counters(): { conversations: number; running: number; inUse: number; retired: number; commands: number } {
    let running = 0;
    let inUse = 0;
    let retired = 0;
    let commands = 0;
    for (const workspace of this.entries.values()) {
      const stats = workspace.sandbox.snapshotStats();
      if (workspace.sandbox.running) running += 1;
      if (workspace.sandbox.inUse) inUse += 1;
      retired += stats.retired;
      commands += stats.commands;
    }
    return { conversations: this.entries.size, running, inUse, retired, commands };
  }

  /** Wait (bounded) for parks, deletes and retirements; the runner calls it on shutdown. */
  async settle(timeoutMs: number): Promise<void> {
    const cleanups = [...this.entries.values()].map((w) => w.sandbox.settle(timeoutMs));
    await Promise.race([Promise.allSettled([...this.pending, ...cleanups]), sleep(timeoutMs)]);
  }
}
