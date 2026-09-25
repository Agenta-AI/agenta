/**
 * Run one model command in the command sandbox and stream its output.
 *
 * The command runs under a small supervisor script, started detached by one plain Daytona call.
 * Everything this module needs to know lives in files under the attempt's folder
 * (`/tmp/.agenta-cmd-<attempt>/`, kept afterwards so a late duplicate launch finds its claim taken)
 * and in the output file:
 *
 * - `pgid`: the command's process group, written (atomically) BEFORE the attempt is claimed.
 * - `claim/`: taken with an atomic `mkdir` by whoever decides the attempt first. The supervisor
 *   runs the command only if it takes the claim. A Stop that takes it first proves the command
 *   never ran and never will, and a late supervisor then exits without running anything.
 * - `cancelled`: written by a Stop that took the claim.
 * - `exit`: the exit code, written when the command ends, before `pgid` is removed.
 * - the output file (`outputPath`): stdout and stderr together, as the command wrote them. It stays
 *   in the sandbox, where the model can read the full output, unless the output was small enough
 *   that the model saw all of it (`discardOutputUpTo`). Polls only read it, so a poll whose answer
 *   was lost is simply asked again; the file is deleted by a separate call once the final poll's
 *   answer has been received and handed to the sink.
 *
 * Because the process group is on disk before the claim, a claimed attempt always has a process
 * group to kill or an exit code: Stop never has to read "no pid yet" as "gone". A kill that is not
 * confirmed within `killDeadlineMs` leaves the outcome unknown; the sandbox is then retired and
 * the caller reports that the command's outcome is unknown.
 *
 * Output is read back in bounded pieces. Each poll returns the exit status, the file's size and at
 * most `OUTPUT_CHUNK_BYTES` from where the last poll stopped; when the command writes faster than
 * that, the poll jumps to the newest bytes (a tail read) and the sink is told how much it skipped.
 * The poll that sees the exit code also returns the file's exact line count and last line's
 * length. The runner therefore never holds more than one chunk of a command's output.
 *
 * A launch whose answer is lost, or a supervisor that has not claimed its attempt in time, is
 * decided by taking the claim from outside: winning proves the command never started, so the caller
 * may retry; losing means it started, and polling follows it. A claim is a folder on the sandbox's
 * disk, so it proves something only on that sandbox: an attempt that could not be decided carries
 * the sandbox's id, and is decided only on that same sandbox (`settleAttempt`).
 *
 * When the use ends while the command runs (`SandboxUse.signal`: the sandbox was retired or
 * deleted), the command is stopped as
 * on Stop, and its outcome is reported as unknown unless the kill proves it never started.
 *
 * A command's lifetime is capped in the sandbox too (`commandLifetimeSeconds`): the supervisor runs
 * under `timeout`, which kills its whole process group at the cap. While the runner lives, its own
 * timeout or Stop comes first. The cap is for a command whose runner died: nothing else stops it
 * before Daytona stops the sandbox, and it keeps writing to the drive a replacement runner uses.
 *
 * The command works on the drive's own mount (`sandbox-drive.ts`): its changes are in the store as
 * soon as geesefs uploads them, and the supervisor flushes the drive's roots before it records the
 * exit code. A command stopped before it ended is not flushed by the supervisor; the caller flushes.
 */
import { randomUUID } from "node:crypto";
import { resolveRunLimits } from "../../sandbox_agent/run-limits.ts";
import { shellQuote } from "../../sandbox_agent/mount.ts";
import { abortedError } from "./daytona-api.ts";
import type { SandboxUse } from "./command-sandbox.ts";
import { sleep } from "./serial-queue.ts";

/** The launch found a root of the drive unmounted (geesefs died), so nothing was launched. Safe to retry after a mount. */
export class DriveNotMountedError extends Error {
  constructor(readonly root: string) {
    super("A folder of the agent's files was not attached in the command sandbox.");
    this.name = "DriveNotMountedError";
  }
}

/** The command provably never started (the runner took its claim). Safe to retry. */
export class CommandNotStartedError extends Error {
  constructor(cause: unknown) {
    super(`The command sandbox did not start the command: ${String(cause instanceof Error ? cause.message : cause).slice(0, 160)}`);
    this.name = "CommandNotStartedError";
  }
}

/**
 * Whether the attempt started could not be told: the sandbox answered neither the launch nor the
 * claim (Daytona may have stopped it). Settle it with `settleAttempt` once the sandbox is back.
 */
export class AttemptUndecidedError extends Error {
  constructor(
    readonly attempt: string,
    /** The sandbox whose disk holds the attempt's claim: the only place it can be decided. */
    readonly sandboxId: string,
  ) {
    super("The command sandbox did not answer whether the command started.");
    this.name = "AttemptUndecidedError";
  }
}

/** Where a command's output goes as it is read back. */
export interface OutputSink {
  /** The next bytes of the output file, in order. */
  append(chunk: Buffer): void;
  /** `bytes` of output were not read back (the command wrote faster than the bounded reads). */
  skip(bytes: number): void;
  /** The output file's exact totals, once the command ended. */
  settle(totals: OutputTotals): void;
}

export interface OutputTotals {
  bytes: number;
  /** Lines as Pi counts them: newlines, plus one for a last line with no newline. */
  lines: number;
  /** Bytes after the last newline (0 when the output ends with one). */
  openLineBytes: number;
}

export type RemoteOutcome =
  | { kind: "exited"; exitCode: number }
  | { kind: "aborted" }
  | { kind: "timed_out"; seconds: number }
  /** Whether the command ran, is still running or what it did cannot be told. */
  | { kind: "unknown"; reason: string };

export interface RemoteCommandOptions {
  output: OutputSink;
  /** The output file in the sandbox. */
  outputPath: string;
  /** Delete the output file once the command ended and its output was received, when it is at most this big (nobody needs it then). */
  discardOutputUpTo?: { bytes: number; lines: number };
  signal?: AbortSignal;
  timeoutSeconds?: number;
  /** How long a Stop waits for the kill to be confirmed before the outcome is unknown. */
  killDeadlineMs?: number;
  /** How long a launched supervisor may take to claim its attempt before the runner decides it. */
  startDeadlineMs?: number;
  /** The sandbox's temporary folder, where attempt folders go. */
  tmpDir?: string;
  /**
   * The drive's roots in the sandbox. The launch checks each is mounted before anything starts, and
   * the supervisor flushes them (`sync -f`) after the command, before it records the exit code, so
   * a runner that sees the exit code can refresh its view and read what the command wrote.
   */
  driveRoots?: Array<{ root: string; check: string }>;
  /** The command's lifetime in the sandbox; `commandLifetimeSeconds` by default. */
  lifetimeSeconds?: number;
  log: (message: string) => void;
}

/** Every script runs under bash, whatever shell the sandbox's plain command call uses. */
const bash = (script: string) => `bash -c ${shellQuote(script)}`;

/** Most output bytes one poll reads back. */
export const OUTPUT_CHUNK_BYTES = 256 * 1024;
const POLL_FAILURES_BEFORE_UNKNOWN = 5;
const DEFAULT_KILL_DEADLINE_MS = 5_000;
const DEFAULT_START_DEADLINE_MS = 10_000;
/** How long past its limit a command may live in the sandbox: the runner's own timeout comes first. */
const LIFETIME_GRACE_SECONDS = 60;

/**
 * The most a command lives in the sandbox: its own timeout, never more than the per-tool-call limit
 * (`AGENTA_RUNNER_TOOL_CALL_TIMEOUT_MS`, which ends the turn anyway), plus a grace.
 */
export function commandLifetimeSeconds(timeoutSeconds: number | undefined, toolCallMs = resolveRunLimits().toolCallMs): number {
  const limit = Math.ceil(toolCallMs / 1000);
  return Math.min(timeoutSeconds ?? limit, limit) + LIFETIME_GRACE_SECONDS;
}

/**
 * The supervisor: record the process group, take the claim or do nothing, run, flush the drive,
 * record the exit code. The launch first checks that every drive root is mounted, and says
 * `unmounted <root>` instead of launching when one is not.
 */
export function launchScript(
  dir: string,
  command: string,
  cwd: string,
  outputPath: string,
  driveRoots: Array<{ root: string; check: string }> = [],
  lifetimeSeconds = commandLifetimeSeconds(undefined),
): string {
  const d = shellQuote(dir);
  const out = shellQuote(outputPath);
  const flush = driveRoots.map((r) => `timeout 60 sync -f ${shellQuote(r.root)} 2>/dev/null || unflushed=1`).join("; ");
  const supervisor = [
    `d=${d}`,
    // The group is `timeout`'s (the session leader), not this shell's own pid.
    `read -r _ _ _ _ pg _ < /proc/$$/stat && echo $pg > "$d/pgid.tmp" && mv -f "$d/pgid.tmp" "$d/pgid" || exit 1`,
    `mkdir "$d/claim" 2>/dev/null || { rm -f "$d/pgid"; exit 0; }`,
    `cd ${shellQuote(cwd)} 2>/dev/null || cd /`,
    `bash -c ${shellQuote(command)} > ${out} 2>&1 < /dev/null`,
    `code=$?`,
    `unflushed=0`,
    ...(flush ? [flush] : []),
    `echo $code $unflushed > "$d/exit.tmp" && mv -f "$d/exit.tmp" "$d/exit"`,
    `rm -f "$d/pgid"`,
  ].join("\n");
  const mounted = driveRoots.map((r) => `{ ${r.check}; } || { echo unmounted ${shellQuote(r.root)}; exit 0; }`);
  // setsid gives the supervisor and the command their own session and process group, so the call
  // returns at once and a kill reaches every process the command started. `timeout` leads that
  // group and kills all of it at the lifetime.
  const supervised = `setsid timeout -s KILL ${Math.max(1, Math.ceil(lifetimeSeconds))} bash -c ${shellQuote(supervisor)}`;
  return bash([...mounted, `mkdir -p ${d} && : > ${out} && { ${supervised} < /dev/null > /dev/null 2>&1 & } && echo launched`].join("; "));
}

/**
 * One poll. Prints `exit unflushed claimed alive size start lines lastLine` on the first line (`-`
 * for what is not known yet; `unflushed` is 1 when the supervisor's flush of the drive failed), then the bytes [start, size) of the output file in base64. The process group
 * is checked before the exit code: the supervisor writes the exit code before it removes `pgid`,
 * so "not alive and no exit code" means the command died without recording one.
 */
function pollScript(dir: string, outputPath: string, offset: number): string {
  return bash([
    `d=${shellQuote(dir)}; f=${shellQuote(outputPath)}; off=${offset}; max=${OUTPUT_CHUNK_BYTES}`,
    `a=0; pg=$(cat "$d/pgid" 2>/dev/null); [ -n "$pg" ] && kill -0 -- "-$pg" 2>/dev/null && a=1`,
    `x=-; u=-; [ -f "$d/exit" ] && read -r x u < "$d/exit"; u=\${u:-0}`,
    `c=0; [ -d "$d/claim" ] && [ ! -f "$d/cancelled" ] && c=1`,
    `s=$(stat -c %s "$f" 2>/dev/null || echo 0)`,
    `start=$off; [ $((s - off)) -gt $max ] && start=$((s - max))`,
    `lines=-; last=-; if [ "$x" != - ]; then set -- $(LC_ALL=C awk '{n++; l=length($0)} END{print n+0, l+0}' "$f" 2>/dev/null); lines=\${1:-0}; last=\${2:-0}; fi`,
    `printf '%s %s %s %s %s %s %s %s\\n' "$x" "$u" "$c" "$a" "$s" "$start" "$lines" "$last"`,
    `[ "$s" -gt "$start" ] && tail -c +$((start + 1)) "$f" 2>/dev/null | head -c $((s - start)) | base64 -w0`,
    "true",
  ].join("; "));
}

/** Take the claim if it is free. Prints `never-started` when this took it (the command never ran and never will), else `started`. */
function claimLines(dir: string): string[] {
  return [
    `d=${shellQuote(dir)}`,
    `mkdir -p "$d" 2>/dev/null`,
    `if mkdir "$d/claim" 2>/dev/null; then : > "$d/cancelled"; echo never-started; exit 0; fi`,
    `[ -f "$d/cancelled" ] && { echo never-started; exit 0; }`,
  ];
}

const claimScript = (dir: string) => bash([...claimLines(dir), "echo started"].join("; "));

/**
 * Stop the attempt. Prints `never-started` when this took the claim, `ended` when it had finished,
 * `killed` once its process group is dead, and `alive` or `unknown` otherwise.
 */
function killScript(dir: string): string {
  return bash([
    ...claimLines(dir),
    `pg=$(cat "$d/pgid" 2>/dev/null)`,
    `[ -n "$pg" ] || { [ -f "$d/exit" ] && echo ended || echo unknown; exit 0; }`,
    `kill -TERM -- "-$pg" 2>/dev/null`,
    `for i in $(seq 10); do kill -0 -- "-$pg" 2>/dev/null || { echo killed; exit 0; }; sleep 0.1; done`,
    `kill -KILL -- "-$pg" 2>/dev/null; sleep 0.2`,
    `kill -0 -- "-$pg" 2>/dev/null && echo alive || echo killed`,
  ].join("; "));
}

interface Poll {
  exitCode: number | undefined;
  unflushed: boolean;
  claimed: boolean;
  alive: boolean;
  size: number;
  start: number;
  lines: number | undefined;
  lastLine: number | undefined;
  data: Buffer;
}

function parsePoll(output: string): Poll {
  const newline = output.indexOf("\n");
  const head = (newline === -1 ? output : output.slice(0, newline)).trim().split(/\s+/);
  if (head.length !== 8) throw new Error(`unexpected poll answer: ${output.slice(0, 80)}`);
  const [x, u, c, a, s, start, lines, last] = head as [string, string, string, string, string, string, string, string];
  const num = (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`unexpected poll answer: ${output.slice(0, 80)}`);
    return n;
  };
  return {
    exitCode: x === "-" ? undefined : num(x),
    unflushed: u === "1",
    claimed: c === "1",
    alive: a === "1",
    size: num(s),
    start: num(start),
    lines: lines === "-" ? undefined : num(lines),
    lastLine: last === "-" ? undefined : num(last),
    data: Buffer.from(newline === -1 ? "" : output.slice(newline + 1).trim(), "base64"),
  };
}

/**
 * Run `command` once. Resolves with how it ended; rejects with `aborted` only when Stop came
 * before anything was sent, and with `CommandNotStartedError` when it provably never started.
 */
export async function runRemoteCommand(use: SandboxUse, command: string, cwd: string, options: RemoteCommandOptions): Promise<RemoteOutcome> {
  const { signal, output, log } = options;
  if (signal?.aborted) throw abortedError();
  const sandbox = use.sandbox;
  const dir = `${(options.tmpDir ?? "/tmp").replace(/\/+$/, "")}/.agenta-cmd-${randomUUID()}`;
  const killDeadlineMs = options.killDeadlineMs ?? DEFAULT_KILL_DEADLINE_MS;

  const ask = (script: string) =>
    sandbox
      .run(script, { timeoutSeconds: 10 })
      .then((r) => r.output.trim().split(/\s+/).at(-1) || "unknown")
      .catch(() => "unknown");
  /** At most one kill per attempt: resolves with the kill script's answer, or `unknown`. */
  let killing: Promise<string> | undefined;
  const kill = () => (killing ??= ask(killScript(dir)));
  /** Whether the attempt started, taking its claim when it had not. */
  const started = async (why: string): Promise<void> => {
    const answer = await ask(claimScript(dir));
    if (answer === "never-started") throw new CommandNotStartedError(why);
    if (answer !== "started") throw new AttemptUndecidedError(dir, sandbox.id);
  };

  let stopReason: "aborted" | "timeout" | "lost" | undefined;
  const stopper = new AbortController();
  const stop = (why: "aborted" | "timeout" | "lost") => {
    if (stopReason) return;
    stopReason = why;
    stopper.abort();
    void kill();
  };
  const onAbort = () => stop("aborted");
  signal?.addEventListener("abort", onAbort, { once: true });
  const onLost = () => stop("lost");
  use.signal.addEventListener("abort", onLost, { once: true });
  /** Retire the sandbox from here: that ends the use, which must not read as a loss. */
  const retire = (reason: string) => {
    use.signal.removeEventListener("abort", onLost);
    use.retire(reason);
  };
  const deadline = options.timeoutSeconds && options.timeoutSeconds > 0 ? setTimeout(() => stop("timeout"), options.timeoutSeconds * 1000) : undefined;

  /** How a stopped attempt ended: confirmed within the deadline, or unknown (the sandbox is retired). */
  const stopped = async (): Promise<RemoteOutcome> => {
    const answer = await Promise.race([kill(), sleep(killDeadlineMs).then(() => "unknown")]);
    if (stopReason === "lost") {
      // Only a claim taken here proves anything; whatever else the command did before it was
      // stopped is on the drive already, and is not known.
      if (answer === "never-started") throw new CommandNotStartedError(use.lostReason ?? "the command sandbox was lost");
      return { kind: "unknown", reason: `${use.lostReason ?? "the command sandbox was lost"} while it ran, so it was stopped; check what it changed before running it again` };
    }
    if (answer === "never-started" || answer === "killed" || answer === "ended") {
      return stopReason === "timeout" ? { kind: "timed_out", seconds: options.timeoutSeconds! } : { kind: "aborted" };
    }
    retire(`a ${stopReason === "timeout" ? "timed-out" : "stopped"} command could not be confirmed dead (${answer})`);
    return { kind: "unknown", reason: "it was stopped, but the sandbox did not confirm that it ended, so the sandbox was replaced" };
  };

  try {
    // The launch is not cancelled by Stop: a Stop decides the attempt through its claim instead,
    // which is correct whether or not the launch has landed yet.
    const launched = sandbox.run(launchScript(dir, command, cwd, options.outputPath, options.driveRoots, options.lifetimeSeconds ?? commandLifetimeSeconds(options.timeoutSeconds)), { timeoutSeconds: 30 }).then(
      (r) => (r.output.includes("launched") ? "launched" : r.output.startsWith("unmounted ") ? r.output.trim() : `failed: ${r.output.slice(0, 120)}`),
      (err: unknown) => `failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
    );
    const launch = await Promise.race([launched, new Promise<undefined>((resolve) => stopper.signal.addEventListener("abort", () => resolve(undefined), { once: true }))]);
    if (launch === undefined) return await stopped();
    // Nothing was launched: the check runs before the supervisor exists.
    if (launch.startsWith("unmounted ")) throw new DriveNotMountedError(launch.slice("unmounted ".length));
    // The answer was lost or refused: the claim says whether the command started.
    if (launch !== "launched") await started(launch.slice("failed: ".length));

    const launchedAt = Date.now();
    let offset = 0;
    let endsWithNewline = true;
    let failures = 0;
    let interval = 100;
    for (;;) {
      if (stopReason) return await stopped();
      let poll: Poll;
      try {
        poll = parsePoll((await sandbox.run(pollScript(dir, options.outputPath, offset), { timeoutSeconds: 10, signal: stopper.signal })).output);
        failures = 0;
      } catch (err) {
        if (stopReason) continue;
        failures += 1;
        if (failures >= POLL_FAILURES_BEFORE_UNKNOWN) {
          retire("the command sandbox stopped answering while a command ran");
          log(`[inprocess] command polls failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
          return { kind: "unknown", reason: "the sandbox stopped answering while it ran, so the sandbox was replaced" };
        }
        await sleep(interval, stopper.signal).catch(() => {});
        continue;
      }
      if (poll.start > offset) output.skip(poll.start - offset);
      if (poll.data.length) {
        output.append(poll.data);
        endsWithNewline = poll.data[poll.data.length - 1] === 0x0a;
      }
      offset = poll.start + poll.data.length;
      if (poll.exitCode !== undefined && offset >= poll.size) {
        const lines = poll.lines ?? 0;
        output.settle({ bytes: poll.size, lines, openLineBytes: endsWithNewline ? 0 : (poll.lastLine ?? 0) });
        // Received: now the file may go, when the model saw all of it. A lost answer here only leaves it in /tmp.
        const discard = options.discardOutputUpTo;
        if (discard && poll.size <= discard.bytes && lines <= discard.lines) {
          void sandbox.run(`rm -f ${shellQuote(options.outputPath)}`, { timeoutSeconds: 10 }).catch(() => {});
        }
        // The command's changes may sit only in the sandbox's mount cache: its success cannot be reported.
        if (poll.unflushed) return { kind: "unknown", reason: `it exited with code ${poll.exitCode}, but its changes to the agent's files could not be confirmed as saved` };
        return { kind: "exited", exitCode: poll.exitCode };
      }
      if (poll.exitCode === undefined && poll.claimed && !poll.alive) {
        use.suspect("a command ended without an exit code");
        return { kind: "unknown", reason: "it ended without an exit code (the sandbox may have restarted)" };
      }
      if (!poll.claimed && Date.now() - launchedAt > (options.startDeadlineMs ?? DEFAULT_START_DEADLINE_MS)) {
        await started("the launched command did not start in time");
      }
      // Fast only while output is backed up (a full chunk came back); a steady trickle is read at
      // 400 ms, so a long command costs a few calls a second, not seven.
      interval = poll.data.length >= OUTPUT_CHUNK_BYTES ? 150 : poll.data.length ? 400 : Math.min(Math.round(interval * 1.5), 1_000);
      await sleep(interval, stopper.signal).catch(() => {});
    }
  } finally {
    if (deadline) clearTimeout(deadline);
    signal?.removeEventListener("abort", onAbort);
    use.signal.removeEventListener("abort", onLost);
    stopper.abort();
  }
}

/**
 * An attempt whose start could not be told, decided on the sandbox it was sent to, once that
 * sandbox is back: its claim, when still free, is taken, so the command never runs and the caller
 * may run it again. On any other sandbox (the original was retired and replaced) the claim proves
 * nothing, so the outcome is unknown and the command is never run again automatically.
 */
export async function settleAttempt(use: SandboxUse, attempt: AttemptUndecidedError): Promise<"retry" | RemoteOutcome> {
  if (use.sandbox.id !== attempt.sandboxId) {
    return { kind: "unknown", reason: "the sandbox it was sent to stopped answering and was replaced before it could be checked, so it was not run again" };
  }
  const answer = await use.sandbox
    .run(claimScript(attempt.attempt), { timeoutSeconds: 10 })
    .then((r) => r.output.trim().split(/\s+/).at(-1))
    .catch(() => undefined);
  if (answer === "never-started") return "retry";
  if (answer === "started") return { kind: "unknown", reason: "it started, but the sandbox stopped while it ran" };
  use.retire("whether a command started could not be checked");
  return { kind: "unknown", reason: "the sandbox did not answer whether it started, so the sandbox was replaced" };
}
