/**
 * Unit tests for the durable mount ROOTS — the one directory per sandbox provider that every
 * session's drive hangs off.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/durable-mount-root.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  buildRunPlan,
  DAYTONA_DURABLE_MOUNT_ROOT,
  LOCAL_DURABLE_MOUNT_ROOT,
} from "../../src/engines/sandbox_agent/run-plan.ts";

const PREFIX = "mounts/proj-1/mount-abc";

describe("durable mount roots", () => {
  it("keeps the local root out of /tmp", () => {
    // Every harness treats /tmp as scratch it may clear, and on the local provider ONE mount
    // namespace holds every concurrent session's geesefs mount, so a session clearing /tmp reached
    // drives it did not own (2026-09-10 data loss). The root reads as an arbitrary literal at its
    // definition, so pin it here: moving it back fails this test rather than a review.
    assert.equal(LOCAL_DURABLE_MOUNT_ROOT, "/var/lib/agenta");
    assert.ok(!LOCAL_DURABLE_MOUNT_ROOT.startsWith("/tmp"));
  });

  it("keeps `agenta` a bare segment with `mounts` directly beneath it", () => {
    // The UI recovers a drive path from a harness tool path by scanning for exactly that pair
    // (`sandboxRootEnd`, @agenta/entities). A root that folds `agenta` into a longer segment, or
    // that repeats `mounts`, does not fail anything here — it silently resolves every file card
    // and chat file link to the wrong path, or to none.
    for (const root of [LOCAL_DURABLE_MOUNT_ROOT, DAYTONA_DURABLE_MOUNT_ROOT]) {
      const segments = `${root}/${PREFIX}`.split("/").filter(Boolean);
      const agentaAt = segments.indexOf("agenta");
      assert.notEqual(agentaAt, -1, `'${root}' has no bare 'agenta' segment`);
      assert.equal(
        segments[agentaAt + 1],
        "mounts",
        `'${root}' does not put 'mounts' directly under 'agenta'`,
      );
      assert.equal(
        segments.filter((segment) => segment === "mounts").length,
        1,
        `'${root}/${PREFIX}' repeats the 'mounts' segment`,
      );
    }
  });

  it("plans a local durable cwd under the local root", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      {
        durableCwd: `${LOCAL_DURABLE_MOUNT_ROOT}/${PREFIX}`,
        // Stand in for the real helper, which would mkdir the path. Its only job here is to hand
        // back whatever durable cwd it was given.
        createLocalCwd: (durable) =>
          durable ?? "/tmp/agenta-sandbox-agent-fallback",
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.plan.workspace.cwd,
      "/var/lib/agenta/mounts/proj-1/mount-abc",
    );
    assert.ok(!result.plan.workspace.cwd.startsWith("/tmp/"));
  });
});
