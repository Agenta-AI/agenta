/**
 * Seed the image's pinned Codex adapter into the data dir the daemon will actually read.
 *
 * ============================================================================================
 * THE BUG THIS EXISTS FOR
 * ============================================================================================
 *
 * The image bakes a PINNED codex-acp (see `Dockerfile.gh`: `pin-codex-adapter.ts` +
 * `patch-codex-acp-approvals.ts`) under `$HOME/.local/share/sandbox-agent`, with `ENV HOME`
 * fixed so build time and run time agree. The daemon resolves its own data dir as
 * `$XDG_DATA_HOME`, else `$HOME/.local/share`, and looks for `sandbox-agent/bin/agent_processes/`
 * there.
 *
 * The documented self-host scheme for a personal subscription
 * (`docs/docs/self-host/agents/01-use-your-own-subscription.mdx`) runs this container as the
 * operator's own uid with `HOME=/tmp`, because a foreign uid cannot write to `/home/node`. That
 * override moves the daemon's data dir to `/tmp/.local/share/sandbox-agent`, where the pin is
 * not, so the daemon cold-installs Codex instead: it downloads the native binary from GitHub
 * "latest", npm-installs the FLOATING latest `@agentclientprotocol/codex-acp` (unpatched, so its
 * approvals are cold even when it works), and then verifies it by running `codex-acp --help` with
 * stdin=/dev/null. That probe never returns, and the daemon puts no timeout on it, so the session
 * open never answers. Observed live on 2026-10-27 (sandbox-agent 0.4.2, registry codex-acp 2.3.0):
 * `[timing] stage=acquire_total ms=1066709`, a turn the user saw as "running" for 17.8 minutes
 * while the session's running lock was renewed and nothing could be sent. Only the FIRST Codex
 * turn after a restart hangs, because the cold install leaves files behind for the next one.
 *
 * So the runner seeds the pin itself, at boot, into wherever the daemon is going to look. Then
 * the daemon logs `ensure_installed: already ready`, skips the registry fetch and skips the
 * probe, and `initialize` answers in seconds.
 *
 * ============================================================================================
 * WHAT IT WILL NOT DO
 * ============================================================================================
 *
 * It never seeds ON TOP of an existing install. An operator who deliberately installed their own
 * adapter version into the data dir keeps it; this only fills an EMPTY data dir. And every
 * failure here is a warning, never a throw: a runner that cannot seed still serves every non-Codex
 * run, and a Codex run that cold-installs is the old behavior, not a new one.
 */
import {
  accessSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the runner images bake the pin. Both `Dockerfile.gh` and `Dockerfile.dev` pin as
 * `USER node` with `ENV HOME=/home/node`. This is a fixed path rather than one derived from the
 * current HOME, because the whole point is that HOME at run time may no longer be the HOME the
 * image was built with.
 */
export const DEFAULT_BAKED_AGENT_DATA_DIR = "/home/node/.local/share/sandbox-agent";

/** The adapter install the daemon looks for, relative to a data dir. */
const AGENT_PROCESSES_REL = join("bin", "agent_processes");
/** The install marker: the daemon treats codex as installed when this directory is present. */
const CODEX_PROCESS_REL = join(AGENT_PROCESSES_REL, "codex");
/** The native codex CLI. Seeded too, so the daemon does not download GitHub "latest" beside a pinned adapter. */
const CODEX_BIN_REL = join("bin", "codex");

/**
 * The data dir the sandbox-agent daemon will resolve, computed the way the daemon computes it:
 * `$XDG_DATA_HOME`, else `$HOME/.local/share`, plus `sandbox-agent`.
 *
 * READ FROM `process.env`, NOT FROM THE DAEMON ENV MAP, and that is correct: the local provider
 * spawns the daemon as `{...process.env, ...options.env}` (inherit-then-apply), and
 * `buildDaemonEnv` copies HOME through unchanged and never sets `XDG_DATA_HOME`. So the daemon
 * sees exactly these two values.
 */
export function daemonDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME?.trim()
    ? env.XDG_DATA_HOME.trim()
    : join(env.HOME?.trim() || homedir(), ".local", "share");
  return join(dataHome, "sandbox-agent");
}

export type SeedOutcome =
  /** The pin was copied into the daemon's data dir. */
  | { kind: "seeded"; from: string; to: string; ms: number }
  /** The daemon's data dir IS the baked location: the ordinary, un-overridden HOME. */
  | { kind: "already-baked"; dir: string }
  /** Something is already installed there. Never overwritten. */
  | { kind: "already-installed"; dir: string }
  /** No baked pin on this filesystem: not a runner image (a developer laptop, a test process). */
  | { kind: "no-baked-pin" }
  /** The baked pin exists but this uid cannot read it. */
  | { kind: "unreadable"; from: string; reason: string }
  /** The copy itself failed. The run continues; Codex will cold-install as before. */
  | { kind: "failed"; from: string; to: string; reason: string };

export interface SeedOptions {
  env?: NodeJS.ProcessEnv;
  /** The baked data dir. Defaults to the image's; tests point it at a fixture. */
  bakedDir?: string;
  /** One line per outcome. Defaults to stderr, like every other runner boot line. */
  log?: (message: string) => void;
}

/**
 * Copy the baked `bin/agent_processes` (and `bin/codex`) into the daemon's data dir when that dir
 * has no Codex install yet.
 *
 * IDEMPOTENT AND CRASH-SAFE BY CONSTRUCTION: each artifact is copied to a staging name and
 * `rename`d into place, so a partially copied tree is never visible under the name the daemon
 * checks, and a second seeder that loses the race (the server and a CLI run in one container)
 * finds the directory already there and skips. `agent_processes` is renamed LAST, because it is
 * the marker the daemon reads: once it exists, `bin/codex` must already be beside it.
 */
export function seedPinnedAgentProcesses(options: SeedOptions = {}): SeedOutcome {
  const log =
    options.log ?? ((message: string) => void process.stderr.write(`${message}\n`));
  const outcome = seed(
    options.env ?? process.env,
    options.bakedDir ?? DEFAULT_BAKED_AGENT_DATA_DIR,
  );
  log(describeOutcome(outcome));
  return outcome;
}

function seed(env: NodeJS.ProcessEnv, from: string): SeedOutcome {
  const to = daemonDataDir(env);
  // Not `existsSync`: it answers false for EACCES too, and a pin this uid cannot reach is the
  // case the operator must hear about, not a quiet "not a runner image".
  try {
    statSync(from);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "no-baked-pin" };
    return { kind: "unreadable", from, reason: reason(err) };
  }
  // `realpath` rather than string equality: `/home/node` reached through a symlinked HOME is the
  // same directory, and copying a tree onto itself would destroy the pin.
  if (samePath(from, to)) return { kind: "already-baked", dir: to };
  if (existsSync(join(to, CODEX_PROCESS_REL))) return { kind: "already-installed", dir: to };

  const sourceProcesses = join(from, AGENT_PROCESSES_REL);
  try {
    // Read AND traverse. A foreign uid that cannot enter the baked tree gets one honest warning
    // here instead of a half-copied tree.
    accessSync(sourceProcesses, fsConstants.R_OK | fsConstants.X_OK);
    if (!statSync(sourceProcesses).isDirectory()) throw new Error("not a directory");
  } catch (err) {
    return { kind: "unreadable", from: sourceProcesses, reason: reason(err) };
  }

  const startedAt = Date.now();
  const stagingSuffix = `.seed-${process.pid}-${Date.now().toString(36)}`;
  const binDir = join(to, "bin");
  const stagedProcesses = join(binDir, `agent_processes${stagingSuffix}`);
  const stagedCodex = join(binDir, `codex${stagingSuffix}`);
  try {
    mkdirSync(binDir, { recursive: true });
    // `verbatimSymlinks`: the adapter tree contains RELATIVE symlinks (`node_modules/.bin/*`).
    // Node's default rewrites a relative link against the destination, which would break them;
    // the tree's shape is preserved by the copy, so the links are correct as written.
    cpSync(sourceProcesses, stagedProcesses, {
      recursive: true,
      verbatimSymlinks: true,
      force: true,
    });
    // The launcher the daemon executes carries an ABSOLUTE exec path; point it at the copy.
    rewriteLauncher(join(stagedProcesses, "codex-acp"), from, to);

    // The native CLI first: `agent_processes` is the marker, so it must land last.
    const sourceCodex = join(from, CODEX_BIN_REL);
    if (existsSync(sourceCodex) && !existsSync(join(to, CODEX_BIN_REL))) {
      cpSync(sourceCodex, stagedCodex, { force: true });
      renameSync(stagedCodex, join(to, CODEX_BIN_REL));
    }
    renameSync(stagedProcesses, join(to, AGENT_PROCESSES_REL));
  } catch (err) {
    for (const staged of [stagedProcesses, stagedCodex]) {
      try {
        rmSync(staged, { recursive: true, force: true });
      } catch {
        // best-effort cleanup of our own staging copy
      }
    }
    // A concurrent seeder that won the race left a complete install behind, which is the outcome
    // this one wanted anyway.
    if (existsSync(join(to, CODEX_PROCESS_REL))) return { kind: "already-installed", dir: to };
    return { kind: "failed", from: sourceProcesses, to, reason: reason(err) };
  }
  return { kind: "seeded", from: sourceProcesses, to, ms: Date.now() - startedAt };
}

/**
 * Point the launcher's `exec` line at the copy.
 *
 * The launcher the pin step generates ends in
 * `exec '<baked>/bin/agent_processes/codex/node_modules/.bin/codex-acp' "$@"`. A copy that kept
 * that absolute path would run the ORIGINAL files, which breaks the moment the baked tree is
 * unreadable to this uid. Rewriting is a plain substring replacement of the data dir, so a
 * launcher whose shape changes upstream is left alone rather than mangled.
 */
function rewriteLauncher(path: string, from: string, to: string): void {
  if (!existsSync(path)) return;
  const source = readFileSync(path, "utf8");
  if (!source.includes(from)) return;
  // Unlink first: the copy may share an inode with the baked launcher on a filesystem that
  // hardlinks, and a plain write would rewrite the image's own file.
  rmSync(path, { force: true });
  writeFileSync(path, source.split(from).join(to), { mode: 0o755 });
}

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One line, whatever happened. The log is where an operator confirms the pin is in play. */
function describeOutcome(outcome: SeedOutcome): string {
  const prefix = "[adapter-seed]";
  switch (outcome.kind) {
    case "seeded":
      return `${prefix} seeded the pinned Codex adapter into the daemon data dir: ${outcome.from} -> ${outcome.to} (${outcome.ms}ms)`;
    case "already-baked":
      return `${prefix} skipped: the daemon data dir is the baked pin (${outcome.dir})`;
    case "already-installed":
      return `${prefix} skipped: an agent process is already installed in ${outcome.dir}`;
    case "no-baked-pin":
      return `${prefix} skipped: no baked Codex pin on this filesystem`;
    case "unreadable":
      return `${prefix} WARNING: cannot read the baked Codex pin at ${outcome.from} (${outcome.reason}); Codex will install at first use, which can hang the session`;
    case "failed":
      return `${prefix} WARNING: could not seed ${outcome.from} into ${outcome.to} (${outcome.reason}); Codex will install at first use, which can hang the session`;
  }
}
