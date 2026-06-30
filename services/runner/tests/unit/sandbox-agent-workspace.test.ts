/**
 * Unit tests for sandbox-agent workspace preparation.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-workspace.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        acpAgent: "pi",
        isPi: true,
        skillDirs: [],
      },
    });

    assert.equal(existsSync(join(cwd, ".agenta-tools")), true);
    assert.equal(readFileSync(join(cwd, "AGENTS.md"), "utf-8"), "agent instructions");
    // A Pi run never gets a Claude settings file.
    assert.equal(existsSync(join(cwd, ".claude", "settings.json")), false);

    await workspace.cleanup();
    assert.equal(existsSync(cwd), false);
  });

  it("writes a nested harnessFiles entry (.claude/settings.json) for a local run", async () => {
    const cwd = tempDir();
    // The Python harness adapter already rendered the file; the runner just writes it blind,
    // creating the parent dir for the nested path.
    const content = JSON.stringify(
      {
        permissions: {
          defaultMode: "acceptEdits",
          allow: ["Read"],
          deny: ["WebFetch", "WebSearch"],
        },
      },
      null,
      2,
    );

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        cwd,
        relayDir: join(cwd, ".agenta-tools"),
        useToolRelay: false,
        agentsMd: "agent instructions",
        acpAgent: "claude",
        isPi: false,
        harnessFiles: [{ path: ".claude/settings.json", content }],
        skillDirs: [],
      },
    });

    const settingsPath = join(cwd, ".claude", "settings.json");
    assert.equal(existsSync(settingsPath), true);
    // The runner writes the content verbatim (no re-serialization).
    assert.equal(readFileSync(settingsPath, "utf-8"), content);

    await workspace.cleanup();
  });

  it("writes no harness file for a plan with no harnessFiles", async () => {
    const cwd = tempDir();

    await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        cwd,
        relayDir: join(cwd, ".agenta-tools"),
        useToolRelay: false,
        agentsMd: "agent instructions",
        acpAgent: "claude",
        isPi: false,
        skillDirs: [],
      },
    });

    assert.equal(existsSync(join(cwd, ".claude", "settings.json")), false);
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
        acpAgent: "pi",
        isPi: true,
        skillDirs: [],
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

  it("writes a nested harnessFiles entry on Daytona via the fs API", async () => {
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };
    const content = JSON.stringify({ permissions: { deny: ["Bash"] } }, null, 2);

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        cwd: "/home/sandbox/agenta-fixed",
        relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
        useToolRelay: false,
        agentsMd: "agent instructions",
        acpAgent: "claude",
        isPi: false,
        harnessFiles: [{ path: ".claude/settings.json", content }],
        skillDirs: [],
      },
    });

    // The parent dir of the nested path is created via the fs API.
    const claudeDir = calls.find(
      (c) => c.op === "mkdir" && c.path === "/home/sandbox/agenta-fixed/.claude",
    );
    assert.ok(claudeDir, ".claude dir is created via the fs API");
    const write = calls.find(
      (c) =>
        c.op === "write" &&
        c.path === "/home/sandbox/agenta-fixed/.claude/settings.json",
    );
    assert.ok(write, "settings.json is written via the fs API");
    // Written verbatim (the runner does not re-serialize harness-rendered content).
    assert.equal(write!.body, content);
  });

  it("writes no harness file on Daytona for a plan with no harnessFiles", async () => {
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        cwd: "/home/sandbox/agenta-fixed",
        relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
        useToolRelay: false,
        agentsMd: "agent instructions",
        acpAgent: "pi",
        isPi: true,
        skillDirs: [],
      },
    });

    assert.ok(
      !calls.some((c) => c.path.includes(".claude")),
      "no .claude path is touched",
    );
  });

  it("writes Claude skills into the project-local .claude/skills tree for a local run", async () => {
    const cwd = tempDir();
    const skillDir = tempDir();
    const skillFile = join(skillDir, "SKILL.md");
    writeFileSync(skillFile, "---\nname: release-notes\n---\n", "utf-8");

    await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        cwd,
        relayDir: join(cwd, ".agenta-tools"),
        useToolRelay: false,
        acpAgent: "claude",
        isPi: false,
        skillDirs: [{ name: "release-notes", dir: skillDir }],
      },
    });

    assert.equal(
      readFileSync(
        join(cwd, ".claude", "skills", "release-notes", "SKILL.md"),
        "utf-8",
      ),
      "---\nname: release-notes\n---\n",
    );
  });

  it("uploads Claude skills into the project-local .claude/skills tree on Daytona", async () => {
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> = [];
    const skillDir = tempDir();
    writeFileSync(join(skillDir, "SKILL.md"), "skill", "utf-8");
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        cwd: "/home/sandbox/agenta-fixed",
        relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
        useToolRelay: false,
        acpAgent: "claude",
        isPi: false,
        skillDirs: [{ name: "release-notes", dir: skillDir }],
      },
    });

    assert.ok(
      calls.some(
        (c) =>
          c.op === "write" &&
          c.path ===
            "/home/sandbox/agenta-fixed/.claude/skills/release-notes/SKILL.md",
      ),
      "SKILL.md is uploaded to Claude's project-local skill tree",
    );
  });
});
