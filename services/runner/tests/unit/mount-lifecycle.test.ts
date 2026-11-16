import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import type { AcquireContext } from "../../src/environment/acquire-context.ts";
import {
  mountLocalAgentCwd,
  mountLocalDurableCwd,
  mountLocalProjectMount,
  reSignAndRemountLocalProjectMount,
  type MountDeps,
} from "../../src/environment/mount-lifecycle.ts";
import type { ProjectRunDrive } from "../../src/engines/sandbox_agent/run-drives.ts";

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
  signProjectMount: async () => null,
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
      agentMountCreds: credentials,
    },
    sessionForMount: "session-1",
    artifactId: "artifact-1",
    log: () => {},
    beginCwdMount: () => {},
    markCwdDetachConfirmed: () => {},
    commitLocalMount: (kind: string) => commits.push(kind),
  }) as unknown as AcquireContext;

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

  it("commits an agent mount before its abort is handled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-agent-"));
    const controller = new AbortController();
    const commits: string[] = [];

    try {
      const mounted = await mountLocalAgentCwd(
        contextFor(cwd, commits),
        depsFor(controller.signal, async () => {
          controller.abort();
          return true;
        }),
      );

      assert.equal(mounted, false);
      assert.deepEqual(commits, ["agent"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
    }
  });
});

describe("agent mount alongside the cwd mount", () => {
  const linkPath = (cwd: string) => join(cwd, "agent-files");
  const exists = (path: string) => {
    try {
      lstatSync(path);
      return true;
    } catch {
      return false;
    }
  };

  it("mounts at once but links agent-files only after the cwd mount settles", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-parallel-"));
    const commits: string[] = [];
    let releaseCwd!: () => void;
    const cwdReady = new Promise<void>((resolve) => {
      releaseCwd = resolve;
    });
    const mountedPaths: string[] = [];
    try {
      const agent = mountLocalAgentCwd(
        // Guidance already active, so the call stops after the link (guidance has its own tests).
        { ...contextFor(cwd, commits), guidanceActive: true } as AcquireContext,
        depsFor(new AbortController().signal, async (path) => {
          mountedPaths.push(path);
          return true;
        }),
        { cwdReady },
      );
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
      // The agent home is a sibling of the cwd and is mounted without waiting.
      assert.deepEqual(mountedPaths, [`${cwd}-agent`]);
      assert.deepEqual(commits, ["agent"]);
      assert.equal(exists(linkPath(cwd)), false, "no link before the cwd mount");
      releaseCwd();
      assert.equal(await agent, true);
      assert.equal(exists(linkPath(cwd)), true, "linked after the cwd mount");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
    }
  });

  it("skips the link when the cwd mount fails, keeping the agent mount committed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-parallel-fail-"));
    const commits: string[] = [];
    const cwdReady = Promise.reject(new Error("detach could not be confirmed"));
    try {
      const mounted = await mountLocalAgentCwd(
        contextFor(cwd, commits),
        depsFor(new AbortController().signal, async () => true),
        { cwdReady },
      );
      // The agent mount is live; the acquire rethrows the cwd failure.
      assert.equal(mounted, true);
      // Committed, so teardown still unmounts it.
      assert.deepEqual(commits, ["agent"]);
      assert.equal(exists(linkPath(cwd)), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
    }
  });
});

describe("project drive mounts", () => {
  const projectContext = (cwd: string, commits: string[]): AcquireContext =>
    ({
      ...contextFor(cwd, commits),
      runCred: "ApiKey run",
      commitProjectMount: (drive: ProjectRunDrive, path: string | undefined) => {
        drive.mountedPath = path;
        commits.push(`project:${drive.slug}:${path ?? "-"}`);
      },
      recordResignedProjectCredential: (drive: ProjectRunDrive, credential: typeof credentials) => {
        drive.credentials = credential;
      },
      recordProjectLink: (drive: ProjectRunDrive, linked: boolean) => {
        drive.linkFailed = !linked;
      },
      takeRemountBudget: () => true,
    }) as unknown as AcquireContext;

  it("mounts a read drive read-only beside the cwd and links drives/<slug> after the cwd mount", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-project-"));
    const commits: string[] = [];
    const seen: Array<{ path: string; readOnly: boolean | undefined }> = [];
    let releaseCwd!: () => void;
    const cwdReady = new Promise<void>((resolve) => {
      releaseCwd = resolve;
    });
    const drive: ProjectRunDrive = { kind: "project", slug: "price-lists", access: "read", credentials };
    try {
      const mounted = mountLocalProjectMount(
        projectContext(cwd, commits),
        depsFor(new AbortController().signal, async (path, _creds, opts) => {
          seen.push({ path, readOnly: opts?.geesefs?.readOnly });
          return true;
        }),
        drive,
        { cwdReady },
      );
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(seen, [{ path: `${cwd}-project-price-lists`, readOnly: true }]);
      assert.equal(existsSync(join(cwd, "drives")), false, "no link before the cwd mount");
      releaseCwd();
      assert.equal(await mounted, true);
      assert.equal(drive.mountedPath, `${cwd}-project-price-lists`);
      assert.equal(readlinkSync(join(cwd, "drives", "price-lists")), `${cwd}-project-price-lists`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-project-price-lists`, { recursive: true, force: true });
    }
  });

  it("keeps the mount but never touches a folder already at drives/<slug>", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-project-folder-"));
    mkdirSync(join(cwd, "drives", "notes"), { recursive: true });
    writeFileSync(join(cwd, "drives", "notes", "kept.md"), "mine");
    const logs: string[] = [];
    const drive: ProjectRunDrive = { kind: "project", slug: "notes", access: "read-write", credentials };
    try {
      const mounted = await mountLocalProjectMount(
        { ...projectContext(cwd, []), log: (m: string) => logs.push(m) } as AcquireContext,
        depsFor(new AbortController().signal, async () => true),
        drive,
      );
      assert.equal(mounted, true);
      assert.equal(drive.mountedPath, `${cwd}-project-notes`, "recorded for teardown");
      assert.equal(drive.linkFailed, true);
      assert.equal(readFileSync(join(cwd, "drives", "notes", "kept.md"), "utf-8"), "mine");
      assert.ok(logs.includes("mount degraded kind=project_mount cause=link_failed slug=notes"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-project-notes`, { recursive: true, force: true });
    }
  });

  it("mounts a read-write drive writable", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-project-rw-"));
    let readOnly: boolean | undefined;
    const drive: ProjectRunDrive = { kind: "project", slug: "notes", access: "read-write", credentials };
    try {
      await mountLocalProjectMount(
        projectContext(cwd, []),
        depsFor(new AbortController().signal, async (_path, _creds, opts) => {
          readOnly = opts?.geesefs?.readOnly;
          return true;
        }),
        drive,
      );
      assert.equal(readOnly, false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-project-notes`, { recursive: true, force: true });
    }
  });

  it("goes on without a drive whose mount fails, leaving no mount point", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-project-fail-"));
    const commits: string[] = [];
    const drive: ProjectRunDrive = { kind: "project", slug: "notes", access: "read-write", credentials };
    try {
      const mounted = await mountLocalProjectMount(
        projectContext(cwd, commits),
        depsFor(new AbortController().signal, async () => false),
        drive,
      );
      assert.equal(mounted, false);
      assert.equal(drive.mountedPath, undefined);
      assert.deepEqual(commits, []);
      assert.equal(existsSync(`${cwd}-project-notes`), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not mount a drive that could not be signed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-project-unsigned-"));
    let calls = 0;
    try {
      const mounted = await mountLocalProjectMount(
        projectContext(cwd, []),
        depsFor(new AbortController().signal, async () => {
          calls += 1;
          return true;
        }),
        { kind: "project", slug: "notes", access: "read", credentials: null },
      );
      assert.equal(mounted, false);
      assert.equal(calls, 0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("re-signs with the drive's slug and access and remounts after ENOTCONN", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-mount-project-remount-"));
    const commits: string[] = [];
    const signed: string[] = [];
    const fresh = { ...credentials, accessKey: "fresh" };
    const drive: ProjectRunDrive = {
      kind: "project",
      slug: "notes",
      access: "read",
      credentials,
      mountedPath: `${cwd}-project-notes`,
    };
    try {
      const deps: MountDeps = {
        ...depsFor(new AbortController().signal, async (_path, creds) => creds.accessKey === "fresh"),
        signProjectMount: async (slug, access) => {
          signed.push(`${slug}:${access}`);
          return fresh;
        },
      };
      assert.equal(await reSignAndRemountLocalProjectMount(projectContext(cwd, commits), deps, drive), true);
      assert.deepEqual(signed, ["notes:read"]);
      assert.equal(drive.credentials, fresh);
      assert.equal(drive.mountedPath, `${cwd}-project-notes`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-project-notes`, { recursive: true, force: true });
    }
  });
});
