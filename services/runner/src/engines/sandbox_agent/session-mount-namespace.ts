/**
 * Per-session mount isolation for the LOCAL sandbox provider: the runner's decision about it.
 *
 * ============================================================================================
 * WHY A SCRIPT REPLACES THE DAEMON BINARY
 * ============================================================================================
 *
 * On the local provider every session's drive is geesefs-mounted under ONE shared root, in the
 * runner's own mount namespace, and the harness runs as an ordinary descendant of the daemon. So
 * a session's shell can reach every other session's drive. The fix is to start the daemon inside
 * a private mount namespace that shows it only its own drive.
 *
 * That has to happen in the daemon's own process, before it starts, and the sandbox-agent library
 * builds the daemon's argv itself: there is no hook to prepend `unshare` or any other command to
 * it. The one thing the runner does control is WHICH executable the library spawns. So the runner
 * points it at `scripts/session-mount-namespace.sh`, a static shell script that builds the
 * namespace from environment variables and then `exec`s the real daemon in place. `exec` keeps
 * the PID and the process group, so the library's group-kill teardown is unaffected.
 *
 * This module holds only the DECISION and the variable names. The script holds the mechanism, and
 * its header explains the namespace it builds and what it deliberately leaves shared.
 *
 * ============================================================================================
 * WHY EVERY LOCAL RUN GOES THROUGH THE SCRIPT, EVEN WITH NOTHING TO ISOLATE
 * ============================================================================================
 *
 * The runner holds CAP_SYS_ADMIN so that it CAN build the namespace, and it holds it for every
 * local session, not only the ones with a drive. An agent that inherited it could unmount the
 * cover it is confined by, so the script strips every capability before it becomes the daemon.
 * That step is unconditional, which is why a run with no durable mount still gets a plan — one
 * whose isolation flag is off. Only a Daytona run, whose daemon this runner does not spawn, and a
 * deployment whose image predates the script, are left alone entirely.
 *
 * ============================================================================================
 * WHY EVERY REFUSAL FAILS CLOSED TO "NO ISOLATION"
 * ============================================================================================
 *
 * A wrong isolation plan is worse than none: covering the shared root and then binding the wrong
 * path back would hand the session an empty or foreign cwd, which reads to a user as lost work.
 * So each precondition below refuses the whole plan and spawns the daemon exactly as before,
 * rather than isolating on a guess. The script itself fails open the same way for the conditions
 * only it can see (no `unshare`, a host that forbids unprivileged user namespaces).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { PKG_ROOT } from "./daemon.ts";

/** Absolute path of the REAL sandbox-agent daemon the script execs once the namespace is up. */
export const SESSION_DAEMON_BINARY_ENV_VAR = "AGENTA_SESSION_DAEMON_BINARY";
/** `"1"` turns isolation on. Any other value makes the script exec the daemon unchanged. */
export const SESSION_MOUNT_ISOLATION_ENV_VAR = "AGENTA_SESSION_MOUNT_ISOLATION";
/** The SHARED mount root the script covers with an empty tmpfs. */
export const SESSION_MOUNT_ROOT_ENV_VAR = "AGENTA_SESSION_MOUNT_ROOT";
/** This session's own mounts, space-separated, bound back into place inside the namespace. */
export const SESSION_MOUNT_KEEP_PATHS_ENV_VAR =
  "AGENTA_SESSION_MOUNT_KEEP_PATHS";

/** The script the daemon binary is replaced by. Static and identical for every run. */
export const SESSION_MOUNT_NAMESPACE_SCRIPT = join(
  PKG_ROOT,
  "scripts",
  "session-mount-namespace.sh",
);

/**
 * The shared root that this session's durable cwd hangs off: the cwd with its last two segments
 * (`<project_id>/<mount_id>`) removed.
 *
 * DERIVED, not imported from the durable-mount-root constant, on purpose. The root differs by
 * provider (`/var/lib/agenta/mounts` locally, `/home/sandbox/agenta/mounts` on Daytona) and an
 * optional per-deployment storage namespace can sit between them. Deriving it from the path the
 * runner actually mounted keeps the covered root and the kept path provably consistent; a
 * constant would silently cover the wrong directory the moment either shape changed.
 */
export function sharedMountRootOf(durableCwd: string): string {
  return dirname(dirname(durableCwd));
}

export interface SessionMountNamespaceInput {
  /** The resolved sandbox-agent daemon binary, or undefined when resolution found none. */
  daemonBinary: string | undefined;
  /** The COMMITTED durable cwd mountpoint. Undefined when no local mount landed. */
  mountedCwd: string | undefined;
  /** The COMMITTED agent mountpoint, when this run has one. */
  agentMountedPath: string | undefined;
  isDaytona: boolean;
  /** Overridable for tests; defaults to the script shipped with the package. */
  scriptPath?: string;
  /** Overridable for tests; defaults to a real filesystem check. */
  scriptExists?: (path: string) => boolean;
  /** Overridable for tests; defaults to the cached `unshare` probe. */
  canIsolate?: () => boolean;
}

export interface SessionMountNamespacePlan {
  /** What the sandbox provider must spawn INSTEAD of the daemon binary. */
  binaryPath: string;
  /** Daemon environment entries the script reads. */
  env: Record<string, string>;
  /**
   * The script was given a root to cover and paths to keep, so the daemon will see only its own
   * drive. False means the script will only strip capabilities.
   */
  isolates: boolean;
  /**
   * Why this run is not isolated, ready to log. Present exactly when `isolates` is false.
   *
   * The runner has to be the one that says this. The script's own fail-open warning goes to the
   * daemon's stderr, which the sandbox-agent library does not surface, so on a host that cannot
   * isolate the downgrade was invisible in the runner log — found in live verification, and the
   * exact silent downgrade the script's warning exists to prevent.
   */
  isolationSkipped?: string;
}

/** A path the script would mis-parse, because it splits the keep list on whitespace. */
const hasWhitespace = (path: string): boolean => /\s/.test(path);

/**
 * Can this process create a private mount namespace at all?
 *
 * Measured, not inferred. The two routes are the same two the script takes: CAP_SYS_ADMIN
 * directly (which the published image's entrypoint supplies as an ambient capability, and the dev
 * image has as root), or a user namespace that grants it. Guessing from the uid would be wrong in
 * both directions — a non-root process CAN hold the capability here, and a root process in a
 * container without `cap_add: SYS_ADMIN` cannot.
 *
 * Cached for the life of the process: neither this process's capabilities nor the host's
 * unprivileged-user-namespace policy changes underneath a running runner.
 */
let mountNamespaceProbe: boolean | undefined;

function probeMountNamespace(): boolean {
  const attempt = (args: string[]): boolean => {
    try {
      return (
        spawnSync("unshare", [...args, "true"], { stdio: "ignore" }).status ===
        0
      );
    } catch {
      return false;
    }
  };
  if (attempt(["--mount", "--propagation", "private"])) return true;
  const user = `${process.getuid?.() ?? 0}`;
  const group = `${process.getgid?.() ?? 0}`;
  return attempt([
    "--user",
    `--map-user=${user}`,
    `--map-group=${group}`,
    "--mount",
    "--propagation",
    "private",
  ]);
}

/** Overridable for tests; the real probe spawns `unshare` once per process. */
export function canCreateMountNamespace(probe = probeMountNamespace): boolean {
  if (mountNamespaceProbe === undefined) mountNamespaceProbe = probe();
  return mountNamespaceProbe;
}

/** Test-only: drop the memoized probe result so the next call re-measures. */
export function resetMountNamespaceProbe(): void {
  mountNamespaceProbe = undefined;
}

/**
 * Isolation arguments for this run, or a REASON string when there is nothing to isolate or
 * isolating would be wrong.
 *
 * Every refusal here means "strip capabilities but leave the mount view alone". A wrong isolation
 * plan is worse than none: covering the shared root and then binding the wrong path back would
 * hand the session an empty or foreign cwd, which reads to a user as lost work.
 */
function planIsolation(
  input: SessionMountNamespaceInput,
): { root: string; keepPaths: string[] } | string {
  // No committed durable cwd means an ephemeral scratch directory: not under the shared root, not
  // shared with anyone, and nothing to bind back once the root is covered.
  const mountedCwd = input.mountedCwd;
  if (!mountedCwd) return "this run has no durable mount to confine";
  if (!isAbsolute(mountedCwd)) {
    return `the durable cwd '${mountedCwd}' is not an absolute path`;
  }

  const keepPaths = [mountedCwd];
  if (input.agentMountedPath) keepPaths.push(input.agentMountedPath);

  const root = sharedMountRootOf(mountedCwd);
  // The script separates the keep list on whitespace, so a path containing a space would be read
  // as two paths and bind something the session does not own. Refuse rather than mis-bind.
  if (keepPaths.some(hasWhitespace) || hasWhitespace(root)) {
    return "a mounted path contains whitespace, which the script would read as two paths";
  }
  // Never cover `/`, and never cover a root the cwd does not actually live under: either would
  // tmpfs over paths this session needs and leave the harness looking at an empty filesystem.
  if (root === "/" || !mountedCwd.startsWith(`${root}/`)) {
    return `the shared root derived from '${mountedCwd}' is not a directory this session lives under`;
  }
  if (!(input.canIsolate ?? canCreateMountNamespace)()) {
    return (
      `this runner cannot create a mount namespace on this host, so every session's drive ` +
      `under ${root} stays visible to this session's agent, which can read, modify and delete ` +
      `drives it does not own. The published image grants the capability from its entrypoint; a ` +
      `container started under an operator uid cannot be granted it, and unprivileged user ` +
      `namespaces are refused here (on Ubuntu 23.10+ see kernel.apparmor_restrict_unprivileged_userns)`
    );
  }

  return { root, keepPaths };
}

/**
 * Decide how this run's daemon should be started.
 *
 * Returns `null` to mean "change nothing": spawn the daemon exactly as the runner did before this
 * mechanism existed.
 */
export function planSessionMountNamespace(
  input: SessionMountNamespaceInput,
): SessionMountNamespacePlan | null {
  // A Daytona session already owns its whole sandbox, so there is no sibling drive to hide from it
  // and no local daemon process for this runner to wrap.
  if (input.isDaytona) return null;
  // The local provider resolves the daemon binary itself and reports a clear error when it cannot;
  // pre-empting that here would replace a precise message with a confusing one about a script.
  if (!input.daemonBinary) return null;

  const scriptPath = input.scriptPath ?? SESSION_MOUNT_NAMESPACE_SCRIPT;
  // A partial deployment (an image built before the script existed) must still run sessions rather
  // than spawn a missing file as the daemon.
  const scriptExists = input.scriptExists ?? existsSync;
  if (!scriptExists(scriptPath)) return null;

  const isolation = planIsolation(input);
  const isolates = typeof isolation !== "string";

  return {
    binaryPath: scriptPath,
    isolates,
    ...(isolates ? {} : { isolationSkipped: isolation as string }),
    env: {
      [SESSION_DAEMON_BINARY_ENV_VAR]: input.daemonBinary,
      [SESSION_MOUNT_ISOLATION_ENV_VAR]: isolates ? "1" : "0",
      ...(isolates
        ? {
            [SESSION_MOUNT_ROOT_ENV_VAR]: (
              isolation as { root: string; keepPaths: string[] }
            ).root,
            [SESSION_MOUNT_KEEP_PATHS_ENV_VAR]: (
              isolation as { root: string; keepPaths: string[] }
            ).keepPaths.join(" "),
          }
        : {}),
    },
  };
}
