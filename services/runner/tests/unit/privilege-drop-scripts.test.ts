/**
 * The two shell scripts that decide what privilege the agent daemon runs with.
 *
 * `runner-entrypoint.sh` gives the runner server an ambient CAP_SYS_ADMIN without making it root;
 * `session-mount-namespace.sh` takes every capability away again before the daemon starts. Between
 * them they are the whole reason one session cannot reach another session's drive, and both are
 * shell, so nothing else in the suite would notice a flag being dropped or misspelled.
 *
 * These tests run the scripts for real with `setpriv`, `unshare` and `id` stubbed on PATH, because
 * the flags ARE the contract: `--ambient-caps` without `--inh-caps` silently grants nothing, and
 * `--bounding-set=-all` is what stops a uid-0 agent in the dev image from unmounting its cover.
 * A privileged end-to-end check belongs on a deployed stack, not here.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/privilege-drop-scripts.test.ts)
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PKG_ROOT } from "../../src/engines/sandbox_agent/daemon.ts";

const ENTRYPOINT = join(PKG_ROOT, "scripts", "runner-entrypoint.sh");
const PRELUDE = join(PKG_ROOT, "scripts", "session-mount-namespace.sh");

let workDir: string;
let binDir: string;

/** Record a stub's argv, then run whatever trails the stub's own flags. */
function writeStub(name: string, body: string): void {
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function argvOf(name: string): string[] {
  return readFileSync(join(workDir, `${name}.argv`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "agenta-privilege-scripts-"));
  binDir = join(workDir, "bin");
  execFileSync("mkdir", ["-p", binDir]);

  // The stubs record their arguments one per line, then exec the trailing command, so the test can
  // assert BOTH the flags a script passes and that the real command still ends up running.
  writeStub(
    "setpriv",
    `for arg in "$@"; do echo "$arg" >> "${workDir}/setpriv.argv"; done\n` +
      `while [ $# -gt 0 ]; do case "$1" in --*) shift ;; *) break ;; esac; done\n` +
      `exec "$@"`,
  );
  // Mounting needs privileges this test process does not have, and the point here is the ORDER of
  // operations, not the kernel's answer: park the session's own mounts, cover the root, put them
  // back. A real mount is exercised on a deployed stack.
  writeStub(
    "mount",
    `for arg in "$@"; do echo "$arg" >> "${workDir}/mount.argv"; done\necho -- >> "${workDir}/mount.argv"`,
  );
  writeStub("umount", `echo "$1" >> "${workDir}/umount.argv"`);
  writeStub(
    "daemon",
    `for arg in "$@"; do echo "$arg" >> "${workDir}/daemon.argv"; done\n` +
      `echo ran > "${workDir}/daemon.ran"`,
  );
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function run(
  script: string,
  args: string[],
  env: Record<string, string>,
): void {
  execFileSync("sh", [script, ...args], {
    env: {
      PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("runner-entrypoint.sh: a capability without the uid", () => {
  it("drops to the named user while carrying CAP_SYS_ADMIN into the server", () => {
    // --ambient-caps is the whole point: the capability has to survive the execve into the server,
    // and it can only be made ambient while it is ALSO inheritable. Losing --inh-caps here grants
    // nothing at all, silently, and every session then starts without mount isolation.
    writeStub("id", `case "$1" in -u) echo 0 ;; -gn) echo somegroup ;; esac`);

    run(ENTRYPOINT, ["someuser", join(binDir, "daemon"), "serve"], {});

    const argv = argvOf("setpriv");
    assert.ok(argv.includes("--reuid=someuser"), "must drop to the named user");
    assert.ok(
      argv.includes("--regid=somegroup"),
      "must take that user's own group",
    );
    assert.ok(argv.includes("--init-groups"));
    assert.ok(argv.includes("--inh-caps=+sys_admin"));
    assert.ok(argv.includes("--ambient-caps=+sys_admin"));
    assert.deepEqual(argvOf("daemon"), ["serve"]);
  });

  it("runs the server unchanged when the container already started unprivileged", () => {
    // The documented subscription self-host scheme overrides the compose `user:` with the
    // operator's uid. Nothing can grant a capability from there, and the server must still start.
    writeStub(
      "id",
      `case "$1" in -u) echo 1000 ;; -gn) echo somegroup ;; esac`,
    );

    run(ENTRYPOINT, ["someuser", join(binDir, "daemon"), "serve"], {});

    assert.throws(
      () => argvOf("setpriv"),
      "setpriv must not run as a non-root container",
    );
    assert.deepEqual(argvOf("daemon"), ["serve"]);
  });

  it("runs the server unchanged when no target user is named", () => {
    // The dev image runs as root on purpose and names no user, so it keeps today's behavior.
    writeStub("id", `case "$1" in -u) echo 0 ;; -gn) echo somegroup ;; esac`);

    run(ENTRYPOINT, ["", join(binDir, "daemon"), "serve"], {});

    assert.throws(
      () => argvOf("setpriv"),
      "setpriv must not run without a target user",
    );
    assert.deepEqual(argvOf("daemon"), ["serve"]);
  });
});

describe("session-mount-namespace.sh: the agent never keeps the runner's capability", () => {
  it("strips every capability before becoming the daemon, isolation or not", () => {
    // A run with no durable mount has nothing to hide, but the runner still holds CAP_SYS_ADMIN,
    // and an agent that inherited it could unmount the cover on any OTHER session's behalf. The
    // strip is therefore unconditional. --bounding-set=-all is the load-bearing flag: it is what
    // makes this correct in the dev image, where the daemon keeps running as uid 0.
    run(PRELUDE, ["server", "--port", "7"], {
      AGENTA_SESSION_DAEMON_BINARY: join(binDir, "daemon"),
      AGENTA_SESSION_MOUNT_ISOLATION: "0",
    });

    const argv = argvOf("setpriv");
    assert.ok(argv.includes("--inh-caps=-all"));
    assert.ok(argv.includes("--ambient-caps=-all"));
    assert.ok(argv.includes("--bounding-set=-all"));
    assert.ok(argv.includes("--no-new-privs"));
    // The uid is deliberately absent: the agent must keep the ownership it writes files with.
    assert.ok(
      !argv.some(
        (arg) => arg.startsWith("--reuid") || arg.startsWith("--regid"),
      ),
      "the prelude must not change the agent's uid",
    );
    assert.deepEqual(argvOf("daemon"), ["server", "--port", "7"]);
  });

  it("still strips capabilities when isolation was asked for but cannot be built", () => {
    // Fail-open is about the mount view, never about the capability. `unshare` failing both ways
    // is the ordinary outcome for an operator-uid runner on Ubuntu 23.10 and later.
    writeStub("unshare", "exit 1");

    run(PRELUDE, ["server"], {
      AGENTA_SESSION_DAEMON_BINARY: join(binDir, "daemon"),
      AGENTA_SESSION_MOUNT_ISOLATION: "1",
      AGENTA_SESSION_MOUNT_ROOT: "/var/lib/agenta/mounts",
      AGENTA_SESSION_MOUNT_KEEP_PATHS: "/var/lib/agenta/mounts/p/m",
    });

    assert.ok(argvOf("setpriv").includes("--bounding-set=-all"));
    assert.deepEqual(argvOf("daemon"), ["server"]);
  });

  it("re-enters itself under unshare, keeping the daemon's argv intact", () => {
    // `exec unshare ... "$0" "$@"` is how the second stage gets a namespace to build in. If the
    // argv were rebuilt rather than passed through, the daemon would start with the wrong flags.
    writeStub(
      "unshare",
      `for arg in "$@"; do echo "$arg" >> "${workDir}/unshare.argv"; done\n` +
        // --propagation takes a value, so it consumes two positions, not one.
        `while [ $# -gt 0 ]; do case "$1" in --propagation) shift 2 ;; --*) shift ;; *) break ;; esac; done\n` +
        `exec "$@"`,
    );

    // A root under the test's own directory, because the second stage really does `mkdir` inside
    // the cover it just laid down. The shape is what matters, not the literal path.
    const root = join(workDir, "mounts");
    const drive = join(root, "p", "m");

    run(PRELUDE, ["server", "--port", "7"], {
      AGENTA_SESSION_DAEMON_BINARY: join(binDir, "daemon"),
      AGENTA_SESSION_MOUNT_ISOLATION: "1",
      AGENTA_SESSION_MOUNT_ROOT: root,
      AGENTA_SESSION_MOUNT_KEEP_PATHS: drive,
    });

    const argv = argvOf("unshare");
    assert.ok(argv.includes("--mount"), "the mount namespace is the point");
    assert.ok(
      argv.includes("--propagation"),
      "private propagation is what hides a drive mounted later for another session",
    );
    assert.ok(argv.includes(PRELUDE), "the script must re-enter itself");
    assert.deepEqual(argvOf("daemon"), ["server", "--port", "7"]);

    // The order is the safety property. Binding the session's own drive AFTER covering the root
    // would bind an empty tmpfs directory over it, and the harness would open an empty workspace
    // where its files used to be.
    const mounts: string[][] = [];
    let current: string[] = [];
    for (const token of argvOf("mount")) {
      if (token === "--") {
        mounts.push(current);
        current = [];
        continue;
      }
      current.push(token);
    }
    assert.equal(mounts.length, 3, "park, cover, restore");

    const [park, cover, restore] = mounts;
    assert.deepEqual(
      park.slice(0, 2),
      ["--bind", drive],
      "the drive is parked first",
    );
    assert.equal(cover.at(-1), root, "then the shared root is covered");
    assert.ok(cover.includes("tmpfs"), "the cover is an empty tmpfs");
    assert.equal(restore[0], "--bind");
    assert.equal(
      restore.at(-1),
      drive,
      "the drive returns to its original path",
    );
    assert.equal(
      restore[1],
      park[2],
      "the drive must come back from where it was parked, not from anywhere else",
    );

    // Retracting the holding bind leaves the drive reachable at exactly one path.
    assert.equal(argvOf("umount").length, 1);
  });

  it("refuses to start at all without a daemon binary", () => {
    // An empty variable would otherwise exec the empty string and fail with nothing to read.
    assert.throws(() =>
      run(PRELUDE, ["server"], { AGENTA_SESSION_MOUNT_ISOLATION: "0" }),
    );
  });
});
