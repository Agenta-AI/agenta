/**
 * Unit tests for sandbox-agent workspace preparation.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-workspace.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  statSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("prepareWorkspace", () => {
  it("creates a missing ephemeral cwd after a local mount fallback", async () => {
    // mountStorage intentionally returns false when FUSE is unavailable. Model that fail-open
    // path by entering workspace preparation with no mountpoint directory at all.
    const root = tempDir();
    const cwd = join(root, "mounts", "session", "run");

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd,
          relayDir: join(cwd, ".agenta-tools"),
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    assert.equal(
      readFileSync(join(cwd, "CLAUDE.md"), "utf-8"),
      "agent instructions",
    );

    await workspace.cleanup();
    assert.equal(existsSync(cwd), false);
  });

  it("prepares and cleans a local cwd", async () => {
    const cwd = tempDir();

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        acpAgent: "pi",
        isPi: true,
        workspace: {
          cwd,
          relayDir: join(cwd, ".agenta-tools"),
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: true,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    assert.equal(existsSync(join(cwd, ".agenta-tools")), true);
    assert.equal(
      readFileSync(join(cwd, "AGENTS.md"), "utf-8"),
      "agent instructions",
    );
    // A Pi run never gets a Claude settings file.
    assert.equal(existsSync(join(cwd, ".claude", "settings.json")), false);

    await workspace.cleanup();
    assert.equal(existsSync(cwd), false);
  });

  it("makes the runner-host relay folder private to the runner's user (flag-safety round)", async () => {
    const root = tempDir();
    const cwd = join(root, "cwd");
    const relayDir = join(root, "relay-base", "conv-1");

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        acpAgent: "pi",
        isPi: true,
        workspace: { cwd, relayDir, telemetryDir: join(root, "telemetry"), skillDirs: [] },
        tools: { useToolRelay: true },
        prompt: {},
      },
    });

    assert.equal(statSync(relayDir).mode & 0o777, 0o700);
    await workspace.cleanup();
  });

  it("creates Pi telemetry without creating an unused local tool relay", async () => {
    const root = tempDir();
    const cwd = join(root, "cwd");
    const relayDir = join(root, "relay");
    const telemetryDir = join(root, "telemetry");

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        acpAgent: "pi",
        isPi: true,
        workspace: {
          cwd,
          relayDir,
          telemetryDir,
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {},
      },
    });

    assert.equal(
      existsSync(telemetryDir),
      true,
      "Pi always has a directory for trace and usage publication",
    );
    assert.equal(
      existsSync(relayDir),
      false,
      "a chat with no executable tools does not need a relay directory",
    );

    await workspace.cleanup();
  });

  it("clears a stale .req.json left from a prior turn before the next turn starts", async () => {
    const cwd = tempDir();
    const relayDir = join(cwd, ".agenta-tools");

    // Simulate a prior turn's relay dir with an unconsumed (or already-answered) request.
    mkdirSync(relayDir, { recursive: true });
    writeFileSync(join(relayDir, "stale-call.req.json"), "{}", "utf-8");

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        acpAgent: "pi",
        isPi: true,
        workspace: {
          cwd,
          relayDir,
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: true,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    assert.equal(
      existsSync(join(relayDir, "stale-call.req.json")),
      false,
      "the stale request file from the prior turn must not survive into the next turn",
    );
    assert.equal(
      existsSync(relayDir),
      true,
      "the relay dir itself is recreated",
    );

    await workspace.cleanup();
  });

  it("clears the Daytona relay dir via runProcess before recreating it", async () => {
    const calls: Array<{
      op: string;
      path?: string;
      command?: string;
      args?: string[];
    }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, _body: string) =>
        calls.push({ op: "write", path }),
      runProcess: async (opts: { command: string; args?: string[] }) =>
        calls.push({ op: "run", command: opts.command, args: opts.args }),
    };

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        acpAgent: "pi",
        isPi: true,
        workspace: {
          cwd: "/home/sandbox/agenta-fixed",
          relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: true,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    const runIndex = calls.findIndex((c) => c.op === "run");
    const mkdirRelayIndex = calls.findIndex(
      (c) =>
        c.op === "mkdir" &&
        c.path === "/home/sandbox/agenta-fixed/.agenta-tools",
    );
    assert.ok(runIndex !== -1, "the relay dir is cleared via runProcess");
    assert.equal(
      calls[runIndex]?.command,
      "rm",
      "clears with a direct rm exec, not a shell",
    );
    assert.deepEqual(
      calls[runIndex]?.args,
      ["-rf", "--", "/home/sandbox/agenta-fixed/.agenta-tools"],
      "clears exactly the relay dir (argv, no shell interpolation), not the durable cwd",
    );
    assert.ok(
      runIndex < mkdirRelayIndex,
      "the clear happens before the relay dir is recreated",
    );
  });

  it("writes claude instructions to CLAUDE.md, not AGENTS.md (local)", async () => {
    // claude-agent-sdk's memory loader auto-loads CLAUDE.md, never AGENTS.md, so the claude
    // harness's instructions must land in CLAUDE.md to be read at all.
    const cwd = tempDir();

    const workspace = await prepareWorkspace({
      sandbox: {},
      plan: {
        isDaytona: false,
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd,
          relayDir: join(cwd, ".agenta-tools"),
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    assert.equal(
      readFileSync(join(cwd, "CLAUDE.md"), "utf-8"),
      "agent instructions",
    );
    // The AGENTS.md name is Pi's; a claude run must not use it (the loader ignores it).
    assert.equal(existsSync(join(cwd, "AGENTS.md")), false);

    await workspace.cleanup();
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
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd,
          relayDir: join(cwd, ".agenta-tools"),
          telemetryDir: "/tmp/agenta-telemetry-test",
          harnessFiles: [{ path: ".claude/settings.json", content }],
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
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
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd,
          relayDir: join(cwd, ".agenta-tools"),
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    assert.equal(existsSync(join(cwd, ".claude", "settings.json")), false);
  });

  it("prepares a Daytona cwd through the sandbox fs API", async () => {
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> =
      [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    const workspace = await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        acpAgent: "pi",
        isPi: true,
        workspace: {
          cwd: "/home/sandbox/agenta-fixed",
          relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: true,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });
    await workspace.cleanup();

    assert.deepEqual(calls, [
      { op: "mkdir", path: "/home/sandbox/agenta-fixed" },
      { op: "mkdir", path: "/home/sandbox/agenta-fixed/.agenta-tools" },
      { op: "mkdir", path: "/tmp/agenta-telemetry-test" },
      {
        op: "write",
        path: "/home/sandbox/agenta-fixed/AGENTS.md",
        body: "agent instructions",
      },
    ]);
  });

  it("writes claude instructions to CLAUDE.md on Daytona", async () => {
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> =
      [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd: "/home/sandbox/agenta-fixed",
          relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    // The instructions land in CLAUDE.md (the name claude-agent-sdk loads), never AGENTS.md.
    assert.ok(
      calls.some(
        (c) =>
          c.op === "write" &&
          c.path === "/home/sandbox/agenta-fixed/CLAUDE.md" &&
          c.body === "agent instructions",
      ),
      "instructions are written to CLAUDE.md via the fs API",
    );
    assert.ok(
      !calls.some((c) => c.path === "/home/sandbox/agenta-fixed/AGENTS.md"),
      "a claude run never writes AGENTS.md",
    );
  });

  it("writes a nested harnessFiles entry on Daytona via the fs API", async () => {
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> =
      [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };
    const content = JSON.stringify(
      { permissions: { deny: ["Bash"] } },
      null,
      2,
    );

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd: "/home/sandbox/agenta-fixed",
          relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
          telemetryDir: "/tmp/agenta-telemetry-test",
          harnessFiles: [{ path: ".claude/settings.json", content }],
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
      },
    });

    // The parent dir of the nested path is created via the fs API.
    const claudeDir = calls.find(
      (c) =>
        c.op === "mkdir" && c.path === "/home/sandbox/agenta-fixed/.claude",
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
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> =
      [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        acpAgent: "pi",
        isPi: true,
        workspace: {
          cwd: "/home/sandbox/agenta-fixed",
          relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {
          agentsMd: "agent instructions",
        },
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
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd,
          relayDir: join(cwd, ".agenta-tools"),
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [{ name: "release-notes", dir: skillDir }],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {},
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
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> =
      [];
    const skillDir = tempDir();
    writeFileSync(join(skillDir, "SKILL.md"), "skill", "utf-8");
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    await prepareWorkspace({
      sandbox,
      plan: {
        isDaytona: true,
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd: "/home/sandbox/agenta-fixed",
          relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [{ name: "release-notes", dir: skillDir }],
        },
        tools: {
          useToolRelay: false,
        },
        prompt: {},
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

  it("skips only the skill whose upload fails and writes the others", async () => {
    const goodDir = tempDir();
    writeFileSync(join(goodDir, "SKILL.md"), "good", "utf-8");
    const badDir = tempDir();
    writeFileSync(join(badDir, "SKILL.md"), "bad", "utf-8");
    const writes: string[] = [];
    const logs: string[] = [];
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async ({ path }: { path: string }) => {
        if (path.includes("/broken/")) throw new Error("write refused");
        writes.push(path);
      },
    };

    await prepareWorkspace({
      sandbox,
      log: (message) => logs.push(message),
      plan: {
        isDaytona: true,
        acpAgent: "claude",
        isPi: false,
        workspace: {
          cwd: "/home/sandbox/agenta-fixed",
          relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
          telemetryDir: "/tmp/agenta-telemetry-test",
          skillDirs: [
            { name: "broken", dir: badDir },
            { name: "release-notes", dir: goodDir },
          ],
        },
        tools: { useToolRelay: false },
        prompt: { agentsMd: "instructions" },
      },
    });

    assert.deepEqual(writes.sort(), [
      "/home/sandbox/agenta-fixed/.claude/skills/release-notes/SKILL.md",
      "/home/sandbox/agenta-fixed/CLAUDE.md",
    ]);
    assert.ok(
      logs.some((line) => line.includes("skill workspace upload skipped for broken")),
    );
  });

  it("waits for every write before it raises the first write error", async () => {
    let settled = 0;
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async ({ path }: { path: string }) => {
        if (path.endsWith("CLAUDE.md")) throw new Error("instructions refused");
        await new Promise((resolve) => setTimeout(resolve, 5));
        settled += 1;
      },
    };

    await assert.rejects(
      () =>
        prepareWorkspace({
          sandbox,
          plan: {
            isDaytona: true,
            acpAgent: "claude",
            isPi: false,
            workspace: {
              cwd: "/home/sandbox/agenta-fixed",
              relayDir: "/home/sandbox/agenta-fixed/.agenta-tools",
              telemetryDir: "/tmp/agenta-telemetry-test",
              harnessFiles: [
                { path: ".claude/settings.json", content: "{}" },
                { path: ".claude/other.json", content: "{}" },
              ],
              skillDirs: [],
            },
            tools: { useToolRelay: false },
            prompt: { agentsMd: "instructions" },
          },
        }),
      /instructions refused/,
    );
    assert.equal(settled, 2);
  });
});
