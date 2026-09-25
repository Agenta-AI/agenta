/**
 * A command sandbox carries its runner and deployment as labels; the deployment label names no
 * host. Nothing deletes by them: Daytona's own intervals remove a sandbox whose runner died.
 */
import { describe, expect, it } from "vitest";
import { DEPLOYMENT_LABEL, OWNER_LABEL, sandboxOwner } from "../../../src/engines/inprocess/sandbox/sandbox-owner.ts";
import { createTestWorkspace } from "../../utils/inprocess-workspace.ts";

describe("the owner labels", () => {
  it("label every sandbox with its runner and a digest of the deployment's API address", async () => {
    const owner = sandboxOwner("runner-a", "http://api.internal:8000/api");
    expect(owner.deployment).toMatch(/^[0-9a-f]{16}$/);
    expect(owner.deployment).not.toContain("api.internal");
    expect(sandboxOwner("runner-b", "http://api.internal:8000/api").deployment).toBe(owner.deployment);
    const w = createTestWorkspace({ owner });
    await w.bash("true");
    const [sandbox] = [...w.daytona.sandboxes.values()];
    expect(sandbox!.labels[OWNER_LABEL]).toBe("runner-a");
    expect(sandbox!.labels[DEPLOYMENT_LABEL]).toBe(owner.deployment);
    await w.workspace.sandbox.delete();
  });
});
