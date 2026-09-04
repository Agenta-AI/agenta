/**
 * Kill the shell command a STOPPED Codex turn left running inside the parked sandbox.
 *
 * WHY THIS EXISTS. `cancel-turn.ts` makes a Stop keep the sandbox warm. Parking is what makes
 * this leak visible: before it, every Stop deleted the sandbox, and the delete killed whatever
 * the turn had started. Measured on the integration stack, local sandbox provider, 2026-09-03:
 *
 * | Harness | ACP `session/cancel` answered | The shell child after the Stop |
 * | --- | --- | --- |
 * | Pi (`pi_core`) | yes | gone inside 0.2 s |
 * | Claude Code | yes | gone inside 0.2 s |
 * | Codex | yes, in 48 ms | STILL RUNNING, until the park window closed at 60 s |
 *
 * WHY CODEX DIFFERS, AND WHY THE FIX CANNOT LIVE IN THE BRIDGE. Pi and Claude run their shell
 * tool inside a process the ACP adapter owns, so the adapter holds the child's pid and kills it
 * when the run's `AbortSignal` fires. Codex does not: `@agentclientprotocol/codex-acp` is a thin
 * JavaScript bridge over a Rust `codex app-server` subprocess, the shell child is a DIRECT child
 * of that Rust process, and the bridge's `cancel()` only sends the `turn/interrupt` JSON-RPC
 * request. Measured parent chain of the leaked child:
 *
 *   python3 -c ...            <- the leak
 *   codex app-server          <- the Rust core, spawns and abandons it
 *   node .../codex.js         <- the JS launcher
 *   node .../codex-acp        <- the ACP bridge, holds NO pid for the shell
 *   sandbox-agent server      <- the daemon
 *
 * The interrupt itself works: the prompt settles `cancelled` in about 48 ms. What the Rust core
 * does not do is kill the exec it started, and that core is a stripped vendored binary we pin
 * rather than build. A patch to the JS bridge would have to do the same `/proc` walk this module
 * does, in a bundle that is installed into the sandbox image and therefore needs a Daytona
 * SNAPSHOT REBUILD to ship. This module does it from the runner instead, through the sandbox
 * daemon's one-off process API, so it ships in the runner image alone and behaves identically on
 * the local and the Daytona provider.
 *
 * WHY IT IS SAFE FOR A WARM SESSION. The reap never touches the daemon, the ACP bridge, or the
 * `codex app-server` itself, so the native harness session survives exactly as it did before. Two
 * rules keep it off anything else the app-server legitimately owns, an stdio MCP server most of
 * all: only DESCENDANTS of the app-server are candidates, and only those younger than the turn
 * that was just stopped. An MCP server starts when the session is created, before the prompt, so
 * it is always older than the turn and is never selected.
 *
 * WHY A FAILURE IS NOT A DESTROY. The reap is best effort and cannot change the park decision. A
 * sandbox that would have been parked is still parked when the reap cannot run, because trading a
 * warm session away for a tidier process table is the wrong trade. The cost of not reaping is
 * bounded by the park window; the cost of destroying is a cold start on the user's next message.
 */

/** One row of `ps -eo pid=,ppid=,etimes=,args=`. */
export interface ProcRow {
  pid: number;
  ppid: number;
  /** Seconds since the process started. */
  etimes: number;
  args: string;
}

export const PS_ARGS = ["-eo", "pid=,ppid=,etimes=,args="];

/**
 * How many processes one reap may kill. A Stop leaks one command; anything near this number means
 * the anchor matched something it should not have, so the reap gives up rather than guessing.
 */
export const MAX_REAPED = 32;

/** Parse `ps -eo pid=,ppid=,etimes=,args=`. An unparseable line is dropped, never guessed at. */
export function parseProcessTable(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S.*)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      etimes: Number(match[3]),
      args: match[4],
    });
  }
  return rows;
}

/** Find exactly one `sandbox-agent server` whose `--port` value is this sandbox's port. */
export function findSandboxAgentServerPid(
  rows: ProcRow[],
  port: number | undefined,
): number | undefined {
  if (!Number.isInteger(port) || (port ?? 0) <= 0) return undefined;
  const expectedPort = String(port);
  const matches = rows.filter((row) => {
    const [executable, ...rest] = row.args.split(/\s+/);
    if (!executable) return false;
    const basename = executable.split("/").pop();
    const portIndex = rest.indexOf("--port");
    return (
      basename === "sandbox-agent" &&
      rest.includes("server") &&
      portIndex >= 0 &&
      rest[portIndex + 1] === expectedPort
    );
  });
  return matches.length === 1 ? matches[0].pid : undefined;
}

/**
 * Find the `codex app-server` process beneath this sandbox's daemon.
 *
 * The match is deliberately narrow: the executable's basename must be exactly `codex` AND the
 * command must carry the `app-server` subcommand. The JS launcher (`node .../codex.js app-server`)
 * also carries the subcommand, which is why the basename check is on the executable rather than
 * anywhere in the string. Returns `undefined` when there is not exactly one match below the
 * daemon, because killing on a guess is worse than leaving a `sleep` running for the park window.
 */
export function findAppServerPid(
  rows: ProcRow[],
  sandboxAgentPid: number,
): number | undefined {
  const childrenOf = new Map<number, ProcRow[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid);
    if (siblings) siblings.push(row);
    else childrenOf.set(row.ppid, [row]);
  }

  const descendants: ProcRow[] = [];
  const seen = new Set<number>([sandboxAgentPid]);
  const queue = [sandboxAgentPid];
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    for (const child of childrenOf.get(parent) ?? []) {
      if (seen.has(child.pid) || child.pid <= 1) continue;
      seen.add(child.pid);
      queue.push(child.pid);
      descendants.push(child);
    }
  }

  const matches = descendants.filter((row) => {
    const [executable, ...rest] = row.args.split(/\s+/);
    if (!executable) return false;
    const basename = executable.split("/").pop();
    return basename === "codex" && rest.includes("app-server");
  });
  return matches.length === 1 ? matches[0].pid : undefined;
}

/**
 * The pids a settled Codex Stop may kill.
 *
 * A candidate must be a descendant of the `codex app-server` process and must have started no
 * earlier than the stopped turn. Everything else, the app-server included, is left alone.
 */
export function selectLeakedExecPids(
  rows: ProcRow[],
  input: { appServerPid: number; turnElapsedSeconds: number },
): number[] {
  const childrenOf = new Map<number, ProcRow[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid);
    if (siblings) siblings.push(row);
    else childrenOf.set(row.ppid, [row]);
  }

  const selected: number[] = [];
  const seen = new Set<number>([input.appServerPid]);
  const queue = [input.appServerPid];
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    for (const child of childrenOf.get(parent) ?? []) {
      if (seen.has(child.pid) || child.pid <= 1) continue;
      seen.add(child.pid);
      queue.push(child.pid);
      // `etimes` is whole seconds, so a child started in the same second as the prompt reads
      // equal to the turn's elapsed time. `<=` keeps that child; anything OLDER than the turn
      // predates the prompt and belongs to the session, not to the turn that was stopped.
      if (child.etimes <= input.turnElapsedSeconds) selected.push(child.pid);
    }
  }
  return selected;
}

export interface ReapSandbox {
  runProcess?: (request: {
    command: string;
    args?: string[];
    timeoutMs?: number;
    maxOutputBytes?: number;
  }) => Promise<{ stdout: string; exitCode?: number | null }>;
}

export interface ReapLeakedExecInput {
  sandbox: ReapSandbox | undefined;
  /** Port passed to this sandbox's `sandbox-agent server --port`. */
  sandboxAgentPort: number | undefined;
  /** Milliseconds from the prompt being issued to the cancel settling. */
  turnElapsedMs: number;
  log: (message: string) => void;
  timeoutMs?: number;
}

export interface ReapResult {
  /** How many processes the reap killed. */
  killed: number;
  /** Why nothing was killed, when nothing was. */
  skipped?:
    | "no-run-process"
    | "ps-failed"
    | "no-app-server"
    | "nothing-to-reap"
    | "too-many"
    | "kill-failed";
}

/**
 * Best effort. Never throws, and every outcome is one log line the release gate can assert on.
 */
export async function reapLeakedExecChildren(
  input: ReapLeakedExecInput,
): Promise<ReapResult> {
  const runProcess = input.sandbox?.runProcess;
  if (!runProcess) {
    input.log("stage=harness_reap killed=0 skipped=no-run-process");
    return { killed: 0, skipped: "no-run-process" };
  }
  const timeoutMs = input.timeoutMs ?? 2_000;

  let rows: ProcRow[];
  try {
    const listing = await runProcess.call(input.sandbox, {
      command: "ps",
      args: PS_ARGS,
      timeoutMs,
      maxOutputBytes: 256 * 1024,
    });
    rows = parseProcessTable(listing.stdout ?? "");
    if (rows.length === 0) throw new Error("no parseable rows");
  } catch (error) {
    // A sandbox image without a `ps` that understands `-eo` lands here. That is a reason to leave
    // the leak alone, never a reason to delete a sandbox the user is about to write to.
    input.log(
      "stage=harness_reap killed=0 skipped=ps-failed error=" +
        (error instanceof Error ? error.message : String(error)).slice(0, 120),
    );
    return { killed: 0, skipped: "ps-failed" };
  }

  const sandboxAgentPid = findSandboxAgentServerPid(
    rows,
    input.sandboxAgentPort,
  );
  const appServerPid =
    sandboxAgentPid === undefined
      ? undefined
      : findAppServerPid(rows, sandboxAgentPid);
  if (appServerPid === undefined) {
    input.log("stage=harness_reap killed=0 skipped=no-app-server");
    return { killed: 0, skipped: "no-app-server" };
  }

  // FLOOR, not round or ceil. Every rounding error must make the reap kill LESS. On a cold first
  // turn the session's own helpers (Codex clones its plugin repo) start barely a second before
  // the prompt, so one second of generosity here is one second of overlap with processes the
  // session owns. A child born in the first second of a turn is not physically possible: the
  // model has to emit a tool call first.
  const turnElapsedSeconds = Math.floor(
    Math.max(0, input.turnElapsedMs) / 1000,
  );
  const pids = selectLeakedExecPids(rows, {
    appServerPid,
    turnElapsedSeconds,
  });
  if (pids.length === 0) {
    input.log(
      `stage=harness_reap killed=0 skipped=nothing-to-reap app_server=${appServerPid}`,
    );
    return { killed: 0, skipped: "nothing-to-reap" };
  }
  if (pids.length > MAX_REAPED) {
    input.log(
      `stage=harness_reap killed=0 skipped=too-many candidates=${pids.length} ` +
        `limit=${MAX_REAPED} app_server=${appServerPid}`,
    );
    return { killed: 0, skipped: "too-many" };
  }

  try {
    const result = await runProcess.call(input.sandbox, {
      command: "kill",
      args: ["-9", ...pids.map(String)],
      timeoutMs,
      maxOutputBytes: 4 * 1024,
    });
    if (result.exitCode != null && result.exitCode !== 0) {
      throw new Error(`kill exited with status ${result.exitCode}`);
    }
  } catch (error) {
    input.log(
      "stage=harness_reap killed=0 skipped=kill-failed error=" +
        (error instanceof Error ? error.message : String(error)).slice(0, 120),
    );
    return { killed: 0, skipped: "kill-failed" };
  }

  input.log(
    `stage=harness_reap killed=${pids.length} pids=${pids.join(",")} ` +
      `app_server=${appServerPid} turn_elapsed_s=${turnElapsedSeconds}`,
  );
  return { killed: pids.length };
}
