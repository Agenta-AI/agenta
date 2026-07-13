/**
 * Durable agent-scoped files mounted beside each session cwd and linked into it.
 * See `docs/design/agent-workflows/projects/agent-mounts/plan.md`, decision D3.
 */

import { lstat, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  MountCredentials,
  SandboxExec,
  SignMountDeps,
} from "./mount.ts";

export const AGENT_MOUNT_ENV_VAR = "AGENTA_AGENT_MOUNT_DIR";
export const AGENT_README_NAME = "README.md";
export const AGENT_FILES_LINK_NAME = "agent-files";
export const AGENT_README_CONTENT = `This folder belongs to your agent.
Files here persist across all sessions and runs of this agent.
Your working directory persists only for the current session.
Without a session, the working directory does not persist.
Concurrent runs share this folder, so the last writer wins for each file.
`;

function defaultLog(msg: string): void {
  process.stderr.write(`[sandbox_agent/agent-mount] ${msg}\n`);
}

export function agentMountPath(cwd: string): string {
  return `${cwd}-agent`;
}

/**
 * Bind-and-sign the agent's durable mount. Returns null when signing fails so a missing agent
 * mount never aborts the turn. Keep this failure contract in sync with
 * `signSessionMountCredentials` in `mount.ts`.
 */
export async function signAgentMountCredentials(
  artifactId: string,
  deps: SignMountDeps,
  name: string = "default",
): Promise<MountCredentials | null> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBase}/mounts/agents/sign?artifact_id=${encodeURIComponent(artifactId)}&name=${encodeURIComponent(name)}`;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
      // Bound the sign so a hung endpoint fails open (null mount) instead of
      // stalling environment acquisition on the agent mount forever.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log(
        `sign HTTP ${res.status} artifact=${artifactId} name=${name} — running without this mount`,
      );
      return null;
    }
    const body = (await res.json()) as {
      mount?: { project_id?: string };
      credentials?: {
        endpoint?: string;
        region?: string;
        bucket?: string;
        prefix?: string;
        access_key?: string;
        secret_key?: string;
        session_token?: string;
        expires_at?: string;
      };
    };
    const c = body.credentials;
    if (!c?.bucket || !c.prefix || !c.access_key || !c.secret_key) {
      log(`sign returned no usable credentials artifact=${artifactId}`);
      return null;
    }
    return {
      endpoint: c.endpoint,
      region: c.region ?? "us-east-1",
      bucket: c.bucket,
      prefix: c.prefix,
      accessKey: c.access_key,
      secretKey: c.secret_key,
      sessionToken: c.session_token,
      expiresAt: c.expires_at,
      projectId:
        typeof body.mount?.project_id === "string"
          ? body.mount.project_id
          : undefined,
    };
  } catch (err) {
    log(
      `sign failed artifact=${artifactId}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
    return null;
  }
}

export interface SeedAgentReadmeDeps {
  writeFile?: typeof writeFile;
  log?: (msg: string) => void;
}

export async function seedAgentReadme(
  mountPath: string,
  deps: SeedAgentReadmeDeps = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const write = deps.writeFile ?? writeFile;
  const readmePath = join(mountPath, AGENT_README_NAME);
  try {
    // `wx` makes concurrent first-run seeds atomic without overwriting an agent-edited README.
    await write(readmePath, AGENT_README_CONTENT, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      log(
        `README seed failed ${readmePath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
      );
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function seedAgentReadmeRemote(
  sandbox: SandboxExec,
  mountPath: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const readmePath = join(mountPath, AGENT_README_NAME);
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: [
        "-c",
        `[ -e ${shellQuote(readmePath)} ] || printf %s ${shellQuote(AGENT_README_CONTENT)} > ${shellQuote(readmePath)}`,
      ],
      timeoutMs: 30_000,
    });
    if (res?.exitCode !== 0) {
      log(`remote README seed failed ${readmePath}: exit ${res?.exitCode}`);
    }
  } catch (err) {
    log(
      `remote README seed failed ${readmePath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
}

export interface LinkAgentFilesDeps {
  lstat?: typeof lstat;
  readlink?: typeof readlink;
  symlink?: typeof symlink;
  unlink?: typeof unlink;
  log?: (msg: string) => void;
}

export async function linkAgentFiles(
  cwd: string,
  mountPath: string,
  deps: LinkAgentFilesDeps = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const inspect = deps.lstat ?? lstat;
  const readLink = deps.readlink ?? readlink;
  const createLink = deps.symlink ?? symlink;
  const removeLink = deps.unlink ?? unlink;
  const linkPath = join(cwd, AGENT_FILES_LINK_NAME);
  let replaceExisting = false;
  try {
    // Keep a correct-target symlink even when dangling. Replace a non-symlink or wrong-target
    // link because geesefs silently degrades symlinks to empty files across remounts.
    const stats = await inspect(linkPath);
    if (stats.isSymbolicLink() && (await readLink(linkPath)) === mountPath) {
      return;
    }
    replaceExisting = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log(
        `agent-files check failed ${linkPath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
      );
      return;
    }
  }
  if (replaceExisting) {
    try {
      await removeLink(linkPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log(
          `agent-files unlink failed ${linkPath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
        );
      }
    }
  }
  try {
    await createLink(mountPath, linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      log(
        `agent-files link failed ${linkPath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
      );
    }
  }
}

export async function linkAgentFilesRemote(
  sandbox: SandboxExec,
  cwd: string,
  mountPath: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const linkPath = join(cwd, AGENT_FILES_LINK_NAME);
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: [
        "-c",
        `[ "$(readlink ${shellQuote(linkPath)} 2>/dev/null)" = ${shellQuote(mountPath)} ] || { rm -f ${shellQuote(linkPath)} && ln -s ${shellQuote(mountPath)} ${shellQuote(linkPath)}; }`,
      ],
      timeoutMs: 30_000,
    });
    if (res?.exitCode !== 0) {
      log(`remote agent-files link failed ${linkPath}: exit ${res?.exitCode}`);
    }
  } catch (err) {
    log(
      `remote agent-files link failed ${linkPath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
}
