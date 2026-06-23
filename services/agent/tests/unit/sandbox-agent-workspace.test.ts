/**
 * Unit tests for sandbox-agent workspace preparation.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-workspace.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareWorkspace } from "../../src/engines/sandbox_agent/workspace.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-workspace-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("prepareWorkspace", () => {
  it("prepares and cleans a local cwd", async () => {
    const cwd = tempDir();

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        cwd,
        relayDir: join(cwd, ".agenta-tools"),
        useToolRelay: true,
        agentsMd: "agent instructions",
      },
    });

    assert.equal(existsSync(join(cwd, ".agenta-tools")), true);
    assert.equal(readFileSync(join(cwd, "AGENTS.md"), "utf-8"), "agent instructions");

    await workspace.cleanup();
    assert.equal(existsSync(cwd), false);
  });

  it("prepares a Daytona cwd through the sandbox fs API", async () => {
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    const workspace = await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        cwd: "/home/sandbox/agenta-fixed",
        relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
        useToolRelay: true,
        agentsMd: "agent instructions",
      },
    });
    await workspace.cleanup();

    assert.deepEqual(calls, [
      { op: "mkdir", path: "/home/sandbox/agenta-fixed" },
      { op: "mkdir", path: "/home/sandbox/agenta-fixed/.agenta-tools" },
      {
        op: "write",
        path: "/home/sandbox/agenta-fixed/AGENTS.md",
        body: "agent instructions",
      },
    ]);
  });
});
