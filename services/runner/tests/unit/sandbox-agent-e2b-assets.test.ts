/**
 * Unit tests for Claude-on-E2B asset provisioning.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-e2b-assets.test.ts)
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  prepareE2BClaudeAssets,
  prepareE2BPiAssets,
  E2B_CLAUDE_DIR,
} from "../../src/engines/sandbox_agent/e2b.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-e2b-assets-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Capture HOME / CLAUDE_CONFIG_DIR so we can restore them after each test.
const originalHome = process.env.HOME;
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
const originalClaudeSandboxDir = process.env.AGENTA_AGENT_SANDBOX_CLAUDE_DIR;
afterEach(() => {
  process.env.HOME = originalHome;
  if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  if (originalClaudeSandboxDir === undefined)
    delete process.env.AGENTA_AGENT_SANDBOX_CLAUDE_DIR;
  else process.env.AGENTA_AGENT_SANDBOX_CLAUDE_DIR = originalClaudeSandboxDir;
});

function fakeSandbox() {
  const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> = [];
  return {
    calls,
    sandbox: {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    },
  };
}

describe("prepareE2BClaudeAssets", () => {
  it("is a no-op when isClaude=false", async () => {
    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: false, credentialMode: "runtime_provided", hasApiKey: false },
    });
    assert.deepEqual(calls, []);
  });

  it("skips upload when credentialMode=env (managed key; no file upload)", async () => {
    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: "env", hasApiKey: true },
    });
    assert.deepEqual(calls, []);
  });

  it("skips upload when credentialMode=none", async () => {
    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: "none", hasApiKey: false },
    });
    assert.deepEqual(calls, []);
  });

  it("uploads only the allow-listed .credentials.json, not other ~/.claude files", async () => {
    const fakeHome = tempDir();
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), '{"token":"abc"}', "utf-8");
    // Files that must NOT be uploaded: other services' MCP tokens, settings/secrets, history.
    writeFileSync(join(claudeDir, ".mcp.json"), '{"mcpServers":{"foo":{"token":"secret"}}}', "utf-8");
    writeFileSync(join(claudeDir, "settings.json"), '{"auto":"true"}', "utf-8");
    writeFileSync(join(claudeDir, "history.jsonl"), '{"cmd":"whoami"}', "utf-8");
    process.env.HOME = fakeHome;

    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: "runtime_provided", hasApiKey: false },
    });

    assert.ok(
      calls.some((c) => c.op === "mkdir" && c.path === E2B_CLAUDE_DIR),
      "creates /root/.claude dir in the sandbox",
    );
    const creds = calls.find(
      (c) => c.op === "write" && c.path === `${E2B_CLAUDE_DIR}/.credentials.json`,
    );
    assert.ok(creds, "uploads .credentials.json");
    assert.equal(creds!.body, '{"token":"abc"}');

    const writePaths = calls.filter((c) => c.op === "write").map((c) => c.path);
    assert.equal(writePaths.length, 1, "uploads exactly one file (the allow-list)");
    assert.ok(
      !calls.some((c) => c.op === "write" && c.path === `${E2B_CLAUDE_DIR}/.mcp.json`),
      "does NOT upload .mcp.json (other services' MCP tokens)",
    );
    assert.ok(
      !calls.some((c) => c.op === "write" && c.path === `${E2B_CLAUDE_DIR}/settings.json`),
      "does NOT upload settings.json (the run's rendered harnessFiles copy wins)",
    );
    assert.ok(
      !calls.some((c) => c.op === "write" && c.path === `${E2B_CLAUDE_DIR}/history.jsonl`),
      "does NOT upload history.jsonl",
    );
  });

  it("honors CLAUDE_CONFIG_DIR for the source directory", async () => {
    const fakeHome = tempDir();
    const relocatedDir = tempDir();
    writeFileSync(join(relocatedDir, ".credentials.json"), '{"token":"relocated"}', "utf-8");
    process.env.HOME = fakeHome;
    process.env.CLAUDE_CONFIG_DIR = relocatedDir;

    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: "runtime_provided", hasApiKey: false },
    });

    const creds = calls.find(
      (c) => c.op === "write" && c.path === `${E2B_CLAUDE_DIR}/.credentials.json`,
    );
    assert.ok(creds, "reads from CLAUDE_CONFIG_DIR instead of ~/.claude");
    assert.equal(creds!.body, '{"token":"relocated"}');
  });

  it("honors AGENTA_AGENT_SANDBOX_CLAUDE_DIR for the sandbox destination dir", async () => {
    const fakeHome = tempDir();
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;
    process.env.AGENTA_AGENT_SANDBOX_CLAUDE_DIR = "/custom/claude/dir";

    // Re-import with the env var set before module init so the const picks it up.
    vi.resetModules();
    const mod = await import("../../src/engines/sandbox_agent/e2b.ts");

    const { sandbox, calls } = fakeSandbox();
    await mod.prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: "runtime_provided", hasApiKey: false },
    });

    assert.ok(
      calls.some((c) => c.op === "mkdir" && c.path === "/custom/claude/dir"),
      "creates the overridden sandbox dir",
    );
    assert.ok(
      calls.some(
        (c) => c.op === "write" && c.path === "/custom/claude/dir/.credentials.json",
      ),
      "writes into the overridden sandbox dir",
    );
  });

  it("is best-effort: logs on mkdir sandbox error but does not throw", async () => {
    const fakeHome = tempDir();
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;

    const logs: string[] = [];
    const brokenSandbox = {
      mkdirFs: async () => {
        throw new Error("sandbox unavailable");
      },
      writeFsFile: async () => {},
    };
    await prepareE2BClaudeAssets({
      sandbox: brokenSandbox,
      plan: { isClaude: true, credentialMode: "runtime_provided", hasApiKey: false },
      log: (msg) => logs.push(msg),
    });
    assert.ok(
      logs.some((l) => l.includes("claude auth upload skipped")),
      "error is logged, not thrown",
    );
  });

  it("logs (does not throw) when writing an allow-listed file to the sandbox fails", async () => {
    const fakeHome = tempDir();
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;

    const logs: string[] = [];
    const writeFailsSandbox = {
      mkdirFs: async () => {},
      writeFsFile: async () => {
        throw new Error("disk full");
      },
    };
    await prepareE2BClaudeAssets({
      sandbox: writeFailsSandbox,
      plan: { isClaude: true, credentialMode: "runtime_provided", hasApiKey: false },
      log: (msg) => logs.push(msg),
    });
    assert.ok(
      logs.some((l) => l.includes("claude auth upload failed for .credentials.json")),
      "write failure is logged with the file name, not silently swallowed",
    );
  });

  it("skips upload when ~/.claude does not exist on the host", async () => {
    const fakeHome = tempDir();
    process.env.HOME = fakeHome;

    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: "runtime_provided", hasApiKey: false },
    });
    assert.deepEqual(calls, []);
  });

  it("back-compat: uploads own-login when credentialMode is absent and no api key", async () => {
    const fakeHome = tempDir();
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;

    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: undefined, hasApiKey: false },
    });
    assert.ok(
      calls.some((c) => c.op === "write" && c.path.includes(".credentials.json")),
      "uploads on back-compat (no credentialMode, no api key)",
    );
  });

  it("back-compat: skips upload when credentialMode is absent but api key is present", async () => {
    const fakeHome = tempDir();
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;

    const { sandbox, calls } = fakeSandbox();
    await prepareE2BClaudeAssets({
      sandbox,
      plan: { isClaude: true, credentialMode: undefined, hasApiKey: true },
    });
    assert.deepEqual(calls, []);
  });
});

describe("prepareE2BPiAssets — isClaude runs are untouched", () => {
  it("is a no-op for Pi assets when isPi=false (Claude run)", async () => {
    const { sandbox, calls } = fakeSandbox();
    await prepareE2BPiAssets({
      sandbox,
      plan: {
        isPi: false,
        hasApiKey: true,
        credentialMode: "env",
        skillDirs: [],
        hasSystemPrompt: false,
        systemPrompt: undefined,
        appendSystemPrompt: undefined,
      },
    });
    assert.deepEqual(calls, []);
  });
});

// Integration-style tests (require a live E2B account + E2B_API_KEY env var).
// Skipped in CI. Run manually with E2B_API_KEY set to validate the end-to-end.
describe.skip("Claude-on-E2B integration (requires live E2B account)", () => {
  it("claude-on-e2b returns output and a trace id", async () => {
    // Requires: E2B_API_KEY set, E2B_TEMPLATE pointing to a template with the daemon baked in,
    // ANTHROPIC_API_KEY set.
    // Run manually after setting the above env vars.
    throw new Error("not implemented — run manually with E2B_API_KEY + ANTHROPIC_API_KEY");
  });

  it("e2b sandbox is torn down after a claude run (no leaked sandbox)", async () => {
    throw new Error("not implemented — run manually with E2B_API_KEY + ANTHROPIC_API_KEY");
  });
});
