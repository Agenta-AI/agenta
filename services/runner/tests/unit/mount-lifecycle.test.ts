import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import type { AcquireContext } from "../../src/environment/acquire-context.ts";
import {
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
