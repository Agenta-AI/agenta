/**
 * Refresh the geesefs views of the durable folders at the start of every turn, for every provider.
 *
 * A geesefs mount keeps what it saw of the store for a minute. The files pane writes and uploads
 * straight to the store, and another conversation of the agent writes the agent folder through its
 * own mount, so without a refresh the first reads and commands of a turn can see the old version
 * for up to a minute. Setting geesefs's refresh attribute (`.invalidate`) on a mount's root drops
 * the cached state of the whole tree; each folder and file is checked again on its next use. It
 * costs one listing of the root, about 50 ms on a 1,000-file folder (measured).
 *
 * - `inprocess`: the harness host marks the turn (`startTurn`); the first tool call of the turn
 *   refreshes the command sandbox's mounts before it runs, and fails with a sentence when it cannot.
 * - `local`: the mounts are on the runner host; refreshed here.
 * - `daytona`: the mounts are in the sandbox; refreshed with one call into it.
 *
 * For `local` and `daytona`, a refresh that fails or does not answer in time is logged and the
 * turn goes on as it did before this refresh existed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { InRunnerSandboxHandle } from "./runtime-contracts.ts";

type Log = (message: string) => void;

const execFileAsync = promisify(execFile);

/** Set the refresh attribute on each path; print how many failed, and exit non-zero when any did. */
export const REFRESH_ROOTS_SCRIPT = `import os,sys
failed=0
for p in sys.argv[1:]:
    try: os.setxattr(p, ".invalidate", b"1")
    except OSError: failed+=1
print(failed)
sys.exit(1 if failed else 0)
`;

const REFRESH_TIMEOUT_MS = 10_000;

export interface TurnStartViews {
  /** The environment's sandbox handle: a harness host in the runner, or a sandbox-agent handle. */
  sandbox: unknown;
  /** Local provider: the durable cwd mount on the runner host. */
  mountedCwd: string | undefined;
  /** The agent folder's mount (runner host locally, in-sandbox path on Daytona). */
  agentMountedPath?: string | undefined;
  /** Daytona: set when the cwd mount in the sandbox succeeded. */
  installedMountExpiries: { cwd?: number };
}

export interface TurnStartPlan {
  isDaytona: boolean;
  harnessInRunner: boolean;
  workspace: { cwd: string };
}

/** Refresh the durable folders' views for this turn. Never throws. */
export async function refreshDriveViewsAtTurnStart(env: TurnStartViews, plan: TurnStartPlan, log: Log): Promise<void> {
  if (plan.harnessInRunner) {
    (env.sandbox as InRunnerSandboxHandle | undefined)?.startTurn();
    return;
  }
  const t0 = Date.now();
  try {
    if (plan.isDaytona) {
      const roots = [env.installedMountExpiries.cwd !== undefined ? plan.workspace.cwd : undefined, env.agentMountedPath].filter((p): p is string => !!p);
      const sandbox = env.sandbox as { runProcess?: (opts: { command: string; args: string[]; timeoutMs: number }) => Promise<unknown> } | undefined;
      if (roots.length === 0 || typeof sandbox?.runProcess !== "function") return;
      const result = await Promise.race([
        sandbox.runProcess({ command: "python3", args: ["-c", REFRESH_ROOTS_SCRIPT, ...roots], timeoutMs: REFRESH_TIMEOUT_MS }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in time")), REFRESH_TIMEOUT_MS + 2_000).unref()),
      ]);
      const exitCode = (result as { exitCode?: unknown } | undefined)?.exitCode;
      if (typeof exitCode === "number" && exitCode !== 0) throw new Error(`a root was not refreshed (exit code ${exitCode})`);
    } else {
      const roots = [env.mountedCwd, env.agentMountedPath].filter((p): p is string => !!p);
      if (roots.length === 0) return;
      await execFileAsync("python3", ["-c", REFRESH_ROOTS_SCRIPT, ...roots], { timeout: REFRESH_TIMEOUT_MS });
    }
    log(`[turn-start] drive views refreshed ms=${Date.now() - t0}`);
  } catch (err) {
    log(`[turn-start] drive view refresh failed (views may show files up to a minute old): ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
  }
}
