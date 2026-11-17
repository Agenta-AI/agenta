import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";

const lstatExists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import type { AcquireContext } from "../../src/environment/acquire-context.ts";
import {
  mountLocalDrive,
  mountLocalDurableCwd,
  reSignAndRemountLocalDrive,
  type MountDeps,
} from "../../src/environment/mount-lifecycle.ts";
import type { RunDrive } from "../../src/engines/sandbox_agent/run-drives.ts";

const credentials = {
  endpoint: "http://store",
  region: "eu-central-1",
  bucket: "bucket",
  prefix: "prefix",
  accessKey: "access",
  secretKey: "secret",
};

const depsFor = (
  signal: AbortSignal,
  mountStorage: MountDeps["mountStorage"],
): MountDeps => ({
  mountStorage,
  signMount: async () => null,
  signAgentMount: async () => null,
  signMountBySlug: async () => null,
  daytonaPiDir: "/tmp/pi",
  signal,
});

const contextFor = (cwd: string, commits: string[]): AcquireContext =>
  ({
    plan: {
      acpAgent: "pi",
      sandboxId: "local",
      isDaytona: false,
      driveOnRunner: true,
      workspace: { cwd },
    },
    env: {
      mountCreds: credentials,
    },
    sessionForMount: "session-1",
    artifactId: "artifact-1",
    log: () => {},
    beginCwdMount: () => {},
    markCwdDetachConfirmed: () => {},
    commitLocalMount: () => commits.push("cwd"),
  }) as unknown as AcquireContext;

/** A cwd mount that failed; the acquire observes the rejection, so the test marks it handled. */
function failedCwd(): Promise<unknown> {
  const failed = Promise.reject(new Error("cwd mount failed"));
  failed.catch(() => {});
  return failed;
}

describe("local mount cancellation", () => {
  it("commits a durable cwd mount before observing an abort", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-cwd-"));
    const controller = new AbortController();
    const commits: string[] = [];

    try {
      await assert.rejects(
        mountLocalDurableCwd(
          contextFor(cwd, commits),
          depsFor(controller.signal, async () => {
            controller.abort();
            return true;
          }),
          "initial",
        ),
        { name: "AbortError" },
      );
      assert.deepEqual(commits, ["cwd"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("drive mounts", () => {
  const driveContext = (cwd: string, commits: string[]): AcquireContext =>
    ({
      ...contextFor(cwd, commits),
      runCred: "ApiKey run",
      commitDriveMount: (drive: RunDrive, path: string) => {
        drive.mountedPath = path;
        commits.push(`drive:${drive.slug}:${path}`);
      },
      recordResignedDriveCredential: (drive: RunDrive, credential: typeof credentials) => {
        drive.credentials = credential;
        commits.push(`resigned:${drive.slug}`);
      },
      releaseDriveMount: (drive: RunDrive) => {
        drive.mountedPath = undefined;
      },
      recordDriveLink: (drive: RunDrive, linked: boolean) => {
        drive.linked = linked;
      },
      takeRemountBudget: () => true,
    }) as unknown as AcquireContext;

  it("mounts a read drive read-only beside the cwd and links drives/<slug> after the cwd mount", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-"));
    const commits: string[] = [];
    const seen: Array<{ path: string; readOnly: boolean | undefined }> = [];
    let releaseCwd!: () => void;
    const cwdReady = new Promise<void>((resolve) => {
      releaseCwd = resolve;
    });
    const drive: RunDrive = { isHome: false, slug: "price-lists", access: "read", credentials };
    try {
      const mounted = mountLocalDrive(
        driveContext(cwd, commits),
        depsFor(new AbortController().signal, async (path, _creds, opts) => {
          seen.push({ path, readOnly: opts?.geesefs?.readOnly });
          return true;
        }),
        drive,
        { cwdReady },
      );
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(seen, [{ path: `${cwd}-drive-price-lists`, readOnly: true }]);
      assert.equal(existsSync(join(cwd, "drives")), false, "no link before the cwd mount");
      releaseCwd();
      assert.equal(await mounted, true);
      assert.equal(drive.mountedPath, `${cwd}-drive-price-lists`);
      assert.equal(readlinkSync(join(cwd, "drives", "price-lists")), `${cwd}-drive-price-lists`);
      assert.equal(drive.linked, true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-price-lists`, { recursive: true, force: true });
    }
  });

  it("keeps the mount but never touches a folder already at drives/<slug>", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-folder-"));
    mkdirSync(join(cwd, "drives", "notes"), { recursive: true });
    writeFileSync(join(cwd, "drives", "notes", "kept.md"), "mine");
    const logs: string[] = [];
    const drive: RunDrive = { isHome: false, slug: "notes", access: "read-write", credentials };
    try {
      const mounted = await mountLocalDrive(
        { ...driveContext(cwd, []), log: (m: string) => logs.push(m) } as AcquireContext,
        depsFor(new AbortController().signal, async () => true),
        drive,
      );
      assert.equal(mounted, true);
      assert.equal(drive.mountedPath, `${cwd}-drive-notes`, "recorded for teardown");
      assert.equal(drive.linked, false);
      assert.equal(readFileSync(join(cwd, "drives", "notes", "kept.md"), "utf-8"), "mine");
      assert.ok(logs.includes("mount degraded kind=drive_mount cause=link_failed slug=notes"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-notes`, { recursive: true, force: true });
    }
  });

  it("leaves a drive unlinked, not linked, when the cwd mount fails before the link", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-nocwd-"));
    const drive: RunDrive = { isHome: false, slug: "notes", access: "read", credentials };
    try {
      const mounted = await mountLocalDrive(
        driveContext(cwd, []),
        depsFor(new AbortController().signal, async () => true),
        drive,
        { cwdReady: failedCwd() },
      );
      assert.equal(mounted, true);
      assert.equal(drive.mountedPath, `${cwd}-drive-notes`, "recorded for teardown");
      assert.notEqual(drive.linked, true);
      assert.equal(existsSync(join(cwd, "drives")), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-notes`, { recursive: true, force: true });
    }
  });

  it("detaches a mount an earlier environment left at the path before mounting read-only, and never reuses it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-left-"));
    const steps: string[] = [];
    const drive: RunDrive = { isHome: false, slug: "notes", access: "read", credentials };
    try {
      const deps = (unmounted: boolean): MountDeps => ({
        ...depsFor(new AbortController().signal, async (_path, _creds, opts) => {
          steps.push(`mount ro=${opts?.geesefs?.readOnly}`);
          return true;
        }),
        isMounted: async () => true,
        unmountStorage: async () => {
          steps.push("unmount");
          return unmounted;
        },
      });
      assert.equal(await mountLocalDrive(driveContext(cwd, []), deps(true), drive), true);
      assert.deepEqual(steps, ["unmount", "mount ro=true"]);
      steps.length = 0;
      assert.equal(readlinkSync(join(cwd, "drives", "notes")), `${cwd}-drive-notes`, "linked by the first mount");
      const again: RunDrive = { ...drive, mountedPath: undefined };
      assert.equal(await mountLocalDrive(driveContext(cwd, []), deps(false), again), false);
      assert.deepEqual(steps, ["unmount"], "a mount that did not detach is not reused");
      assert.equal(existsSync(join(cwd, "drives", "notes")) || lstatExists(join(cwd, "drives", "notes")), false, "its link is removed");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-notes`, { recursive: true, force: true });
    }
  });

  it("ends promptly when the run is stopped while it probes for a leftover mount, and never detaches or mounts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-probe-abort-"));
    const controller = new AbortController();
    const steps: string[] = [];
    const drive: RunDrive = { isHome: false, slug: "notes", access: "read", credentials };
    try {
      const pending = mountLocalDrive(
        driveContext(cwd, []),
        {
          ...depsFor(controller.signal, async () => {
            steps.push("mount");
            return true;
          }),
          isMounted: () => new Promise<boolean>(() => {}),
          unmountStorage: async () => {
            steps.push("unmount");
            return true;
          },
        },
        drive,
      );
      setTimeout(() => controller.abort(), 10);
      const started = Date.now();
      assert.equal(await pending, false);
      assert.ok(Date.now() - started < 1_000);
      assert.deepEqual(steps, []);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the path for teardown when a re-signed remount cannot confirm the old mount detached", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-remount-fail-"));
    const drive: RunDrive = { isHome: false, slug: "notes", access: "read", credentials, mountedPath: `${cwd}-drive-notes` };
    try {
      const deps: MountDeps = {
        ...depsFor(new AbortController().signal, async () => {
          throw new Error("detach of the dead mount could not be confirmed");
        }),
        isMounted: async () => false,
        signMountBySlug: async () => ({ ...credentials, accessKey: "fresh" }),
      };
      assert.equal(await reSignAndRemountLocalDrive(driveContext(cwd, []), deps, drive), false);
      assert.equal(drive.credentials?.accessKey, "fresh");
      assert.equal(drive.mountedPath, `${cwd}-drive-notes`, "teardown still unmounts it");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-notes`, { recursive: true, force: true });
    }
  });

  it("mounts a read-write drive writable", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-rw-"));
    let readOnly: boolean | undefined;
    const drive: RunDrive = { isHome: false, slug: "notes", access: "read-write", credentials };
    try {
      await mountLocalDrive(
        driveContext(cwd, []),
        depsFor(new AbortController().signal, async (_path, _creds, opts) => {
          readOnly = opts?.geesefs?.readOnly;
          return true;
        }),
        drive,
      );
      assert.equal(readOnly, false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-notes`, { recursive: true, force: true });
    }
  });

  it("goes on without a drive whose mount fails, leaving no mount point", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-fail-"));
    const commits: string[] = [];
    const drive: RunDrive = { isHome: false, slug: "notes", access: "read-write", credentials };
    try {
      const mounted = await mountLocalDrive(
        driveContext(cwd, commits),
        depsFor(new AbortController().signal, async () => false),
        drive,
      );
      assert.equal(mounted, false);
      assert.equal(drive.mountedPath, undefined);
      assert.deepEqual(commits, []);
      assert.equal(existsSync(`${cwd}-drive-notes`), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not mount a drive that could not be signed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-unsigned-"));
    let calls = 0;
    try {
      const mounted = await mountLocalDrive(
        driveContext(cwd, []),
        depsFor(new AbortController().signal, async () => {
          calls += 1;
          return true;
        }),
        { isHome: false, slug: "notes", access: "read", credentials: null },
      );
      assert.equal(mounted, false);
      assert.equal(calls, 0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("re-signs with the drive's slug and access and remounts after ENOTCONN", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-drive-remount-"));
    const commits: string[] = [];
    const signed: string[] = [];
    const fresh = { ...credentials, accessKey: "fresh" };
    const drive: RunDrive = {
      isHome: false,
      slug: "notes",
      access: "read",
      credentials,
      mountedPath: `${cwd}-drive-notes`,
    };
    try {
      const deps: MountDeps = {
        ...depsFor(new AbortController().signal, async (_path, creds) => creds.accessKey === "fresh"),
        signMountBySlug: async (slug, access) => {
          signed.push(`${slug}:${access}`);
          return fresh;
        },
      };
      assert.equal(await reSignAndRemountLocalDrive(driveContext(cwd, commits), deps, drive), true);
      assert.deepEqual(signed, ["notes:read"]);
      assert.equal(drive.credentials, fresh);
      assert.equal(drive.mountedPath, `${cwd}-drive-notes`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-notes`, { recursive: true, force: true });
    }
  });
});

describe("the home drive", () => {
  const homeContext = (cwd: string, commits: string[]): AcquireContext =>
    ({
      ...contextFor(cwd, commits),
      runCred: "ApiKey run",
      commitDriveMount: (drive: RunDrive, path: string) => {
        drive.mountedPath = path;
        commits.push(`drive:${drive.slug ?? "legacy"}`);
      },
      recordDriveLink: (drive: RunDrive, linked: boolean) => {
        drive.linked = linked;
      },
      recordResignedDriveCredential: (drive: RunDrive, credential: typeof credentials) => {
        drive.credentials = credential;
      },
      releaseDriveMount: (drive: RunDrive) => {
        drive.mountedPath = undefined;
      },
      takeRemountBudget: () => true,
    }) as unknown as AcquireContext;

  it("mounts at once, links drives/<slug> and agent-files only after the cwd mount settles, and seeds the README", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-home-"));
    const commits: string[] = [];
    let releaseCwd!: () => void;
    const cwdReady = new Promise<void>((resolve) => {
      releaseCwd = resolve;
    });
    const mountedPaths: string[] = [];
    const drive: RunDrive = { slug: "home", access: "read-write", isHome: true, credentials };
    try {
      const pending = mountLocalDrive(
        homeContext(cwd, commits),
        depsFor(new AbortController().signal, async (path) => {
          mountedPaths.push(path);
          return true;
        }),
        drive,
        { cwdReady },
      );
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(mountedPaths, [`${cwd}-drive-home`]);
      assert.deepEqual(commits, ["drive:home"]);
      assert.equal(lstatExists(join(cwd, "agent-files")), false, "no link before the cwd mount");
      releaseCwd();
      assert.equal(await pending, true);
      assert.equal(readlinkSync(join(cwd, "agent-files")), `${cwd}-drive-home`);
      assert.equal(readlinkSync(join(cwd, "drives", "home")), `${cwd}-drive-home`);
      assert.equal(drive.linked, true);
      assert.match(readFileSync(join(`${cwd}-drive-home`, "README.md"), "utf-8"), /^This folder belongs to your agent\./);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-drive-home`, { recursive: true, force: true });
    }
  });

  it("commits the legacy agent drive at <cwd>-agent before its abort is handled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-agent-"));
    const controller = new AbortController();
    const commits: string[] = [];
    try {
      const mounted = await mountLocalDrive(
        homeContext(cwd, commits),
        { ...depsFor(controller.signal, async () => {
          controller.abort();
          return true;
        }), isMounted: async () => false },
        { artifactId: "artifact-1", access: "read-write", isHome: true, credentials },
      );
      assert.equal(mounted, false);
      assert.deepEqual(commits, ["drive:legacy"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
    }
  });

  it("re-signs the legacy agent drive through the legacy route, and a home drive with is_home", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-home-resign-"));
    const signed: string[] = [];
    try {
      const deps: MountDeps = {
        ...depsFor(new AbortController().signal, async () => true),
        isMounted: async () => false,
        signAgentMount: async (artifactId) => {
          signed.push(`agent:${artifactId}`);
          return credentials;
        },
        signMountBySlug: async (slug, access, isHome) => {
          signed.push(`${slug}:${access}:${isHome}`);
          return credentials;
        },
      };
      await reSignAndRemountLocalDrive(homeContext(cwd, []), deps, { artifactId: "artifact-1", access: "read-write", isHome: true, credentials });
      await reSignAndRemountLocalDrive(homeContext(cwd, []), deps, { slug: "home", access: "read-write", isHome: true, credentials });
      assert.deepEqual(signed, ["agent:artifact-1", "home:read-write:true"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
      rmSync(`${cwd}-drive-home`, { recursive: true, force: true });
    }
  });
});
