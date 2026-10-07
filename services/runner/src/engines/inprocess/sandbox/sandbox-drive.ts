/**
 * The drive, mounted in the conversation's command sandbox: the session folder and the agent
 * folder, at the runner's paths for them.
 *
 * The drive holds the only copy of the files, and every file tool and command runs here, on this
 * mount; the runner mounts nothing. So there is nothing to copy in either direction, and a sandbox
 * that is stopped, replaced or lost takes only its own disk with it.
 *
 * - The mount is the `daytona` provider's (`mountStorageRemote`), with credentials signed for these
 *   two prefixes, nothing else. Pi's conversation file is in a prefix of its own that only the
 *   runner reaches, through the object store (`transcript-store.ts`), so no command can reach it,
 *   even with the credentials geesefs holds in the sandbox.
 * - Mounts do not survive a stop. They are made once per boot of a sandbox (`SandboxUse.boot`). A
 *   mount cannot be replaced in place: `fusermount -u` fails inside a Daytona sandbox (measured),
 *   and a dead geesefs leaves a node every access to which fails or hangs. So a sandbox
 *   whose mount died, or whose mount credentials are about to expire, is replaced (`MountLostError`
 *   tells the caller); the drive is intact, only the sandbox's own disk (`/tmp`) is lost.
 * - The sandbox reaches the store the way `daytona` does: directly when the store is public, or
 *   through the `ngrok-mounts` tunnel. When it cannot, the tool call fails with a sentence; chat
 *   does not need the sandbox and keeps working.
 * - geesefs runs with `--enable-perms` here, so a mode set in this sandbox holds for this mount.
 *   The mode is not kept in the store, so the run's executable skill files get theirs on
 *   every boot.
 */
import type { DaytonaSandbox } from "./daytona-api.ts";
import type { SandboxUse } from "./command-sandbox.ts";
import { linkAgentFilesRemote } from "../../sandbox_agent/agent-mount.ts";
import { withPublicCode } from "../../sandbox_agent/errors.ts";
import { REFRESH_ROOTS_SCRIPT } from "../../sandbox_agent/turn-start-refresh.ts";
import {
  BOUNDED_READ_RETRY_ATTEMPTS,
  discoverTunnelEndpoint,
  mountStorageRemote,
  shellQuote,
  storeReachableFromSandbox,
  type MountCredentials,
  type SandboxExec,
} from "../../sandbox_agent/mount.ts";

type Log = (message: string) => void;

/** One durable root: the runner path it is mounted at, and the credentials of the runner's mount. */
export interface DriveRoot {
  root: string;
  credentials: () => MountCredentials | null;
}

/** Makes one root serve I/O in the sandbox. Production mounts geesefs; tests link a folder. */
export interface DriveMounter {
  /** Mount `creds` at `path` in `sandbox`; true once the path serves I/O. */
  mount(sandbox: DaytonaSandbox, path: string, creds: MountCredentials, signal?: AbortSignal): Promise<boolean>;
  /** A shell condition, true while `path` (quoted) is mounted and serves I/O. */
  mountedCheck(quotedPath: string): string;
  /** A command that drops the mounts' cached view of the store, so the next access sees it; exits non-zero on failure. */
  refreshCommand(quotedPaths: string[]): string;
}

export const DRIVE_UNREACHABLE_MESSAGE =
  "The agent's files could not be attached in the command sandbox (the file store cannot be reached from it), so nothing was read or changed. Try again later.";

export class DriveUnreachableError extends Error {
  constructor(detail: string) {
    super(DRIVE_UNREACHABLE_MESSAGE);
    this.name = "DriveUnreachableError";
    this.cause = detail;
  }
}

/** Replace the sandbox when the credentials its mounts were made with expire sooner than this. */
const REPLACE_BEFORE_EXPIRY_MS = 10 * 60_000;

/** The sandbox's mounts can no longer be trusted; the sandbox must be replaced. */
export class MountLostError extends Error {
  constructor(readonly reason: string) {
    super(`the command sandbox's mount of the agent's files ${reason}`);
    this.name = "MountLostError";
  }
}

/** `DaytonaSandbox.run` as the shared mount code's process runner. */
export function sandboxExec(sandbox: DaytonaSandbox, signal?: AbortSignal): SandboxExec {
  return {
    runProcess: async ({ command, args, cwd, env, timeoutMs }) => {
      const r = await sandbox.run([command, ...(args ?? []).map(shellQuote)].join(" "), {
        timeoutSeconds: Math.max(1, Math.ceil((timeoutMs ?? 60_000) / 1000)),
        ...(cwd ? { cwd } : {}),
        ...(env ? { env } : {}),
        ...(signal ? { signal } : {}),
      });
      return { exitCode: r.exitCode, result: r.output, stderr: "" };
    },
  };
}

/** The production mounter: geesefs in the sandbox, against the store or its tunnel. */
export function geesefsMounter(log: Log, discoverTunnel: (storeEndpoint: string | undefined) => Promise<string | undefined> = defaultTunnel(log)): DriveMounter {
  return {
    // Bounded: an access to a dead geesefs node can hang.
    mountedCheck: (path) => `mountpoint -q ${path} && timeout 5 ls ${path} >/dev/null 2>&1`,
    refreshCommand: (paths) => `python3 -c ${shellQuote(REFRESH_ROOTS_SCRIPT)} ${paths.join(" ")}`,
    async mount(sandbox, path, creds, signal) {
      const endpoint = storeReachableFromSandbox(creds.endpoint) ? undefined : await discoverTunnel(creds.endpoint);
      if (!storeReachableFromSandbox(creds.endpoint) && !endpoint) {
        throw new DriveUnreachableError("the store is not public and no tunnel forwards to it");
      }
      return mountStorageRemote(sandboxExec(sandbox, signal), path, creds, {
        ...(endpoint ? { endpoint } : {}),
        geesefs: { enablePerms: true, readRetryAttempts: BOUNDED_READ_RETRY_ATTEMPTS },
        log,
        ...(signal ? { signal } : {}),
      });
    },
  };
}

function defaultTunnel(log: Log) {
  return async (storeEndpoint: string | undefined) => (await discoverTunnelEndpoint({ ...(storeEndpoint ? { storeEndpoint } : {}), log })) ?? undefined;
}

/** `chmod` for the files whose mode differs, in one call. Prints nothing on success. */
export function modesScript(modes: Array<[string, number]>): string {
  const lines = modes.map(([path, mode]) => {
    const m = (mode & 0o7777).toString(8);
    return `[ "$(stat -c %a ${shellQuote(path)} 2>/dev/null)" = ${m} ] || chmod ${m} ${shellQuote(path)} 2>/dev/null || echo ${shellQuote(path)}`;
  });
  return lines.join("\n");
}

export class SandboxDrive {
  private roots: DriveRoot[];
  /** `<sandbox id>:<boot>` the mounts were made for; undefined when they must be made. */
  private mountedFor: string | undefined;
  private mountedExpiry: number | undefined;
  /** Executable files of the run's skills, by runner path, and their modes. */
  private readonly modes = new Map<string, number>();
  /** Mounting in progress: concurrent tool calls wait for the one mount. */
  private mounting: Promise<void> | undefined;
  /** Skill files whose mode is set on the current mount. */
  private readonly modesApplied = new Set<string>();

  constructor(
    roots: DriveRoot[],
    private readonly mounter: DriveMounter,
    private readonly options: {
      /** The session folder whose managed `agent-files` link names the agent folder. */
      agentLink?: { cwd: string; agentRoot: string };
      /** Where the runner's "/" sits in the sandbox: empty in production, a folder in tests. */
      sandboxPrefix?: string;
      log: Log;
    },
  ) {
    this.roots = roots;
  }

  /** The root at `path`, with its newest credentials. */
  root(path: string): DriveRoot | undefined {
    return this.roots.find((r) => r.root === path);
  }

  /** The runner paths of the drive's roots. */
  get rootPaths(): string[] {
    return this.roots.map((r) => r.root);
  }

  /** For each root, its sandbox path and a shell condition that holds while it is mounted. */
  get mountChecks(): Array<{ root: string; check: string }> {
    return this.roots.map((r) => {
      const root = this.inSandbox(r.root);
      return { root, check: this.mounter.mountedCheck(shellQuote(root)) };
    });
  }

  /** The command that refreshes the sandbox's view of every root. */
  get refreshCommand(): string {
    return this.mounter.refreshCommand(this.roots.map((r) => shellQuote(this.inSandbox(r.root))));
  }

  /**
   * `sandbox`, whose every call first checks that the drive's roots are mounted, and answers
   * `{"error":"unmounted"}` without running anything when one is not (geesefs died), so a tool never
   * writes to, or reads from, the empty folder a lost mount leaves behind.
   */
  guarded(sandbox: DaytonaSandbox): DaytonaSandbox {
    const checks = this.mountChecks.map((m) => `{ ${m.check}; }`).join(" && ");
    if (!checks) return sandbox;
    const refusal = shellQuote(JSON.stringify({ error: "unmounted", message: "a folder of the agent's files is not attached in the command sandbox" }));
    return new Proxy(sandbox, {
      get: (target, prop, receiver) =>
        prop === "run"
          ? (command: string, options: Parameters<DaytonaSandbox["run"]>[1]) => target.run(`if ${checks}; then ${command}; else echo ${refusal}; fi`, options)
          : Reflect.get(target, prop, receiver),
    });
  }

  /** A runner path as the sandbox sees it. */
  inSandbox(path: string): string {
    return (this.options.sandboxPrefix ?? "") + path;
  }

  /** The newest environment's credentials: an older one's may have expired. */
  setRoots(roots: DriveRoot[]): void {
    this.roots = roots;
  }

  addModes(modes: Map<string, number>): void {
    for (const [path, mode] of modes) this.modes.set(path, mode);
  }

  /** Whether the current boot of `sandboxId` has the drive mounted, as far as this runner knows. */
  mountedOn(sandboxId: string, boot: number): boolean {
    return this.mountedFor === `${sandboxId}:${boot}`;
  }

  /** When the credentials in hand expire (the earliest of the roots'); unknown counts as never. */
  private freshestExpiry(): number {
    const expiries = this.roots.map((r) => Date.parse(r.credentials()?.expiresAt ?? "")).map((n) => (Number.isFinite(n) ? n : Number.POSITIVE_INFINITY));
    return Math.min(...expiries);
  }

  /** Skill files added since the current mount set its modes. */
  get modesPending(): boolean {
    return [...this.modes.keys()].some((path) => !this.modesApplied.has(path));
  }

  /**
   * Mount every root unless this boot of the sandbox has them, then link `agent-files` and set the
   * skill modes. Throws `DriveUnreachableError` when a root cannot be mounted, and `MountLostError`
   * when the mounts' credentials are about to expire (the sandbox must be replaced).
   */
  async ensure(use: SandboxUse, signal?: AbortSignal): Promise<void> {
    for (;;) {
      const key = `${use.sandbox.id}:${use.boot}`;
      if (this.mountedFor === key) {
        // Replaced only for fresher credentials (a newer environment's); without them, a new mount
        // would expire just as soon.
        if (this.mountedExpiry !== undefined && this.mountedExpiry - Date.now() < REPLACE_BEFORE_EXPIRY_MS && this.freshestExpiry() > this.mountedExpiry + REPLACE_BEFORE_EXPIRY_MS) {
          this.mountedFor = undefined;
          throw new MountLostError("has credentials that are about to expire");
        }
        return;
      }
      if (!this.mounting) {
        this.mounting = this.mount(use, key, signal).finally(() => {
          this.mounting = undefined;
        });
        return this.mounting;
      }
      await this.mounting.catch(() => {});
    }
  }

  private async mount(use: SandboxUse, key: string, signal?: AbortSignal): Promise<void> {
    const t0 = Date.now();
    const credentials = this.roots.map((r) => ({ root: r.root, creds: r.credentials() }));
    const missing = credentials.find((c) => !c.creds);
    if (missing) throw withPublicCode(new DriveUnreachableError(`no credentials for ${missing.root}`), "runner_error");
    let results: boolean[];
    try {
      // In parallel: each mount is about 0.6 s of calls, mostly geesefs coming up (measured).
      results = await Promise.all(credentials.map((c) => this.mounter.mount(use.sandbox, this.inSandbox(c.root), c.creds!, signal)));
    } catch (err) {
      if (signal?.aborted) throw err;
      throw withPublicCode(err instanceof DriveUnreachableError ? err : new DriveUnreachableError(String(err).slice(0, 160)), "runner_error");
    }
    if (results.some((ok) => !ok)) {
      throw withPublicCode(new DriveUnreachableError(`mounted ${results.filter(Boolean).length} of ${results.length} roots`), "runner_error");
    }
    const link = this.options.agentLink;
    if (link) await linkAgentFilesRemote(sandboxExec(use.sandbox, signal), this.inSandbox(link.cwd), this.inSandbox(link.agentRoot), { log: this.options.log });
    this.modesApplied.clear();
    await this.applyModes(use.sandbox, signal);
    const expiries = credentials.map((c) => Date.parse(c.creds!.expiresAt ?? "")).filter((n) => Number.isFinite(n));
    this.mountedExpiry = expiries.length ? Math.min(...expiries) : undefined;
    this.mountedFor = key;
    this.options.log(`[inprocess] drive mounted in sandbox ${use.sandbox.id} boot ${use.boot} ms=${Date.now() - t0}`);
  }

  /** Set the mode of the skill files not yet set on this mount (they are on the drive, and this view shows them). */
  async applyModes(sandbox: DaytonaSandbox, signal?: AbortSignal): Promise<void> {
    const pending = [...this.modes].filter(([path]) => !this.modesApplied.has(path));
    if (pending.length === 0) return;
    const r = await sandbox.run(modesScript(pending.map(([path, mode]) => [this.inSandbox(path), mode])), { timeoutSeconds: 30, ...(signal ? { signal } : {}) });
    const failed = new Set(r.output.split("\n").map((l) => l.trim()).filter(Boolean));
    for (const [path] of pending) if (!failed.has(this.inSandbox(path))) this.modesApplied.add(path);
    if (failed.size) this.options.log(`[inprocess] skill modes not set for ${failed.size} file(s): ${[...failed].join(" ").slice(0, 200)}`);
  }
}
