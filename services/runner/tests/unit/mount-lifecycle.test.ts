import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
