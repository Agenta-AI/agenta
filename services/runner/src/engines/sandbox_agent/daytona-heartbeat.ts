import { loadRunnerConfig } from "../../config/runner-config.ts";
import type { SessionEnvironment } from "./runtime-contracts.ts";

/**
 * Keeps a Daytona sandbox from autostopping during a long turn. Daytona stops a sandbox it sees as
 * idle once the autostop interval passes, and a long turn can look idle to it. While `run` is
 * pending, this refreshes the sandbox's activity every third of the autostop interval (at least
 * every 10 seconds). A tick is skipped while the previous refresh is still running. A failed
 * refresh is logged and never fails the turn. The timer stops when `run` settles, on every path.
 *
 * Every turn entry point (the keep-alive dispatch, its cold path, and `runSandboxAgent`) wraps its
 * `runTurn` call in this, so the heartbeat does not depend on which route served the run.
 */
export async function withDaytonaActivityHeartbeat<T>(
  env: Pick<SessionEnvironment, "plan" | "sandbox">,
  run: () => Promise<T>,
): Promise<T> {
  const sandbox = env.sandbox?.sandbox;
  const sandboxId = env.sandbox?.sandboxId;
  if (!env.plan?.isDaytona || !sandbox?.refreshActivity || !sandboxId) {
    return run();
  }

  const autostopMinutes = loadRunnerConfig().daytona.autostopMinutes;
  const heartbeatIntervalMs = Math.max(
    10_000,
    Math.floor((autostopMinutes * 60_000) / 3),
  );

  let refreshInFlight = false;
  const heartbeat = setInterval(() => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    void Promise.resolve(sandbox.refreshActivity!(sandboxId))
      .catch((error: unknown) => {
        process.stderr.write(
          `[daytona] heartbeat failed sandbox=${sandboxId}: ${String(
            error instanceof Error ? error.message : error,
          ).slice(0, 200)}\n`,
        );
      })
      .finally(() => {
        refreshInFlight = false;
      });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
  }
}
