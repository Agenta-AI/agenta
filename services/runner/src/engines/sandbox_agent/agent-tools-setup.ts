/**
 * Restore the agent's own tools before its session opens.
 *
 * The durable agent folder (`agent-files/`, a geesefs mount over S3) is the only place that
 * survives between sessions, and it has two properties that make it a bad HOME for tools: a
 * symlink stored there comes back as an empty file after a remount (a venv's `bin/python` and a
 * `node_modules/.bin/*` are symlinks, so an environment kept there breaks silently), and it is
 * many small reads over the network, so imports from it are slow. The convention the prompt
 * teaches the model is therefore: keep the DESCRIPTION durable, rebuild the environment on local
 * disk each session.
 *
 *  - `agent-files/.tools/bin/`       static binaries; copied to `<cwd>/.tools/bin/`.
 *  - `agent-files/.tools/setup.sh`   the model's own restore script (`uv venv` from a
 *                                    requirements file, `npm install` from a package.json, ...);
 *                                    run once here, before the session, with `<cwd>` as cwd.
 *
 * `<cwd>/.tools` is a symlink to a directory on LOCAL disk, never a folder on the mount: the
 * session cwd is itself a geesefs mount (local and Daytona alike), and a file's exec bit does not
 * survive there, so a binary copied into the cwd came back mode 644 and every call failed with
 * "Permission denied" (found by the T9 gate cell). The link is recreated every session, the same
 * way `agent-files` is, so geesefs degrading symlinks across remounts cannot hurt it.
 *
 * Three rules from the Codex review of the first cut:
 *  - `setup.sh` is code the agent owner uploaded, run unattended. It runs ONLY when the run's
 *    permission posture is `allow`, the same posture under which a model shell call runs with
 *    no approval. Under `ask` or `deny` the binaries are still restored and the script is
 *    skipped with a log line. It runs with an allowlisted environment, never the runner's
 *    `process.env` (which carries the runner token and the Daytona key).
 *  - The link step never deletes user data. It replaces a symlink, a degraded link (an empty
 *    file, what geesefs makes of a link after a remount), or an empty directory. A non-empty
 *    directory at `<cwd>/.tools` is left alone and the restore is skipped with a diagnostic.
 *  - `bin/` is re-staged from scratch on every restore, so a binary removed from the durable
 *    folder does not linger as an executable on local disk.
 *
 * Nothing here can fail a turn. A missing `.tools/` is the normal case and costs one `test -d`.
 * A setup script that fails or times out is logged and the session still opens; the model sees
 * its tool missing and reports it, which is the failure mode the prompt prepares it for.
 */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { shellQuote, type SandboxExec } from "./mount.ts";

export const AGENT_TOOLS_DIR_NAME = ".tools";
export const AGENT_TOOLS_SETUP_NAME = "setup.sh";
/** The restore runs before the session, so a slow script delays the first turn. Cap it. */
export const AGENT_TOOLS_SETUP_TIMEOUT_MS = 120_000;
/** After SIGTERM to the process group, how long before SIGKILL. */
export const AGENT_TOOLS_KILL_GRACE_MS = 5_000;

/** Exit codes the restore script uses so the caller can name what happened. */
export const AGENT_TOOLS_EXIT_OCCUPIED = 64;
export const AGENT_TOOLS_EXIT_LINK_FAILED = 65;
export const AGENT_TOOLS_EXIT_COPY_FAILED = 66;

/**
 * The only variables a user-authored `setup.sh` inherits from the host process. Locale, time
 * zone, and the browser path so `uv`, `npm`, and Playwright behave; nothing that authenticates
 * the runner to anything. `AGENT_FILES` and `AGENT_TOOLS_DIR` are added by the caller.
 */
export const AGENT_TOOLS_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "PLAYWRIGHT_BROWSERS_PATH",
] as const;

export interface AgentToolsSetupExec {
  /** Run `sh -c <script>` in `cwd`; resolve with the exit code, or throw. */
  run: (opts: {
    script: string;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<{ exitCode?: number }>;
}

export type AgentToolsSetupResult =
  | { status: "absent" }
  | { status: "ok"; durationMs: number; setupRan: boolean }
  | { status: "skipped"; reason: string; durationMs: number }
  | { status: "failed"; exitCode?: number; durationMs: number }
  | { status: "error"; message: string; durationMs: number };

/**
 * The local-disk directory `<cwd>/.tools` links to. Keyed by the cwd's basename (the session's
 * mount directory name), so two sessions never share one. Under the OS temp dir locally; under
 * `/tmp` inside a remote sandbox, where the runner's own tmpdir means nothing. Deterministic on
 * purpose: a remount recovery recomputes it from the cwd instead of carrying state.
 */
export function agentToolsLocalDir(cwd: string, remote: boolean): string {
  const base = remote ? "/tmp" : tmpdir();
  return join(base, "agenta-tools", basename(cwd));
}

/**
 * Replace `<cwd>/.tools` with a link to the local dir. Replaces a symlink, a degraded link (an
 * empty regular file), or an empty directory; refuses a non-empty directory (user data) with
 * exit 64. Posix sh, no bashisms: the Daytona base and node:*-slim both run dash.
 */
export function agentToolsLinkScript(cwd: string, localDir: string): string {
  const link = shellQuote(join(cwd, AGENT_TOOLS_DIR_NAME));
  const local = shellQuote(localDir);
  return [
    `mkdir -p ${local} || exit ${AGENT_TOOLS_EXIT_LINK_FAILED}`,
    `if [ -L ${link} ]; then rm -f ${link} || exit ${AGENT_TOOLS_EXIT_LINK_FAILED}`,
    `elif [ -d ${link} ]; then rmdir ${link} 2>/dev/null || exit ${AGENT_TOOLS_EXIT_OCCUPIED}`,
    `elif [ -e ${link} ]; then { [ -f ${link} ] && [ ! -s ${link} ] && rm -f ${link}; } || exit ${AGENT_TOOLS_EXIT_OCCUPIED}`,
    `fi`,
    `ln -sfn ${local} ${link} || exit ${AGENT_TOOLS_EXIT_LINK_FAILED}`,
  ].join("; ");
}

/**
 * The restore script: link, then re-stage `bin/` from the durable folder, then (optionally) run
 * the owner's `setup.sh`. Every required step checks its own exit; only the setup script's own
 * exit code passes through unchanged.
 */
export function agentToolsSetupScript(
  mountPath: string,
  cwd: string,
  localDir: string,
  opts: { runSetup: boolean } = { runSetup: true },
): string {
  const tools = shellQuote(join(mountPath, AGENT_TOOLS_DIR_NAME));
  const local = shellQuote(localDir);
  const setup = shellQuote(
    join(mountPath, AGENT_TOOLS_DIR_NAME, AGENT_TOOLS_SETUP_NAME),
  );
  const lines = [
    `[ -d ${tools} ] || exit 0`,
    agentToolsLinkScript(cwd, localDir),
    // Fresh staging: a binary deleted from the durable folder must not survive here.
    `{ rm -rf ${local}/bin && mkdir -p ${local}/bin; } || exit ${AGENT_TOOLS_EXIT_COPY_FAILED}`,
    `if [ -d ${tools}/bin ]; then for f in ${tools}/bin/*; do [ -f "$f" ] || continue; { cp -f "$f" ${local}/bin/ && chmod +x ${local}/bin/"$(basename "$f")"; } || exit ${AGENT_TOOLS_EXIT_COPY_FAILED}; done; fi`,
  ];
  if (opts.runSetup) {
    lines.push(`[ -f ${setup} ] || exit 0`, `exec sh ${setup}`);
  }
  return lines.join("; ");
}

export function agentToolsSetupEnv(
  mountPath: string,
  localDir: string,
  host: NodeJS.ProcessEnv = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AGENT_TOOLS_ENV_ALLOWLIST) {
    const value = host[key];
    if (value) env[key] = value;
  }
  env.AGENT_FILES = mountPath;
  env.AGENT_TOOLS_DIR = localDir;
  return env;
}

/**
 * Local provider: the sandbox is this process's host, so run the script here. The shell gets
 * its own process group so a timeout or an abort kills the whole tree (an installer the script
 * started included), TERM first, KILL after a grace period. The env is exactly what the caller
 * passes: the allowlist, never `process.env`.
 */
export const localAgentToolsExec: AgentToolsSetupExec = {
  run: ({ script, cwd, env, timeoutMs, signal }) =>
    new Promise((resolve, reject) => {
      const child = spawn("sh", ["-c", script], {
        cwd,
        env,
        detached: true,
        stdio: "ignore",
      });
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      const killGroup = (sig: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, sig);
        } catch {
          /* already gone */
        }
      };
      const stop = () => {
        killGroup("SIGTERM");
        killTimer = setTimeout(
          () => killGroup("SIGKILL"),
          AGENT_TOOLS_KILL_GRACE_MS,
        );
        killTimer.unref?.();
      };
      const timer = setTimeout(stop, timeoutMs);
      timer.unref?.();
      const onAbort = () => stop();
      signal?.addEventListener("abort", onAbort, { once: true });
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      child.once("error", (err) => finish(() => reject(err)));
      child.once("exit", (code, sig) =>
        finish(() => resolve({ exitCode: code ?? (sig ? 143 : 1) })),
      );
    }),
};

/** Remote provider: run inside the sandbox through its process runner. */
export function remoteAgentToolsExec(
  sandbox: SandboxExec,
): AgentToolsSetupExec {
  return {
    run: async ({ script, cwd, env, timeoutMs }) => {
      const res = await sandbox.runProcess({
        command: "sh",
        args: ["-c", script],
        cwd,
        env,
        timeoutMs,
      });
      return { exitCode: res?.exitCode };
    },
  };
}

function describeExit(exitCode: number | undefined): string | undefined {
  switch (exitCode) {
    case AGENT_TOOLS_EXIT_OCCUPIED:
      return "<cwd>/.tools holds user data; left it alone";
    case AGENT_TOOLS_EXIT_LINK_FAILED:
      return "could not link <cwd>/.tools to local disk";
    case AGENT_TOOLS_EXIT_COPY_FAILED:
      return "could not stage .tools/bin on local disk";
    default:
      return undefined;
  }
}

export async function runAgentToolsSetup(
  input: {
    mountPath: string;
    cwd: string;
    localDir: string;
    /** False under an `ask`/`deny` posture: restore binaries, skip the owner's script. */
    runSetup: boolean;
  },
  exec: AgentToolsSetupExec,
  deps: {
    log?: (msg: string) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
    hostEnv?: NodeJS.ProcessEnv;
    /** Existence check for `.tools/`, so the common no-tools case costs no shell at all. */
    hasToolsDir?: () => Promise<boolean>;
  } = {},
): Promise<AgentToolsSetupResult> {
  const log = deps.log ?? (() => {});
  if (deps.hasToolsDir && !(await deps.hasToolsDir()))
    return { status: "absent" };
  const started = Date.now();
  try {
    const { exitCode } = await exec.run({
      script: agentToolsSetupScript(
        input.mountPath,
        input.cwd,
        input.localDir,
        { runSetup: input.runSetup },
      ),
      cwd: input.cwd,
      env: agentToolsSetupEnv(input.mountPath, input.localDir, deps.hostEnv),
      timeoutMs: deps.timeoutMs ?? AGENT_TOOLS_SETUP_TIMEOUT_MS,
      signal: deps.signal,
    });
    const durationMs = Date.now() - started;
    if (exitCode === 0) {
      log(
        `agent tools setup ok ms=${durationMs} setup=${input.runSetup ? "ran-if-present" : "skipped-by-permission"}`,
      );
      return { status: "ok", durationMs, setupRan: input.runSetup };
    }
    const reason = describeExit(exitCode);
    if (exitCode === AGENT_TOOLS_EXIT_OCCUPIED && reason) {
      log(`agent tools setup skipped ms=${durationMs}: ${reason}`);
      return { status: "skipped", reason, durationMs };
    }
    log(
      `agent tools setup failed exit=${exitCode ?? "?"} ms=${durationMs}${reason ? `: ${reason}` : ""}`,
    );
    return { status: "failed", exitCode, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = String(err instanceof Error ? err.message : err).slice(
      0,
      200,
    );
    log(`agent tools setup error ms=${durationMs}: ${message}`);
    return { status: "error", message, durationMs };
  }
}

/**
 * Recreate the `<cwd>/.tools` link only, after a cwd remount replaced the link with an empty
 * file. Never runs the owner's script: recovery must not repeat installation side effects.
 */
export async function relinkAgentTools(
  input: { cwd: string; localDir: string },
  exec: AgentToolsSetupExec,
  deps: { log?: (msg: string) => void } = {},
): Promise<boolean> {
  try {
    const { exitCode } = await exec.run({
      script: agentToolsLinkScript(input.cwd, input.localDir),
      cwd: input.cwd,
      env: {},
      timeoutMs: 10_000,
    });
    if (exitCode !== 0)
      deps.log?.(`agent tools relink failed exit=${exitCode ?? "?"}`);
    return exitCode === 0;
  } catch (err) {
    deps.log?.(
      `agent tools relink error: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    return false;
  }
}

/** Local provider teardown: the per-session tools dir dies with the environment. */
export async function removeAgentToolsLocalDir(
  localDir: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  try {
    await rm(localDir, { recursive: true, force: true });
  } catch (err) {
    deps.log?.(
      `agent tools local dir cleanup failed path=${localDir}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
}
