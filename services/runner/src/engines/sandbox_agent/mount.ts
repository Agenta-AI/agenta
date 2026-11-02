/**
 * Durable session cwd via geesefs (FUSE-over-S3).
 *
 * Makes the agent's working directory a live mount of the session's object-store prefix,
 * so a file written in one turn survives sandbox teardown and reappears in the next. The
 * runner never holds the store's master key: it asks the API to mint short-lived,
 * prefix-scoped credentials (`POST /sessions/mounts/sign`), then geesefs-mounts with those.
 *
 * This module covers the LOCAL sandbox: the daemon runs on this host, so the cwd is a host
 * directory and geesefs mounts on-host. The signed credentials stay out of the agent process env
 * and argv, but a same-user local process can inspect the mount process, so Pi redaction still
 * treats them as visible. The remote (Daytona/E2B) path mounts inside the sandbox.
 *
 * Uses scoped STS credentials instead of a bucket-wide master key.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import {
  throwIfAcquireAborted,
  waitForAcquire,
} from "../../environment/acquire-abort.ts";

const pExecFile = promisify(execFile);

/** POSIX single-quote escaping for values interpolated into `sh -c` strings. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Signed, scoped, short-lived credentials for one mount (mirror of the API `MountCredentials`). */
export interface MountCredentials {
  endpoint?: string;
  region: string;
  bucket: string;
  /** geesefs key suffix: the mount's stored prefix, `mounts/<scope_id>/<mount_id>` (slug-independent). */
  prefix: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  expiresAt?: string;
  /**
   * The mount's owning project id, surfaced from the sign response's `mount` object. It is the
   * FALLBACK project scope for session keep-alive: the pool prefers the service-stamped
   * `runContext.project.id` and falls back to this mount scope when the run carries no stamped
   * project (see `poolKeyFor`). Absent when the response omitted the mount object; keep-alive
   * then parks only if the run context supplied a scope, and refuses to park when neither does.
   */
  projectId?: string;
}

export interface SignMountDeps {
  apiBase: string;
  authorization: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  signal?: AbortSignal;
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
      signal: deps.signal,
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
    throwIfAcquireAborted(deps.signal);
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

/** True if a remote sandbox can reach the store directly (public S3); false for in-network stores that need the tunnel. */
export function storeReachableFromSandbox(endpoint?: string): boolean {
  if (!endpoint) return true;
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (!host.includes(".")) return false; // compose service name
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    return false;
  }
  return true;
}

/** Opt-in geesefs behaviors for one mount; every caller that passes nothing gets today's argv. */
export interface GeesefsOptions {
  /**
   * Keep file modes (and owners) in each object's metadata, so an executable bit survives a
   * remount and is seen by every later mount with this flag. Without it every file reads 0644.
   */
  enablePerms?: boolean;
  /**
   * Give up a read after this many attempts (geesefs retries forever by default). A read of a file
   * that got smaller in the store behind the mount otherwise never ends: geesefs retries the short
   * read for good, and the reader cannot be killed.
   */
  readRetryAttempts?: number;
}

/**
 * Read attempts for mounts whose reader must never hang: the runner process itself reads the
 * `inprocess` drive. About 31 s of retries (1, 2, 4, 8 and 16 s apart), enough for a dropped
 * connection; a read of a file that shrank behind the mount then returns what it has.
 */
export const BOUNDED_READ_RETRY_ATTEMPTS = 6;

/**
 * The geesefs argv for mounting `bucket:prefix` at `cwd`. Endpoint is overridable so the remote
 * path can substitute the public tunnel URL for the in-network one. `--fsync-on-close` makes a
 * close start the upload; it does not wait for it (measured), so
 * a writer that needs its data in the store before another view reads it must `fsync` or `sync -f`.
 */
function geesefsArgs(
  creds: MountCredentials,
  cwd: string,
  endpoint?: string,
  foreground = true,
  options: GeesefsOptions = {},
): string[] {
  return [
    ...endpointArgs(endpoint ?? creds.endpoint),
    "--region",
    creds.region,
    "--no-detect",
    "--fsync-on-close",
    ...(options.enablePerms ? ["--enable-perms"] : []),
    ...(options.readRetryAttempts ? ["--read-retry-attempts", String(options.readRetryAttempts)] : []),
    // -f keeps geesefs foreground as a tracked child locally (a detached daemon dies under
    // write-heavy load -> ENOTCONN); remote it must detach, else the blocking RPC times out.
    ...(foreground ? ["-f"] : []),
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
export async function isMounted(
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

export interface WaitForMountReadyOptions {
  /** One readiness probe (production: `isMounted`). */
  check: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  /** True once the geesefs process exited: a foreground geesefs that exited serves nothing. */
  exited?: () => boolean;
  timeoutMs?: number;
  firstIntervalMs?: number;
  maxIntervalMs?: number;
  now?: () => number;
}

/**
 * Probe until the mount serves I/O, geesefs exits, or the timeout passes. The interval starts at
 * 50 ms and doubles to a 100 ms cap, so a mount is seen within about 100 ms of attaching instead
 * of on the next 500 ms tick.
 */
export async function waitForMountReady(
  opts: WaitForMountReadyOptions,
): Promise<boolean> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.timeoutMs ?? 15_000);
  const maxInterval = opts.maxIntervalMs ?? 100;
  let interval = opts.firstIntervalMs ?? 50;
  for (;;) {
    if (await opts.check()) return true;
    if (opts.exited?.()) return false;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await opts.sleep(Math.min(interval, remaining));
    interval = Math.min(interval * 2, maxInterval);
  }
}

export interface MountStorageDeps {
  /** Injectable mount attempt for tests; the returned stop handle prevents a late FUSE attach. */
  runGeesefs?: (
    args: string[],
    env: Record<string, string>,
  ) => Promise<{ stop: () => Promise<void> } | void>;
  checkMounted?: (cwd: string) => Promise<boolean>;
  /** The FUSE device path to check before a real mount attempt. Tests point it elsewhere. */
  fuseDevice?: string;
  /** Opt-in geesefs behaviors; absent keeps today's argv. */
  geesefs?: GeesefsOptions;
  /** Injectable command/probe seams while retaining production unmountStorage behavior. */
  unmountDeps?: UnmountStorageDeps;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

/** Set once the missing FUSE device was reported, so the warning is logged once per process. */
let fuseMissingLogged = false;

/**
 * geesefs-mount the durable prefix at `cwd` on this host (LOCAL sandbox).
 *
 * Idempotent: a no-op when `cwd` is already a mountpoint. The scoped credentials ride the
 * child env (AWS_*), never the argv, so they do not leak to the process table. Returns true
 * when the mount is live, false when it could not be established AND detach was confirmed — the
 * caller then proceeds on the plain (ephemeral) cwd. Throws when detach is mounted/inconclusive,
 * because recursive ephemeral cleanup must never target a possibly-live FUSE mount.
 */
export async function mountStorage(
  cwd: string,
  creds: MountCredentials,
  deps: MountStorageDeps = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  const checkMounted = deps.checkMounted ?? ((c: string) => isMounted(c, log));
  const signal = deps.signal;
  throwIfAcquireAborted(signal);

  // A host without FUSE (Kubernetes without a FUSE device, e.g. GKE Autopilot) can never mount.
  // geesefs would exit at once, and the run falls back to throwaway storage either way, so skip
  // the attempt and say so once per runner process. An injected attempt (tests) mounts no FUSE.
  if (!deps.runGeesefs && !existsSync(deps.fuseDevice ?? "/dev/fuse")) {
    if (!fuseMissingLogged) {
      fuseMissingLogged = true;
      log(
        "WARN no /dev/fuse on this runner host: local drive mounts are skipped and runs use " +
          "throwaway storage. Give the runner a FUSE device to keep files between sessions.",
      );
    }
    return false;
  }

  log(
    `mountStorage begin cwd=${cwd} bucket=${creds.bucket} prefix=${creds.prefix} ` +
      `endpoint=${creds.endpoint ?? "(aws-default)"} sts=${creds.sessionToken ? "yes" : "no"} ` +
      `expiresAt=${creds.expiresAt ?? "(none)"}`,
  );

  if (await waitForAcquire(() => checkMounted(cwd), signal)) {
    log(`already mounted (verified alive): ${cwd}`);
    return true;
  }

  // Not alive: a prior stale node may still occupy the mountpoint. Force-detach before
  // remounting, else geesefs fails "mountpoint is not empty" / re-stacks on the dead node.
  const staleMountDetached = await unmountStorage(cwd, {
    ...deps.unmountDeps,
    log,
  });
  throwIfAcquireAborted(signal);
  if (!staleMountDetached) {
    throw new Error(
      "pre-mount detach could not be confirmed for " +
        cwd +
        "; refusing to start geesefs",
    );
  }

  const args = geesefsArgs(creds, cwd, undefined, true, deps.geesefs);
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
      let processExited = false;
      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => {
          processExited = true;
          resolve();
        });
      });
      child.stderr?.on("data", (d) => {
        const s = String(d).trim();
        if (s) log(`geesefs stderr: ${s.slice(0, 400)}`);
      });
      child.unref();
      // Wait up to ~15s for the mountpoint to serve I/O (geesefs mounts within ~1s normally), and
      // stop at once if the foreground geesefs exits. The caller re-verifies after.
      await waitForMountReady({
        check: () => isMounted(cwd, () => {}),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        exited: () => processExited,
      });
      return {
        stop: async () => {
          const waitForExit = async (): Promise<boolean> => {
            if (processExited) return true;
            await Promise.race([
              exited,
              new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
            ]);
            return processExited;
          };
          if (processExited) return;
          child.kill("SIGTERM");
          if (await waitForExit()) return;
          child.kill("SIGKILL");
          if (await waitForExit()) return;
          throw new Error(
            `geesefs process did not exit after SIGTERM and SIGKILL cwd=${cwd}`,
          );
        },
      };
    });

  let attempt: { stop: () => Promise<void> } | undefined;
  let failure: unknown;
  try {
    log(`geesefs mount argv: ${args.join(" ")}`);
    const started = await waitForAcquire(() => run(args, env), signal, {
      onLateSuccess: async (lateAttempt) => {
        await lateAttempt?.stop();
        await unmountStorage(cwd, { ...deps.unmountDeps, log });
      },
    });
    attempt = started || undefined;
    // Confirm the new mount actually serves I/O — a still-not-alive cwd means geesefs failed
    // to mount (invalid STS creds, store unreachable) or did not come up within the poll window.
    if (!(await waitForAcquire(() => checkMounted(cwd), signal))) {
      failure = new Error(
        `mount reported success but cwd is NOT alive ${creds.bucket}:${creds.prefix} -> ${cwd} ` +
          `— likely expired/invalid STS creds or store unreachable`,
      );
    } else {
      log(`mounted ${creds.bucket}:${creds.prefix} -> ${cwd} (verified alive)`);
      return true;
    }
  } catch (err) {
    failure = err;
  }

  if (signal?.aborted) {
    // Cleanup must not hold the Stop response open. A late `runGeesefs` result has its own hook
    // above; an already-returned attempt is stopped here, and both paths confirm the detach.
    void Promise.resolve()
      .then(async () => {
        await attempt?.stop();
        await unmountStorage(cwd, { ...deps.unmountDeps, log });
      })
      .catch(() => {});
    throwIfAcquireAborted(signal);
  }

  // Never detach/fallback while a failed geesefs attempt may still attach later.
  await attempt?.stop();
  const detached = await unmountStorage(cwd, { ...deps.unmountDeps, log });
  const detail = String(
    failure instanceof Error ? failure.message : failure,
  ).slice(0, 300);
  if (!detached) {
    throw new Error(
      `mount failed and detach could not be confirmed for ${cwd}; refusing ephemeral cwd fallback ` +
        `to avoid recursively deleting a live or indeterminate FUSE mount: ${detail}`,
    );
  }
  log(
    `mount failed ${creds.bucket}:${creds.prefix} -> ${cwd}; detach confirmed, ` +
      `running on ephemeral cwd: ${detail}`,
  );
  return false;
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

// util-linux `mountpoint -q` exits 0 = mounted and 32 = not a mountpoint. Some implementations
// use 1 for the latter. Node may surface child-process exit codes as numbers or strings. Every
// other failure remains inconclusive, so callers never delete through a possibly-live mount.
export function mountpointFailureState(
  error: unknown,
): "gone" | "inconclusive" {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === 1 || code === 32 || code === "1" || code === "32"
    ? "gone"
    : "inconclusive";
}

async function defaultCheckMountpoint(
  cwd: string,
): Promise<"gone" | "mounted" | "inconclusive"> {
  try {
    await pExecFile("mountpoint", ["-q", cwd]);
    return "mounted";
  } catch (err) {
    return mountpointFailureState(err);
  }
}

// --- Remote (Daytona / E2B): geesefs runs INSIDE the sandbox ---------------- //

export interface TunnelDeps {
  /**
   * The in-network store endpoint the tunnel has to forward to. Supplied, only a tunnel
   * whose own upstream is this endpoint is accepted; omitted, the first https tunnel wins.
   */
  storeEndpoint?: string;
  /** ngrok agent API base (its local :4040 dashboard). */
  ngrokApi?: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

/** host:port of a URL-ish string, for comparing a tunnel's upstream against ours. */
function upstreamAuthority(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return null;
  }
}

/**
 * Resolve the public tunnel URL for the in-network store endpoint. A remote sandbox cannot
 * reach `seaweedfs:8333` on the compose network, so geesefs there must hit a public URL; the
 * `ngrok-mounts` service (compose profile `with-tunnel`) tunnels it, and its agent API lists the
 * active tunnels. Returns null when no tunnel forwards to the store. The remote mount is then
 * skipped rather than failing the run, but the skip is NOT silent: the caller warns the operator
 * with the cause named, and tells the model the durable folder is unreachable this turn, because
 * a model whose history shows the folder working will otherwise report the user's saved work as
 * lost.
 *
 * The agent may be tunnelling something else entirely — the development compose files point it
 * at the platform's own ingress so providers can reach webhooks — so a tunnel is matched on the
 * upstream it forwards to and never on the order the agent lists them. Returning the wrong URL
 * would mount an HTTP API as an object store, which fails far from its cause.
 */
export async function discoverTunnelEndpoint(
  deps: TunnelDeps = {},
): Promise<string | null> {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetchImpl ?? fetch;
  const api = deps.ngrokApi ?? "http://ngrok-mounts:4040";
  try {
    const res = await doFetch(`${api}/api/tunnels`, { signal: deps.signal });
    if (!res.ok) {
      log(`tunnel discovery HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      tunnels?: Array<{
        public_url?: string;
        proto?: string;
        config?: { addr?: string };
      }>;
    };
    const tunnels = body.tunnels ?? [];

    if (deps.storeEndpoint) {
      const wanted = upstreamAuthority(deps.storeEndpoint);
      // An endpoint we cannot parse is a hard failure, never a licence to guess.
      if (!wanted) {
        log(
          `tunnel discovery: cannot parse store endpoint; ` +
            `not using another tunnel's URL`,
        );
        return null;
      }
      // One `ngrok http` can be listed twice, http and https over the same upstream.
      const matches = tunnels.filter(
        (t) =>
          !!t.public_url &&
          !!t.config?.addr &&
          upstreamAuthority(t.config.addr) === wanted,
      );
      if (matches.length === 0) {
        log(
          `tunnel discovery: no tunnel forwards to ${wanted} ` +
            `(${tunnels.length} tunnel(s) up); not using another tunnel's URL`,
        );
        return null;
      }
      const preferred = matches.find((t) => t.proto === "https") ?? matches[0];
      return preferred.public_url ?? null;
    }

    // No store endpoint to match against: prefer https, then any public_url.
    const https = tunnels.find(
      (t) => t.proto === "https" && !!t.public_url,
    )?.public_url;
    const any = tunnels.find((t) => !!t.public_url)?.public_url;
    return https ?? any ?? null;
  } catch (err) {
    throwIfAcquireAborted(deps.signal);
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
  }) => Promise<
    { exitCode?: number; stderr?: unknown; result?: unknown } | undefined
  >;
}

export interface MountStorageRemoteDeps {
  /** Tunnel URL for an in-network store; omit for a public store (geesefs uses `creds.endpoint`). */
  endpoint?: string;
  /** Opt-in geesefs behaviors; absent keeps the `daytona` provider's argv. */
  geesefs?: GeesefsOptions;
  mountTimeoutMs?: number;
  /**
   * How long the mount script waits for the mount to serve I/O (default 10 s, about what the old
   * twelve probe execs with a 500 ms pause took on Daytona). Each probe is capped at 5 s, and two
   * capped probes in a row end the wait early. Lowered by tests.
   */
  aliveTimeoutMs?: number;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

/** Exit code of the remote mount script when the mount did not serve I/O in time. */
export const REMOTE_MOUNT_NOT_ALIVE_EXIT = 11;

/** The geesefs log of one remote mount. Mounts run at the same time, so each has its own. */
export function remoteMountLogFile(cwd: string): string {
  return `/tmp/geesefs-mount${cwd.replace(/[^A-Za-z0-9._-]+/g, "_")}.log`;
}

/**
 * The whole remote mount as ONE `sh` script, so a mount costs one round trip to the sandbox
 * instead of four or more (detach, mkdir, start, then one exec per alive probe):
 *
 * 1. Detach whatever is at `cwd` (a reattached sandbox can hold a mount with expired credentials).
 * 2. `mkdir -p` the mountpoint.
 * 3. Start geesefs in the background, its output to `logFile`, so it does not hold the exec open.
 * 4. Probe `mountpoint -q && ls` every 50 ms until `aliveSeconds` pass. Each probe is capped at
 *    5 s (a dead-but-registered FUSE node hangs it), and two capped probes in a row stop the
 *    wait, as two timed-out probe execs did before.
 *
 * Exit 0 means the mount serves I/O. Exit `REMOTE_MOUNT_NOT_ALIVE_EXIT` means it did not, and the
 * script prints the tail of the geesefs log for the operator line. The caller detaches on any
 * non-zero exit. The credentials ride the exec env, never this text.
 */
export function remoteMountScript(
  cwd: string,
  geesefsArgs: string[],
  logFile: string,
  aliveSeconds: number,
): string {
  const q = shellQuote;
  return [
    `cwd=${q(cwd)}`,
    `log=${q(logFile)}`,
    `fusermount -u "$cwd" 2>/dev/null || umount -l "$cwd" 2>/dev/null || true`,
    `mkdir -p "$cwd"`,
    `geesefs --log-file "$log" ${geesefsArgs.map(q).join(" ")} >>"$log" 2>&1 &`,
    `end=$(( $(date +%s) + ${Math.max(1, Math.ceil(aliveSeconds))} )); hung=0`,
    `while :; do`,
    `  timeout 5 sh -c 'mountpoint -q "$1" && ls "$1" >/dev/null 2>&1' _ "$cwd"; rc=$?`,
    `  [ "$rc" -eq 0 ] && exit 0`,
    // 124 is a GNU timeout, 143 and 137 a busybox one.
    `  case "$rc" in 124|137|143) hung=$((hung+1)); [ "$hung" -ge 2 ] && break ;; *) hung=0 ;; esac`,
    `  [ "$(date +%s)" -ge "$end" ] && break`,
    `  sleep 0.05 2>/dev/null || sleep 1`,
    `done`,
    `tail -5 "$log" 2>/dev/null`,
    `exit ${REMOTE_MOUNT_NOT_ALIVE_EXIT}`,
  ].join("\n");
}

/**
 * Best-effort unmount inside the remote sandbox after a mount attempt that never came alive (or
 * blew up before we could tell). geesefs may have registered the FUSE mount without ever serving
 * I/O; leaving it in place shadows the cwd, so every later file operation hangs until the run
 * limit kills the turn. Errors are swallowed and logged, never thrown — the caller is already on
 * its way to returning false and must not fail harder because cleanup itself failed.
 */
async function unmountRemoteDeadMount(
  sandbox: SandboxExec,
  cwd: string,
  log: (m: string) => void,
): Promise<void> {
  try {
    await sandbox.runProcess({
      command: "sh",
      args: [
        "-c",
        `fusermount -u ${shellQuote(cwd)} 2>/dev/null || umount -l ${shellQuote(cwd)} 2>/dev/null || true`,
      ],
      timeoutMs: 10_000,
    });
  } catch (err) {
    log(
      `remote dead-mount cleanup failed ${cwd}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
}

/**
 * geesefs-mount the durable prefix at `cwd` INSIDE a remote sandbox (Daytona/E2B). geesefs must
 * detach (no `-f`) because `runProcess` blocks until the command exits. Best-effort: a failed
 * mount returns false and the run proceeds on the plain cwd.
 */
export async function mountStorageRemote(
  sandbox: SandboxExec,
  cwd: string,
  creds: MountCredentials,
  deps: MountStorageRemoteDeps,
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  throwIfAcquireAborted(deps.signal);
  try {
    // One exec: detach, mkdir, start geesefs in the background, and wait for it to serve I/O.
    // See `remoteMountScript`. geesefs detaches (no `-f`) so the exec can return.
    const args = geesefsArgs(creds, cwd, deps.endpoint, false, deps.geesefs);
    log(`remote geesefs argv: ${args.join(" ")}`);
    const res = await waitForAcquire(
      () =>
        sandbox.runProcess({
          command: "sh",
          args: [
            "-c",
            remoteMountScript(
              cwd,
              args,
              remoteMountLogFile(cwd),
              (deps.aliveTimeoutMs ?? 10_000) / 1000,
            ),
          ],
          env: credEnv(creds),
          timeoutMs: deps.mountTimeoutMs ?? 60_000,
        }),
      deps.signal,
      {
        onLateSuccess: async () => {
          await unmountRemoteDeadMount(sandbox, cwd, log);
        },
      },
    );
    if (res?.exitCode !== 0) {
      if (res?.exitCode === REMOTE_MOUNT_NOT_ALIVE_EXIT) {
        log(
          `remote mount not alive ${creds.bucket}:${creds.prefix} -> ${cwd}` +
            `; geesefs: ${String(res?.result ?? res?.stderr ?? "").slice(-400)}`,
        );
      } else {
        log(
          `remote mount exit=${res?.exitCode}: ${String(res?.stderr).slice(-300)}`,
        );
      }
      // geesefs may have registered the FUSE node without ever serving I/O. Left in place it
      // shadows cwd for every later file op, so detach it before giving up on this mount.
      await unmountRemoteDeadMount(sandbox, cwd, log);
      return false;
    }
    log(
      `remote mounted ${creds.bucket}:${creds.prefix} -> ${cwd} (verified alive)`,
    );
    return true;
  } catch (err) {
    if (deps.signal?.aborted) {
      void unmountRemoteDeadMount(sandbox, cwd, log);
      throwIfAcquireAborted(deps.signal);
    }
    log(
      `remote mount failed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    // Same reasoning as the not-alive branch above: whatever failed, a FUSE node may already be
    // registered at cwd, so clear it before returning false rather than leaving a dead mount.
    await unmountRemoteDeadMount(sandbox, cwd, log);
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
  signal?: AbortSignal;
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
  // Tunnel URL for an in-network store; undefined for a public store (uses `creds.endpoint`).
  tunnelEndpoint: string | undefined,
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
        signal: deps.signal,
      },
      dir.name,
    );
    if (!creds) {
      // A resumable harness session expects its transcript dir mounted. Same structured degrade
      // signal as the session/agent mounts (behavior unchanged; the run proceeds without it).
      log(
        `mount degraded kind=harness_transcript cause=sign_returned_no_mount session=${sessionId} dir=${dir.name}`,
      );
      continue;
    }
    await mountRemote(sandbox, dir.path, creds, {
      endpoint: tunnelEndpoint,
      log,
      signal: deps.signal,
    });
  }
}
