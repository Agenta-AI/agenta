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
 *  - `agent-files/.tools/bin/`       static binaries; copied to `<cwd>/.tools/bin/` (local disk).
 *  - `agent-files/.tools/setup.sh`   the model's own restore script (`uv venv` from a
 *                                    requirements file, `npm install` from a package.json, ...);
 *                                    run once here, before the session, with `<cwd>` as cwd.
 *
 * Nothing here can fail a turn. A missing `.tools/` is the normal case and costs one `test -d`.
 * A setup script that fails or times out is logged and the session still opens; the model sees
 * its tool missing and reports it, which is the failure mode the prompt prepares it for.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";

import { shellQuote, type SandboxExec } from "./mount.ts";

export const AGENT_TOOLS_DIR_NAME = ".tools";
export const AGENT_TOOLS_SETUP_NAME = "setup.sh";
/** The restore runs before the session, so a slow script delays the first turn. Cap it. */
export const AGENT_TOOLS_SETUP_TIMEOUT_MS = 120_000;

export interface AgentToolsSetupExec {
  /** Run `sh -c <script>` in `cwd`; resolve with the exit code, or throw. */
  run: (opts: {
    script: string;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
  }) => Promise<{ exitCode?: number }>;
}

export type AgentToolsSetupResult =
  | { status: "absent" }
  | { status: "ok"; durationMs: number }
  | { status: "failed"; exitCode?: number; durationMs: number }
  | { status: "error"; message: string; durationMs: number };

/**
 * The restore script. Posix sh, no bashisms: the Daytona base and node:*-slim both run dash.
 * `cp` (not `ln -s`) for the binaries so they execute from local disk. The model's `setup.sh`
 * runs with the session cwd as its cwd and sees where things are through two env vars.
 */
export function agentToolsSetupScript(mountPath: string, cwd: string): string {
  const tools = shellQuote(join(mountPath, AGENT_TOOLS_DIR_NAME));
  const localTools = shellQuote(join(cwd, AGENT_TOOLS_DIR_NAME));
  const setup = shellQuote(
    join(mountPath, AGENT_TOOLS_DIR_NAME, AGENT_TOOLS_SETUP_NAME),
  );
  return [
    `[ -d ${tools} ] || exit 0`,
    `mkdir -p ${localTools}/bin`,
    `if [ -d ${tools}/bin ]; then cp -f ${tools}/bin/* ${localTools}/bin/ 2>/dev/null; chmod +x ${localTools}/bin/* 2>/dev/null; fi`,
    `[ -f ${setup} ] || exit 0`,
    `exec sh ${setup}`,
  ].join("; ");
}

export function agentToolsSetupEnv(
  mountPath: string,
  cwd: string,
): Record<string, string> {
  return {
    AGENT_FILES: mountPath,
    AGENT_TOOLS_DIR: join(cwd, AGENT_TOOLS_DIR_NAME),
  };
}

/** Local provider: the sandbox is this process's host, so run the script here. */
export const localAgentToolsExec: AgentToolsSetupExec = {
  run: ({ script, cwd, env, timeoutMs }) =>
    new Promise((resolve, reject) => {
      execFile(
        "sh",
        ["-c", script],
        { cwd, env: { ...process.env, ...env }, timeout: timeoutMs },
        (err, _stdout, _stderr) => {
          if (err && typeof (err as { code?: unknown }).code !== "number") {
            reject(err);
            return;
          }
          resolve({
            exitCode: err ? ((err as { code?: number }).code ?? 1) : 0,
          });
        },
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

export async function runAgentToolsSetup(
  input: { mountPath: string; cwd: string },
  exec: AgentToolsSetupExec,
  deps: {
    log?: (msg: string) => void;
    timeoutMs?: number;
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
      script: agentToolsSetupScript(input.mountPath, input.cwd),
      cwd: input.cwd,
      env: agentToolsSetupEnv(input.mountPath, input.cwd),
      timeoutMs: deps.timeoutMs ?? AGENT_TOOLS_SETUP_TIMEOUT_MS,
    });
    const durationMs = Date.now() - started;
    if (exitCode === 0) {
      log(`agent tools setup ok ms=${durationMs}`);
      return { status: "ok", durationMs };
    }
    log(`agent tools setup failed exit=${exitCode ?? "?"} ms=${durationMs}`);
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
