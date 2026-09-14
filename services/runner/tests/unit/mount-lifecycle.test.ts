import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import type { AcquireContext } from "../../src/environment/acquire-context.ts";
import {
  mountInitialLocalStorage,
  mountLocalAgentCwd,
  mountLocalDurableCwd,
  type MountDeps,
} from "../../src/environment/mount-lifecycle.ts";

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
  daytonaPiDir: "/tmp/pi",
  signal,
});

const contextFor = (cwd: string, commits: string[]): AcquireContext =>
  ({
    plan: {
      acpAgent: "pi",
      isDaytona: false,
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

describe("initial local storage", () => {
  async function withContext(
    test: (
      ctx: AcquireContext,
      cwd: string,
      commits: string[],
    ) => Promise<void>,
  ) {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-initial-storage-"));
    const commits: string[] = [];
    const ctx = contextFor(cwd, commits);
    ctx.commitLocalMount = (kind, path) => {
      commits.push(kind);
      Object.assign(
        ctx.env,
        kind === "cwd" ? { mountedCwd: path } : { agentMountedPath: path },
      );
    };
    ctx.markGuidanceActive = () => {};
    ctx.writeDaemonEnv = () => {};
    try {
      await test(ctx, cwd, commits);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
    }
  }

  it("stops before the agent mount when the signed session mount fails", async () => {
    await withContext(async (ctx, _cwd, commits) => {
      let calls = 0;
      await assert.rejects(
        mountInitialLocalStorage(
          ctx,
          depsFor(new AbortController().signal, async () => {
            calls++;
            return false;
          }),
        ),
        /Durable session storage could not be mounted/,
      );
      assert.equal(calls, 1);
      assert.deepEqual(commits, []);
    });
  });

  it("stops a cold approval rebuild when the agent mount fails behind a serialized link", async () => {
    await withContext(async (ctx, cwd, commits) => {
      writeFileSync(join(cwd, "agent-files"), "");
      let harnessStarted = false;
      await assert.rejects(async () => {
        await mountInitialLocalStorage(
          ctx,
          depsFor(new AbortController().signal, async (path) => path === cwd),
        );
        harnessStarted = true;
      }, /Durable agent storage could not be mounted/);
      assert.equal(harnessStarted, false);
      assert.deepEqual(commits, ["cwd"]);
      assert.equal(ctx.env.agentMountedPath, undefined);
      assert.equal(
        existsSync(`${cwd}-agent`),
        false,
        "confirmed-detached sibling stub is removed",
      );
      assert.ok(
        lstatSync(join(cwd, "agent-files")).isFile(),
        "failed acquire does not modify serialized link",
      );
    });
  });

  it("repairs the serialized link after both mounts succeed", async () => {
    await withContext(async (ctx, cwd, commits) => {
      writeFileSync(join(cwd, "agent-files"), "");
      await mountInitialLocalStorage(
        ctx,
        depsFor(new AbortController().signal, async () => true),
      );
      assert.deepEqual(commits, ["cwd", "agent"]);
      assert.ok(lstatSync(join(cwd, "agent-files")).isSymbolicLink());
      assert.equal(readlinkSync(join(cwd, "agent-files")), `${cwd}-agent`);
      assert.ok(
        readFileSync(join(cwd, "agent-files", "README.md"), "utf8").length > 0,
      );
    });
  });

  it("preserves AbortError when an agent mount is cancelled", async () => {
    await withContext(async (ctx, cwd) => {
      const controller = new AbortController();
      await assert.rejects(
        mountInitialLocalStorage(
          ctx,
          depsFor(controller.signal, async (path) => {
            if (path !== cwd) controller.abort();
            return true;
          }),
        ),
        { name: "AbortError" },
      );
    });
  });

  it("stops when the agent mount throws without deleting an uncertain mountpoint", async () => {
    await withContext(async (ctx, cwd) => {
      await assert.rejects(
        mountInitialLocalStorage(
          ctx,
          depsFor(new AbortController().signal, async (path) => {
            if (path !== cwd) throw new Error("detach not confirmed");
            return true;
          }),
        ),
        /Durable agent storage could not be mounted/,
      );
      assert.ok(existsSync(`${cwd}-agent`));
    });
  });

  it("leaves explicitly unsigned storage and remote placement unchanged", async () => {
    await withContext(async (ctx) => {
      Object.assign(ctx.env, { mountCreds: null, agentMountCreds: null });
      const deps = depsFor(new AbortController().signal, async () => {
        throw new Error("unexpected mount");
      });
      await mountInitialLocalStorage(ctx, deps);
      Object.assign(ctx.env, {
        mountCreds: credentials,
        agentMountCreds: credentials,
      });
      ctx.plan.isDaytona = true;
      await mountInitialLocalStorage(ctx, deps);
    });
  });
});

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
