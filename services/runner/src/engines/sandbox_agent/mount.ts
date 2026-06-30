/**
 * Durable session cwd via geesefs (FUSE-over-S3).
 *
 * Makes the agent's working directory a live mount of the session's object-store prefix,
 * so a file written in one turn survives sandbox teardown and reappears in the next. The
 * runner never holds the store's master key: it asks the API to mint short-lived,
 * prefix-scoped credentials (`POST /sessions/mounts/sign`), then geesefs-mounts with those.
 *
 * This module covers the LOCAL sandbox: the daemon runs on this host, so the cwd is a host
 * directory and geesefs mounts on-host — the signed credentials never enter agent-reachable
 * space. The remote (Daytona/E2B) path mounts INSIDE the sandbox and is layered on top of
 * this in M9.
 *
 * Mirrors the PoC recipe in `poc-persistent-sessions/sessions/demo/sidecar/sandbox-provider.js`
 * (`geesefsScript`), but with scoped STS credentials instead of the bucket-wide master key.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

/** Signed, scoped, short-lived credentials for one mount (mirror of the API `MountCredentials`). */
export interface MountCredentials {
  endpoint?: string;
  region: string;
  bucket: string;
  /** geesefs key suffix: `<project_id>/<mount_id>` (the durable prefix, slug-independent). */
  prefix: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  expiresAt?: string;
}

export interface SignMountDeps {
  apiBase: string;
  authorization: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

function defaultLog(msg: string): void {
  process.stderr.write(`[sandbox_agent/mount] ${msg}\n`);
}

/**
 * Bind-and-sign the session's durable cwd mount. The API upserts the one `cwd` mount for the
 * session (get-or-create) and returns credentials scoped to its prefix. Returns null when the
 * store is not configured (503) or the call fails — the caller then runs on an ephemeral cwd,
 * never aborting the turn for a missing mount.
 */
export async function signSessionMountCredentials(
  sessionId: string,
  deps: SignMountDeps,
): Promise<MountCredentials | null> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBase}/sessions/mounts/sign?session_id=${encodeURIComponent(sessionId)}`;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
    });
    if (!res.ok) {
      // 503 = storage not configured (mounts disabled). Any non-2xx → run without a mount.
      log(
        `sign HTTP ${res.status} session=${sessionId} — running without a durable cwd`,
      );
      return null;
    }
    const body = (await res.json()) as {
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
      log(`sign returned no usable credentials session=${sessionId}`);
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
    };
  } catch (err) {
    log(
      `sign failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
    return null;
  }
}

/** geesefs endpoint flag: an empty endpoint means real AWS S3 (geesefs default). */
function endpointArgs(endpoint?: string): string[] {
  return endpoint ? ["--endpoint", endpoint] : [];
}

/**
 * The geesefs argv for mounting `bucket:prefix` at `cwd`. Endpoint is overridable so the remote
 * path can substitute the public tunnel URL for the in-network one. `--fsync-on-close` matches
 * the PoC: durability over latency, so a turn's writes land before teardown.
 */
function geesefsArgs(
  creds: MountCredentials,
  cwd: string,
  endpoint?: string,
): string[] {
  return [
    ...endpointArgs(endpoint ?? creds.endpoint),
    "--region",
    creds.region,
    "--no-detect",
    "--fsync-on-close",
    "-o",
    "allow_other",
    `${creds.bucket}:${creds.prefix}`,
    cwd,
  ];
}

/** AWS_* env carrying the scoped credentials — they ride env, never argv (no process-table leak). */
function credEnv(creds: MountCredentials): Record<string, string> {
  const env: Record<string, string> = {
    AWS_ACCESS_KEY_ID: creds.accessKey,
    AWS_SECRET_ACCESS_KEY: creds.secretKey,
  };
  if (creds.sessionToken) env.AWS_SESSION_TOKEN = creds.sessionToken;
  return env;
}

async function isMounted(cwd: string): Promise<boolean> {
  try {
    await pExecFile("mountpoint", ["-q", cwd]);
    return true;
  } catch {
    return false;
  }
}

export interface MountStorageDeps {
  /** Injectable command runner for tests; defaults to execFile(geesefs ...). */
  runGeesefs?: (args: string[], env: Record<string, string>) => Promise<void>;
  checkMounted?: (cwd: string) => Promise<boolean>;
  log?: (msg: string) => void;
}

/**
 * geesefs-mount the durable prefix at `cwd` on this host (LOCAL sandbox).
 *
 * Idempotent: a no-op when `cwd` is already a mountpoint. The scoped credentials ride the
 * child env (AWS_*), never the argv, so they do not leak to the process table. Returns true
 * when the mount is live, false when it could not be established — the caller proceeds on the
 * plain (ephemeral) cwd rather than aborting, mirroring the PoC's best-effort behavior.
 */
export async function mountStorage(
  cwd: string,
  creds: MountCredentials,
  deps: MountStorageDeps = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  const checkMounted = deps.checkMounted ?? isMounted;

  if (await checkMounted(cwd)) {
    log(`already mounted: ${cwd}`);
    return true;
  }

  const args = geesefsArgs(creds, cwd);
  const env = credEnv(creds);

  const run =
    deps.runGeesefs ??
    (async (a: string[], e: Record<string, string>) => {
      await pExecFile("geesefs", a, { env: { ...process.env, ...e } });
    });

  try {
    await run(args, env);
    log(`mounted ${creds.bucket}:${creds.prefix} -> ${cwd}`);
    return true;
  } catch (err) {
    log(
      `mount failed ${creds.bucket}:${creds.prefix} -> ${cwd}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    return false;
  }
}

export interface UnmountStorageDeps {
  runUnmount?: (cwd: string) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Unmount the durable cwd (LOCAL). Best-effort: the data lives in the store, so a failed
 * unmount loses nothing — only the host mountpoint lingers until the sandbox dir is reaped.
 */
export async function unmountStorage(
  cwd: string,
  deps: UnmountStorageDeps = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const run =
    deps.runUnmount ??
    (async (c: string) => {
      await pExecFile("fusermount", ["-u", c]);
    });
  try {
    await run(cwd);
    log(`unmounted ${cwd}`);
  } catch (err) {
    log(
      `unmount failed ${cwd}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
  }
}

// --- Remote (Daytona / E2B): geesefs runs INSIDE the sandbox ---------------- //

export interface TunnelDeps {
  /** ngrok agent API base (its local :4040 dashboard). */
  ngrokApi?: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/**
 * Resolve the public tunnel URL for the in-network store endpoint. A remote sandbox cannot
 * reach `seaweedfs:8333` on the compose network, so geesefs there must hit a public URL; the
 * `ngrok` service (M9 compose profile `remote`) tunnels the store, and its agent API lists the
 * active tunnels. Returns null when no tunnel is up (then the remote mount is skipped, not fatal).
 */
export async function discoverTunnelEndpoint(
  deps: TunnelDeps = {},
): Promise<string | null> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const api =
    deps.ngrokApi ?? process.env.AGENTA_MOUNTS_TUNNEL_API ?? "http://ngrok:4040";
  try {
    const res = await doFetch(`${api}/api/tunnels`);
    if (!res.ok) {
      log(`tunnel discovery HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      tunnels?: Array<{ public_url?: string; proto?: string }>;
    };
    const tunnels = body.tunnels ?? [];
    // Prefer https; fall back to any public_url.
    const https = tunnels.find(
      (t) => t.proto === "https" && !!t.public_url,
    )?.public_url;
    const any = tunnels.find((t) => !!t.public_url)?.public_url;
    return https ?? any ?? null;
  } catch (err) {
    log(
      `tunnel discovery failed: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
    return null;
  }
}

/** Minimal in-sandbox process runner (the Daytona/E2B handle's `runProcess`). */
export interface SandboxExec {
  runProcess: (opts: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }) => Promise<{ exitCode?: number; stderr?: unknown } | undefined>;
}

export interface MountStorageRemoteDeps {
  /** Public endpoint geesefs uses from inside the sandbox (the tunnel URL). */
  endpoint: string;
  mountTimeoutMs?: number;
  log?: (msg: string) => void;
}

/**
 * geesefs-mount the durable prefix at `cwd` INSIDE a remote sandbox (Daytona/E2B).
 *
 * geesefs runs in the sandbox, so the store endpoint is the public tunnel URL (not the
 * in-network one). The scoped credentials cross into the sandbox via the process env — they
 * are short-lived and prefix-scoped, the one place creds reach agent-adjacent space, by design.
 * Best-effort: a non-zero exit returns false and the run proceeds on the plain cwd.
 */
export async function mountStorageRemote(
  sandbox: SandboxExec,
  cwd: string,
  creds: MountCredentials,
  deps: MountStorageRemoteDeps,
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  try {
    // Idempotent + ensure the dir exists, mirroring the PoC's geesefs script preamble.
    await sandbox.runProcess({
      command: "sh",
      args: ["-c", `mkdir -p ${cwd}`],
      timeoutMs: 30_000,
    });
    const res = await sandbox.runProcess({
      command: "geesefs",
      args: geesefsArgs(creds, cwd, deps.endpoint),
      env: credEnv(creds),
      timeoutMs: deps.mountTimeoutMs ?? 60_000,
    });
    if (res?.exitCode !== 0) {
      log(
        `remote mount exit=${res?.exitCode}: ${String(res?.stderr).slice(-300)}`,
      );
      return false;
    }
    log(`remote mounted ${creds.bucket}:${creds.prefix} -> ${cwd}`);
    return true;
  } catch (err) {
    log(
      `remote mount failed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    return false;
  }
}
