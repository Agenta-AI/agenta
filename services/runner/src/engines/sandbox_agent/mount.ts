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
 * space. The remote (Daytona/E2B) path mounts INSIDE the sandbox and is layered on top of this.
 *
 * Uses scoped STS credentials instead of a bucket-wide master key.
 */

import { execFile, spawn } from "node:child_process";
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
  /**
   * The mount's owning project id, surfaced from the sign response's `mount` object. It is the
   * only project scope the runner can trust for this request (the /run wire carries no project
   * id today), so session keep-alive keys its pool on `<projectId>:<sessionId>`. Absent when the
   * response omitted the mount object; keep-alive then refuses to park (no safe key source).
   */
  projectId?: string;
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
 * Bind-and-sign one of the session's durable mounts. The API upserts the named mount for the
 * session (get-or-create) and returns credentials scoped to its own prefix. `name` defaults to
 * `"cwd"` (the original single-mount case, byte-identical call shape); any other name signs an
 * ADDITIONAL session-scoped mount with its own `mount_id` and prefix — same shape, same sign
 * endpoint, just a different name (per-harness transcript mounts use this). Returns null when
 * the store is not configured (503) or the call fails — the caller then runs without this mount,
 * never aborting the turn for a missing one.
 */
export async function signSessionMountCredentials(
  sessionId: string,
  deps: SignMountDeps,
  name: string = "cwd",
): Promise<MountCredentials | null> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBase}/sessions/mounts/sign?session_id=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}`;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: deps.authorization,
      },
    });
    if (!res.ok) {
      // 503 = storage not configured (mounts disabled). Any non-2xx → run without this mount.
      log(
        `sign HTTP ${res.status} session=${sessionId} name=${name} — running without this mount`,
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
      // The owning project id (from the `mount` object), used only as the keep-alive pool key
      // scope. A string in JSON (the API serializes the UUID); undefined when omitted.
      projectId:
        typeof body.mount?.project_id === "string"
          ? body.mount.project_id
          : undefined,
    };
  } catch (err) {
    log(
      `sign failed session=${sessionId}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`,
    );
    return null;
  }
}

// --- per-harness session-scoped transcript mounts --- //
//
// Beyond cwd, each harness keeps its own on-disk session/transcript directory that
// `session/load` reads back. That directory must survive sandbox teardown the same way cwd
// does: same shape (sign -> geesefs-mount), its own `mount_id`/prefix per (session, harness,
// dir). Credentials are explicitly EXCLUDED — the runner re-injects managed creds per run
// (`daemon.ts`), so persisting auth to the durable store is a real risk, not a convenience.
//
// Direct-mount is the default: the harness writes straight through geesefs at the mounted
// path, accepting append-heavy-JSONL write amplification. Copy-around-lifecycle (stage
// locally, sync in/out at turn boundaries) is a documented fallback ONLY if direct-mount shows
// ENOTCONN/perf problems in practice — not implemented here; the seam is
// `HarnessSessionMount.path`, which any future copy-around step would stage into instead of
// mounting live.

/** One harness's durable session/transcript directory to mount, relative to `$HOME`. */
export interface HarnessSessionMount {
  /** Mount name passed to `POST /sessions/mounts/sign?name=...`; unique per (session, harness, dir). */
  name: string;
  /** Absolute in-sandbox/on-host path this mount binds to (home-relative, credentials excluded). */
  path: string;
}

/**
 * The session-scoped directories a harness needs durable, EXCLUDING credential/auth files.
 * `homeDir` is the resolved `$HOME` for the sandbox (differs local vs Daytona); each entry's
 * `path` is `${homeDir}/<harness transcript dir>`. Returns `[]` for a harness with nothing to
 * mount (unknown/unlisted harness) — callers then mount only cwd, unchanged from today.
 *
 * Claude: `~/.claude/projects` (session transcripts) — explicitly NOT `~/.claude` whole (that
 * would sweep in `.credentials.json` / the OAuth cache). Pi: `~/.pi/agent/sessions`, or
 * `$PI_CODING_AGENT_DIR/sessions` when that env overrides Pi's home-relative default.
 */
export function harnessSessionMounts(
  acpAgent: string,
  homeDir: string,
  piAgentDir?: string,
): HarnessSessionMount[] {
  if (acpAgent === "claude") {
    return [{ name: "claude-projects", path: `${homeDir}/.claude/projects` }];
  }
  if (acpAgent === "pi") {
    const base = piAgentDir?.trim() || `${homeDir}/.pi/agent`;
    return [{ name: "pi-sessions", path: `${base}/sessions` }];
  }
  return [];
}

/** geesefs endpoint flag: an empty endpoint means real AWS S3 (geesefs default). */
function endpointArgs(endpoint?: string): string[] {
  return endpoint ? ["--endpoint", endpoint] : [];
}

/**
 * The geesefs argv for mounting `bucket:prefix` at `cwd`. Endpoint is overridable so the remote
 * path can substitute the public tunnel URL for the in-network one. `--fsync-on-close` favors
 * durability over latency, so a turn's writes land before teardown.
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
    // -f keeps geesefs in the FOREGROUND as a tracked child of the runner. Without it geesefs
    // double-forks into a detached daemon that is reparented to init and dies under write-heavy
    // load (a `git clone`'s pack write/rename drops the FUSE channel -> ENOTCONN). Foreground
    // survives the same workload; the runner owns the process and tears it down on teardown.
    "-f",
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

/**
 * True only when `cwd` is a mountpoint AND the FUSE backend still serves I/O.
 *
 * `mountpoint -q` returns true for a STALE geesefs node — one whose daemon died (expired
 * STS creds, SeaweedFS restart) leaving the kernel entry behind. That node answers every
 * file op with ENOTCONN ("Transport endpoint is not connected"), yet a bare `mountpoint`
 * check trusts it, so `mountStorage` short-circuits and the next session inherits a dead cwd.
 * Probe with a real access (`ls -A`) and treat ENOTCONN as NOT-mounted so the caller remounts.
 */
async function isMounted(
  cwd: string,
  log: (m: string) => void,
): Promise<boolean> {
  try {
    await pExecFile("mountpoint", ["-q", cwd]);
  } catch {
    return false;
  }
  // Mountpoint present — verify the backend is alive, not a stale ENOTCONN node.
  try {
    await pExecFile("ls", ["-A", cwd]);
    log(`mount alive: ${cwd}`);
    return true;
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    log(
      `STALE mountpoint (present but I/O fails) ${cwd}: ${msg.slice(0, 200)} — treating as unmounted`,
    );
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
 * plain (ephemeral) cwd rather than aborting (best-effort).
 */
export async function mountStorage(
  cwd: string,
  creds: MountCredentials,
  deps: MountStorageDeps = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  const checkMounted = deps.checkMounted ?? ((c: string) => isMounted(c, log));

  log(
    `mountStorage begin cwd=${cwd} bucket=${creds.bucket} prefix=${creds.prefix} ` +
      `endpoint=${creds.endpoint ?? "(aws-default)"} sts=${creds.sessionToken ? "yes" : "no"} ` +
      `expiresAt=${creds.expiresAt ?? "(none)"}`,
  );

  if (await checkMounted(cwd)) {
    log(`already mounted (verified alive): ${cwd}`);
    return true;
  }

  // Not alive: a prior stale node may still occupy the mountpoint. Force-detach before
  // remounting, else geesefs fails "mountpoint is not empty" / re-stacks on the dead node.
  await unmountStorage(cwd, { log });

  const args = geesefsArgs(creds, cwd);
  const env = credEnv(creds);

  // geesefs runs FOREGROUND (-f): spawn it as a long-lived child and poll for the mount to come
  // alive, rather than awaiting exit (it never exits). Detached + unref'd so it is not killed when
  // this call returns but survives for the run; teardown unmounts it (fusermount -uz reaps it).
  const run =
    deps.runGeesefs ??
    (async (a: string[], e: Record<string, string>) => {
      const child = spawn("geesefs", a, {
        env: { ...process.env, ...e },
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr?.on("data", (d) => {
        const s = String(d).trim();
        if (s) log(`geesefs stderr: ${s.slice(0, 400)}`);
      });
      child.unref();
      // Poll up to ~15s for the mountpoint to serve I/O; geesefs logs "successfully mounted"
      // within ~1s normally. Resolve as soon as it's alive; the caller re-verifies after.
      for (let i = 0; i < 30; i++) {
        if (await isMounted(cwd, () => {})) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    });

  try {
    log(`geesefs mount argv: ${args.join(" ")}`);
    await run(args, env);
    // Confirm the new mount actually serves I/O — a still-not-alive cwd means geesefs failed
    // to mount (invalid STS creds, store unreachable) or did not come up within the poll window.
    if (!(await checkMounted(cwd))) {
      log(
        `mount reported success but cwd is NOT alive ${creds.bucket}:${creds.prefix} -> ${cwd} ` +
          `— likely expired/invalid STS creds or store unreachable`,
      );
      return false;
    }
    log(`mounted ${creds.bucket}:${creds.prefix} -> ${cwd} (verified alive)`);
    return true;
  } catch (err) {
    log(
      `mount failed ${creds.bucket}:${creds.prefix} -> ${cwd}: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`,
    );
    return false;
  }
}

export interface UnmountStorageDeps {
  runUnmount?: (cwd: string) => Promise<void>;
  // Resolve to "gone" | "mounted" | "inconclusive"; only "gone" allows the caller to delete.
  checkMountpoint?: (
    cwd: string,
  ) => Promise<"gone" | "mounted" | "inconclusive">;
  log?: (msg: string) => void;
}

/**
 * Unmount the durable cwd (LOCAL). Best-effort: the data lives in the store, so a failed
 * unmount loses nothing. Lazy unmount (`-uz`) so a still-busy mount (harness holding the cwd
 * at teardown) detaches now and reaps once released, instead of failing "busy" and leaking —
 * leaked geesefs mounts later go stale and serve ENOTCONN to any file op on the cwd.
 *
 * Returns true only when the mountpoint is CONFIRMED gone afterward. Callers that then delete
 * the cwd MUST gate the delete on this return, not on fusermount merely not throwing — a lazy
 * unmount can leave the FUSE node live, and deleting through it corrupts the durable store.
 */
export async function unmountStorage(
  cwd: string,
  deps: UnmountStorageDeps = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  const run =
    deps.runUnmount ??
    (async (c: string) => {
      await pExecFile("fusermount", ["-uz", c]);
    });
  try {
    await run(cwd);
  } catch (err) {
    log(
      `unmount failed ${cwd}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    return false;
  }
  // Lazy unmount can leave the node attached until the dead daemon's last ref drops; that
  // residual node serves ENOTCONN and poisons the next session. Verify it's actually gone.
  const check = deps.checkMountpoint ?? defaultCheckMountpoint;
  const state = await check(cwd);
  if (state === "gone") {
    log(`unmounted ${cwd} (confirmed gone)`);
    return true;
  }
  log(`unmount verify ${cwd}: ${state}; not deleting`);
  return false;
}

// `mountpoint -q` exits 0 = still mounted, 1 = not a mountpoint (confirmed gone). Any other
// failure (missing binary, unexpected error) is NOT confirmation, so the caller never deletes
// through a possibly-live mount.
async function defaultCheckMountpoint(
  cwd: string,
): Promise<"gone" | "mounted" | "inconclusive"> {
  try {
    await pExecFile("mountpoint", ["-q", cwd]);
    return "mounted";
  } catch (err) {
    return (err as { code?: number }).code === 1 ? "gone" : "inconclusive";
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
 * `ngrok` service (compose profile `remote`) tunnels the store, and its agent API lists the
 * active tunnels. Returns null when no tunnel is up (then the remote mount is skipped, not fatal).
 */
export async function discoverTunnelEndpoint(
  deps: TunnelDeps = {},
): Promise<string | null> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const api =
    deps.ngrokApi ??
    process.env.AGENTA_MOUNTS_TUNNEL_API ??
    "http://ngrok:4040";
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
    // Idempotent + ensure the dir exists before mounting.
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

export interface MountHarnessSessionDirsDeps {
  apiBase: string;
  authorization: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  signSessionMountCredentials?: typeof signSessionMountCredentials;
  mountStorageRemote?: typeof mountStorageRemote;
}

/**
 * Sign and mount every durable session-scoped dir a harness needs, INSIDE a remote sandbox.
 * Local runs call none of this: `~/.claude` there is the runner container's own disk (see
 * module doc), so this function is Daytona/remote-only by construction (it always mounts
 * INSIDE the given sandbox, mirroring `mountStorageRemote`). Each dir is its own sign call +
 * its own geesefs mount, same shape as the cwd mount, additive and best-effort: a failed sign
 * or mount for one dir is logged and skipped, never aborts the turn or blocks the other dirs.
 */
export async function mountHarnessSessionDirs(
  sandbox: SandboxExec,
  sessionId: string,
  dirs: HarnessSessionMount[],
  tunnelEndpoint: string,
  deps: MountHarnessSessionDirsDeps,
): Promise<void> {
  if (dirs.length === 0) return;
  const log = deps.log ?? defaultLog;
  const signMount =
    deps.signSessionMountCredentials ?? signSessionMountCredentials;
  const mountRemote = deps.mountStorageRemote ?? mountStorageRemote;

  for (const dir of dirs) {
    const creds = await signMount(
      sessionId,
      {
        apiBase: deps.apiBase,
        authorization: deps.authorization,
        fetchImpl: deps.fetchImpl,
        log,
      },
      dir.name,
    );
    if (!creds) {
      log(`harness session mount '${dir.name}' not signed — skipping ${dir.path}`);
      continue;
    }
    await mountRemote(sandbox, dir.path, creds, {
      endpoint: tunnelEndpoint,
      log,
    });
  }
}
