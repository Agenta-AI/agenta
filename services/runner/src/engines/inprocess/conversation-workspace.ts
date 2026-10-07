/**
 * Everything a conversation's tools share on this runner: its command sandbox, the drive mounted
 * in it, and the order changes happen in.
 *
 * All of Pi's tools run in the sandbox, on its mount of the drive; the runner opens no path the
 * model chose and mounts nothing. The drive, in object storage, holds the only copy of the session
 * folder and the agent folder, so a sandbox that is stopped, replaced or lost loses only its own
 * disk (`/tmp`). The sandbox starts on the first tool call that needs it.
 *
 * - Reads (`read`, `ls`, `grep`, `find`) run as soon as the sandbox is up.
 * - Changes (`write`, `edit`, commands, runner helper processes) run one at a time in arrival
 *   order. Each flushes the drive before it reports (`fsync` for a write, `sync -f` after a
 *   command), so what it wrote is in the store whatever happens to the sandbox next. A change whose
 *   call was not answered in time may still land: its sandbox is retired, and no later change
 *   starts until that sandbox is confirmed deleted (`CommandSandbox.untilRetiredSettled`).
 * - The first tool call of a turn refreshes the sandbox's view of the drive before it runs:
 *   files-pane edits and uploads go straight to the store, and a mount keeps what it saw for a
 *   minute. When the refresh fails, the call fails with a sentence, and the next one tries again.
 */
import type { AgentToolsSetupExec, AgentToolsSetupResult } from "../sandbox_agent/agent-tools-setup.ts";
import { shellQuote, type MountCredentials } from "../sandbox_agent/mount.ts";
import { CommandSandbox, type SandboxRequirements, type SandboxUse } from "./sandbox/command-sandbox.ts";
import { abortedError, DaytonaCallTimeoutError } from "./sandbox/daytona-api.ts";
import { AttemptUndecidedError, CommandNotStartedError, DriveNotMountedError, runRemoteCommand, settleAttempt, type OutputSink, type RemoteOutcome } from "./sandbox/remote-command.ts";
import { DriveUnreachableError, MountLostError, type SandboxDrive } from "./sandbox/sandbox-drive.ts";
import { SandboxFileError } from "./sandbox/sandbox-files.ts";
import type { DaytonaSandbox } from "./sandbox/daytona-api.ts";
import { SerialQueue } from "./sandbox/serial-queue.ts";
import type { TranscriptStore } from "./workspace/transcript-store.ts";

type Log = (message: string) => void;

/**
 * Owner setup that runs in the sandbox once per disk, before the first command (`.tools/` restore).
 * Optional, as on `daytona`: a failure does not stop the command. It is tried at most
 * `PREPARATION_ATTEMPTS` times per disk, before a command each time; the model is told of every
 * failed attempt, the last one saying it is not tried again, and later commands say nothing more.
 */
export type SandboxPreparation = (exec: AgentToolsSetupExec, signal?: AbortSignal) => Promise<AgentToolsSetupResult>;

/** Where the owner setup stands for one sandbox disk. */
type PreparationState = { kind: "done" } | { kind: "failed"; attempts: number };

export interface CommandRequest {
  command: string;
  cwd: string;
  timeoutSeconds?: number;
  /** Where the command's output is read back to. */
  output: OutputSink;
  /** The file in the sandbox that keeps the command's full output. */
  outputPath: string;
  /** Output at most this big is not kept in the sandbox (the model saw all of it). */
  discardOutputUpTo?: { bytes: number; lines: number };
  signal?: AbortSignal;
  requirements: SandboxRequirements;
  preparations: SandboxPreparation[];
}

export type CommandOutcome = RemoteOutcome;

export interface CommandResult {
  outcome: CommandOutcome;
}

const PREPARATION_ATTEMPTS = 2;
/** A stopped or lost command is not flushed by its supervisor; this call does it, bounded. */
const FLUSH_SECONDS = 30;
const REFRESH_SECONDS = 30;

export const VIEW_REFRESH_FAILED_MESSAGE =
  "The agent's files could not be refreshed in the command sandbox for this turn, so this call did not run (it could have seen an old version of a file). Try it again.";

export class ConversationWorkspace {
  private readonly changes = new SerialQueue();
  private readonly preparation = new Map<number, PreparationState>();
  /** What the runner puts on the drive before the sandbox may use it (the skill snapshot). */
  private readonly drivePreparations = new Set<Promise<void>>();
  /** Turns started, and the last turn whose view the sandbox shows: the view is stale while they differ. */
  private turns = 0;
  private viewTurn = 0;
  /** The refresh in progress, for the turn it serves: concurrent tool calls share it. */
  private viewRefresh: { turn: number; done: Promise<void> } | undefined;

  constructor(
    readonly sandbox: CommandSandbox,
    readonly drive: SandboxDrive,
    /** Pi's conversation file, kept by the runner in a prefix the sandbox cannot reach. */
    readonly transcripts: TranscriptStore,
    /** Signs the transcript prefix: the newest environment's, as an older one's credentials may have expired. */
    public signTranscriptMount: () => Promise<MountCredentials | null>,
    private readonly log: Log,
  ) {}

  /**
   * Runner work that puts files on the drive (through the store, not a mount) and that every tool
   * call waits for. A failure is logged; the tools then see the drive without those files.
   */
  prepareDrive(work: Promise<void>): void {
    const tracked = work.catch((err) => this.log(`[inprocess] drive preparation failed: ${String(err).slice(0, 160)}`));
    this.drivePreparations.add(tracked);
    void tracked.finally(() => this.drivePreparations.delete(tracked));
  }

  /** A runner path as the sandbox sees it. */
  inSandbox(path: string): string {
    return this.drive.inSandbox(path);
  }

  get tmpDir(): string {
    return this.drive.inSandbox("/tmp");
  }

  /** The start of a turn: the next tool call refreshes the sandbox's view of the drive first. Starts nothing. */
  startTurn(): void {
    this.turns += 1;
  }

  // ---- Tool calls --------------------------------------------------------------------------- //

  /** Run `step` on the running sandbox, with the drive mounted and its view current; starts the sandbox when needed. */
  read<T>(requirements: SandboxRequirements, signal: AbortSignal | undefined, step: (sandbox: DaytonaSandbox) => Promise<T>): Promise<T> {
    return this.onDrive(requirements, signal, step);
  }

  /**
   * Run `step` alone, in order with the conversation's other changes (a `write`, or an `edit`'s
   * read and write together). A Stop ends a wait in the queue or a sandbox start at once; a write
   * already sent runs to its end (it lands whole or not at all), then the tool reports the Stop.
   */
  change<T>(requirements: SandboxRequirements, signal: AbortSignal | undefined, step: (sandbox: DaytonaSandbox) => Promise<T>): Promise<T> {
    // Like Pi's own file tools: a Stop is seen once the operation in flight has settled.
    return this.inOrder(signal, () => this.onDrive(requirements, signal, step, { isChange: true }));
  }

  /**
   * Bring the sandbox up with the drive mounted and run `step`. When the drive's mount turns out
   * dead (geesefs died), the sandbox is replaced and `step` runs once more: it ran nothing the first
   * time (every call checks the mounts first). A change whose call was not answered in time may
   * still land later: its sandbox is retired, and no later change starts until it is deleted.
   */
  private async onDrive<T>(
    requirements: SandboxRequirements,
    signal: AbortSignal | undefined,
    step: (sandbox: DaytonaSandbox) => Promise<T>,
    options: { isChange?: boolean } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const use = await this.bringUp(requirements, signal);
      try {
        return await step(this.drive.guarded(use.sandbox));
      } catch (err) {
        if (options.isChange && err instanceof DaytonaCallTimeoutError) {
          use.retire("a change was not answered in time, so whether it landed is unknown");
          throw err;
        }
        if (attempt > 0 || !(err instanceof SandboxFileError && err.kind === "unmounted")) throw err;
        use.retire("its mount of the agent's files stopped serving");
      } finally {
        use.release();
      }
    }
  }

  /**
   * Run one command, in order with the conversation's other changes. Resolves with how the command
   * ended; rejects when it could not run (the sandbox could not be brought up, or the drive could
   * not be mounted in it).
   */
  runCommand(request: CommandRequest): Promise<CommandResult> {
    // Once the command runs, it owns the Stop: it kills the command and reports how it ended.
    return this.inOrder(request.signal, () => this.commandStep(request)).then((outcome) => ({ outcome }));
  }

  /**
   * A runner-owned helper process (not a model command): runs in the command sandbox, in order
   * with the model's changes; the runner's view is refreshed after it.
   */
  runHelper(
    argv: string[],
    options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; requirements: SandboxRequirements },
  ): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
    return this.inOrder(undefined, async () => {
      const use = await this.bringUp(options.requirements);
      const timeoutSeconds = Math.max(1, Math.ceil((options.timeoutMs ?? 60_000) / 1000));
      try {
        const r = await use.sandbox.run(argv.map(shellQuote).join(" "), {
          timeoutSeconds,
          ...(options.cwd ? { cwd: this.inSandbox(options.cwd) } : {}),
          ...(options.env ? { env: options.env } : {}),
        });
        return { exitCode: r.exitCode, output: r.output, timedOut: false };
      } catch (err) {
        if (!(err instanceof DaytonaCallTimeoutError)) throw err;
        use.retire("a helper process was not answered in time, so what it did is unknown");
        return { exitCode: -1, output: "", timedOut: true };
      } finally {
        await this.flush(use);
        use.release();
      }
    });
  }

  /**
   * Queue `step` behind the conversation's other changes, and behind every retired sandbox not yet
   * confirmed deleted. A Stop while it waits ends the wait at once and the step never runs. Once it
   * runs, the step handles the Stop itself; the queue stays held until it ends.
   */
  private inOrder<T>(signal: AbortSignal | undefined, step: () => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortedError());
    let started = false;
    const run = this.changes.run(async () => {
      await this.sandbox.untilRetiredSettled(signal);
      if (signal?.aborted) throw abortedError();
      started = true;
      return step();
    });
    void run.catch(() => {});
    if (!signal) return run;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (!started) reject(abortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      run.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  /**
   * The running sandbox with the drive mounted, its view current for this turn and showing what the
   * runner put on the drive (a new skill snapshot), and those skill files' modes set. A sandbox
   * whose mount credentials are about to expire is replaced first: a mount cannot be replaced in place.
   */
  private async bringUp(requirements: SandboxRequirements, signal?: AbortSignal): Promise<SandboxUse> {
    if (this.drivePreparations.size) await Promise.all(this.drivePreparations);
    for (let attempt = 0; ; attempt += 1) {
      const use = await this.sandbox.acquire(requirements, signal);
      try {
        const turn = this.turns;
        // A new mount sees the store as it is now.
        if (!this.drive.mountedOn(use.sandbox.id, use.boot)) this.viewTurn = turn;
        await this.drive.ensure(use, signal);
        if (this.viewTurn < turn || this.drive.modesPending) await this.refreshView(use);
        if (this.drive.modesPending) await this.drive.applyModes(use.sandbox, signal);
        return use;
      } catch (err) {
        if (attempt === 0 && err instanceof MountLostError) {
          use.retire(err.message);
          use.release();
          continue;
        }
        // A mount that failed may have left a dead node behind, which cannot be removed in the
        // sandbox: the next attempt starts on a new one.
        if (err instanceof DriveUnreachableError) use.retire("its drive could not be mounted");
        use.release();
        throw err;
      }
    }
  }

  private async commandStep(request: CommandRequest): Promise<CommandOutcome> {
    const { signal } = request;
    let use = await this.bringUp(request.requirements, signal);
    try {
      await this.prepare(use, request);
      let outcome: CommandOutcome;
      try {
        use.assertCurrent();
        this.sandbox.countCommand();
        ({ use, outcome } = await this.launch(use, request));
      } catch (err) {
        if (signal?.aborted || !(err instanceof CommandNotStartedError || err instanceof AttemptUndecidedError)) throw err;
        // The sandbox did not take the launch, for example because Daytona stopped it behind our
        // back: bring it back, decide the attempt on it if needed (only the sandbox it was sent to
        // can decide it), and run the command once more only when it provably never started.
        if (err instanceof AttemptUndecidedError) use.suspect("a command launch was not answered");
        use.release();
        use = await this.bringUp(request.requirements, signal);
        const settled = err instanceof AttemptUndecidedError ? await settleAttempt(use, err) : "retry";
        if (settled === "retry") {
          use.assertCurrent();
          ({ use, outcome } = await this.launch(use, request));
        } else {
          outcome = settled;
        }
      }
      // The supervisor flushed the drive before recording an exit code; a command that did not
      // exit on its own was not flushed.
      if (outcome.kind !== "exited") await this.flush(use);
      return outcome;
    } finally {
      use.release();
    }
  }

  /** Launch once; when the launch found the drive's mount dead, replace the sandbox and launch once more (nothing ran). */
  private async launch(use: SandboxUse, request: CommandRequest): Promise<{ use: SandboxUse; outcome: CommandOutcome }> {
    try {
      return { use, outcome: await this.run(use, request) };
    } catch (err) {
      if (!(err instanceof DriveNotMountedError)) throw err;
      use.retire(`its mount of ${err.root} stopped serving`);
      use.release();
      const next = await this.bringUp(request.requirements, request.signal);
      try {
        await this.prepare(next, request);
        return { use: next, outcome: await this.run(next, request) };
      } catch (retryErr) {
        next.release();
        throw retryErr;
      }
    }
  }

  private run(use: SandboxUse, request: CommandRequest): Promise<CommandOutcome> {
    return runRemoteCommand(use, request.command, this.inSandbox(request.cwd), {
      output: request.output,
      outputPath: this.inSandbox(request.outputPath),
      ...(request.discardOutputUpTo ? { discardOutputUpTo: request.discardOutputUpTo } : {}),
      tmpDir: this.tmpDir,
      driveRoots: this.drive.mountChecks,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutSeconds ? { timeoutSeconds: request.timeoutSeconds } : {}),
      log: this.log,
    });
  }

  /** Flush the drive's roots in the sandbox, bounded; a failure is logged (the caller already reports a failed step). */
  private async flush(use: SandboxUse): Promise<void> {
    if (!use.current) return;
    const roots = this.drive.rootPaths.map((r) => shellQuote(this.drive.inSandbox(r)));
    const failed = await use.sandbox
      .run(`f=0; ${roots.map((r) => `timeout ${FLUSH_SECONDS} sync -f ${r} 2>/dev/null || f=1`).join("; ")}; exit $f`, { timeoutSeconds: FLUSH_SECONDS + 5 })
      .then((r) => (r.exitCode === 0 ? undefined : `exit code ${r.exitCode}`), (err) => String(err).slice(0, 120));
    if (failed) this.log(`[inprocess] drive flush in the sandbox failed: ${failed}`);
  }

  /**
   * Refresh the sandbox's view of every root of the drive for the current turn; concurrent calls
   * share one refresh. Throws a sentence when it fails (the view is then still stale).
   */
  private refreshView(use: SandboxUse): Promise<void> {
    const turn = this.turns;
    if (this.viewRefresh?.turn === turn) return this.viewRefresh.done;
    const done = (async () => {
      const failure = await use.sandbox.run(this.drive.refreshCommand, { timeoutSeconds: REFRESH_SECONDS }).then(
        (r) => (r.exitCode === 0 ? undefined : `${r.output.trim().slice(0, 80)} root(s) not refreshed`),
        (err) => String(err).slice(0, 120),
      );
      if (failure) {
        this.log(`[inprocess] sandbox view refresh failed: ${failure}`);
        throw new Error(VIEW_REFRESH_FAILED_MESSAGE);
      }
      this.viewTurn = Math.max(this.viewTurn, turn);
    })().finally(() => {
      if (this.viewRefresh?.turn === turn) this.viewRefresh = undefined;
    });
    this.viewRefresh = { turn, done };
    return done;
  }

  /** Owner setup, once per disk, marked done only when every preparation succeeded. */
  private async prepare(use: SandboxUse, request: CommandRequest): Promise<void> {
    if (request.preparations.length === 0) return;
    const state = this.preparation.get(use.generation);
    if (state?.kind === "done" || (state?.kind === "failed" && state.attempts >= PREPARATION_ATTEMPTS)) return;
    const attempts = state?.kind === "failed" ? state.attempts : 0;
    const exec: AgentToolsSetupExec = {
      run: async ({ script, cwd, env, timeoutMs }) => {
        const r = await use.sandbox.run(`sh -c ${shellQuote(script)}`, {
          timeoutSeconds: Math.max(1, Math.ceil((timeoutMs ?? 300_000) / 1000)),
          ...(cwd ? { cwd } : {}),
          ...(env ? { env } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
        });
        return { exitCode: r.exitCode };
      },
    };
    const failures: string[] = [];
    for (const preparation of request.preparations) {
      const result = await preparation(exec, request.signal);
      if (request.signal?.aborted) throw abortedError();
      if (result.status === "failed") failures.push(`exit code ${result.exitCode ?? "unknown"}`);
      if (result.status === "error") failures.push(result.message);
    }
    if (failures.length === 0) {
      this.preparation.set(use.generation, { kind: "done" });
      return;
    }
    const next = attempts + 1;
    this.preparation.set(use.generation, { kind: "failed", attempts: next });
    const retry = next < PREPARATION_ATTEMPTS ? "it is tried again before the next command" : "it is not tried again for this sandbox";
    request.output.append(Buffer.from(`[agent-files/.tools] setup failed (${failures.join("; ").slice(0, 200)}); ${retry}\n`));
  }
}
