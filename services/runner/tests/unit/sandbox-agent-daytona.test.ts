/**
 * Unit tests for sandbox-agent Daytona helper behavior.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-daytona.test.ts)
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DAYTONA_CLAUDE_DIR,
  DAYTONA_PI_DIR,
  DAYTONA_PI_INSTALL,
  DAYTONA_PI_INSTALL_DIR,
  createCookieFetch,
  daytonaEnvVars,
  prepareDaytonaClaudeAssets,
  uploadClaudeAuthToSandbox,
  uploadPiAuthToSandbox,
} from "../../src/engines/sandbox_agent/daytona.ts";

const envKeys = [
  "PI_CODING_AGENT_DIR",
  "HOME",
  "CLAUDE_CONFIG_DIR",
  "AGENTA_AGENT_SANDBOX_CLAUDE_DIR",
];
const previousEnv = new Map<string, string | undefined>();
for (const key of envKeys) previousEnv.set(key, process.env[key]);

const dirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
});

describe("daytonaEnvVars", () => {
  it("combines Pi agent dir, extension env, provider secrets, and Pi command", () => {
    const env = daytonaEnvVars(
      { TRACEPARENT: "trace", AGENTA_AGENT_TOOLS_RELAY_DIR: "/relay" },
      { OPENAI_API_KEY: "key" },
    );

    assert.equal(env.PI_CODING_AGENT_DIR, DAYTONA_PI_DIR);
    assert.equal(env.TRACEPARENT, "trace");
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, "/relay");
    assert.equal(env.OPENAI_API_KEY, "key");
    if (DAYTONA_PI_INSTALL) {
      assert.equal(env.PI_ACP_PI_COMMAND, `${DAYTONA_PI_INSTALL_DIR}/node_modules/.bin/pi`);
    }
  });
});

describe("uploadPiAuthToSandbox", () => {
  it("uploads local Pi auth and settings when present", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "agenta-pi-auth-test-"));
    dirs.push(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeFileSync(join(agentDir, "auth.json"), "{\"token\":\"x\"}", "utf-8");
    writeFileSync(join(agentDir, "settings.json"), "{\"approval\":\"never\"}", "utf-8");
    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) => calls.push({ path, body }),
    };

    await uploadPiAuthToSandbox(sandbox);

    assert.deepEqual(calls, [
      { path: DAYTONA_PI_DIR },
      { path: `${DAYTONA_PI_DIR}/auth.json`, body: "{\"token\":\"x\"}" },
      { path: `${DAYTONA_PI_DIR}/settings.json`, body: "{\"approval\":\"never\"}" },
    ]);
  });
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

describe("uploadClaudeAuthToSandbox", () => {
  it("uploads only the allow-listed .credentials.json, not other ~/.claude files", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), '{"token":"abc"}', "utf-8");
    // Files that must NOT be uploaded: other services' MCP tokens, settings/secrets, history.
    writeFileSync(join(claudeDir, ".mcp.json"), '{"mcpServers":{"foo":{"token":"secret"}}}', "utf-8");
    writeFileSync(join(claudeDir, "settings.json"), '{"auto":"true"}', "utf-8");
    writeFileSync(join(claudeDir, "history.jsonl"), '{"cmd":"whoami"}', "utf-8");
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;

    const { sandbox, calls } = fakeSandbox();
    await uploadClaudeAuthToSandbox(sandbox);

    assert.ok(
      calls.some((c) => c.op === "mkdir" && c.path === DAYTONA_CLAUDE_DIR),
      "creates the claude dir in the sandbox",
    );
    const creds = calls.find(
      (c) => c.op === "write" && c.path === `${DAYTONA_CLAUDE_DIR}/.credentials.json`,
    );
    assert.ok(creds, "uploads .credentials.json");
    assert.equal(creds!.body, '{"token":"abc"}');

    const writePaths = calls.filter((c) => c.op === "write").map((c) => c.path);
    assert.equal(writePaths.length, 1, "uploads exactly one file (the allow-list)");
    assert.ok(
      !calls.some((c) => c.op === "write" && c.path === `${DAYTONA_CLAUDE_DIR}/.mcp.json`),
      "does NOT upload .mcp.json (other services' MCP tokens)",
    );
    assert.ok(
      !calls.some((c) => c.op === "write" && c.path === `${DAYTONA_CLAUDE_DIR}/settings.json`),
      "does NOT upload settings.json (the run's rendered harnessFiles copy wins)",
    );
    assert.ok(
      !calls.some((c) => c.op === "write" && c.path === `${DAYTONA_CLAUDE_DIR}/history.jsonl`),
      "does NOT upload history.jsonl",
    );
  });

  it("honors CLAUDE_CONFIG_DIR for the source directory", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const relocatedDir = mkdtempSync(join(tmpdir(), "agenta-claude-relocated-test-"));
    dirs.push(relocatedDir);
    writeFileSync(join(relocatedDir, ".credentials.json"), '{"token":"relocated"}', "utf-8");
    process.env.HOME = fakeHome;
    process.env.CLAUDE_CONFIG_DIR = relocatedDir;

    const { sandbox, calls } = fakeSandbox();
    await uploadClaudeAuthToSandbox(sandbox);

    const creds = calls.find(
      (c) => c.op === "write" && c.path === `${DAYTONA_CLAUDE_DIR}/.credentials.json`,
    );
    assert.ok(creds, "reads from CLAUDE_CONFIG_DIR instead of ~/.claude");
    assert.equal(creds!.body, '{"token":"relocated"}');
  });

  it("honors AGENTA_AGENT_SANDBOX_CLAUDE_DIR for the sandbox destination dir", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.AGENTA_AGENT_SANDBOX_CLAUDE_DIR = "/custom/claude/dir";

    // Re-import with the env var set before module init so the const picks it up.
    vi.resetModules();
    const mod = await import("../../src/engines/sandbox_agent/daytona.ts");

    const { sandbox, calls } = fakeSandbox();
    await mod.uploadClaudeAuthToSandbox(sandbox);

    assert.ok(
      calls.some((c) => c.op === "mkdir" && c.path === "/custom/claude/dir"),
      "creates the overridden sandbox dir",
    );
    assert.ok(
      calls.some((c) => c.op === "write" && c.path === "/custom/claude/dir/.credentials.json"),
      "writes into the overridden sandbox dir",
    );
  });

  it("is best-effort: logs on mkdir sandbox error but does not throw", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;

    const logs: string[] = [];
    const brokenSandbox = {
      mkdirFs: async () => {
        throw new Error("sandbox unavailable");
      },
      writeFsFile: async () => {},
    };
    await uploadClaudeAuthToSandbox(brokenSandbox, (msg) => logs.push(msg));
    assert.ok(
      logs.some((l) => l.includes("claude auth upload skipped")),
      "error is logged, not thrown",
    );
  });

  it("logs (does not throw) when writing an allow-listed file to the sandbox fails", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;

    const logs: string[] = [];
    const writeFailsSandbox = {
      mkdirFs: async () => {},
      writeFsFile: async () => {
        throw new Error("disk full");
      },
    };
    await uploadClaudeAuthToSandbox(writeFailsSandbox, (msg) => logs.push(msg));
    assert.ok(
      logs.some((l) => l.includes("claude auth upload failed for .credentials.json")),
      "write failure is logged with the file name, not silently swallowed",
    );
  });

  it("skips upload when ~/.claude does not exist on the host", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;

    const { sandbox, calls } = fakeSandbox();
    await uploadClaudeAuthToSandbox(sandbox);
    assert.deepEqual(calls, []);
  });
});

describe("prepareDaytonaClaudeAssets", () => {
  it("is a no-op for non-claude runs", async () => {
    const { sandbox, calls } = fakeSandbox();
    await prepareDaytonaClaudeAssets({
      sandbox,
      plan: { acpAgent: "pi", credentialMode: "runtime_provided", hasApiKey: false },
    });
    assert.deepEqual(calls, []);
  });

  it("skips upload when credentialMode=env (managed key; no file upload)", async () => {
    const { sandbox, calls } = fakeSandbox();
    await prepareDaytonaClaudeAssets({
      sandbox,
      plan: { acpAgent: "claude", credentialMode: "env", hasApiKey: true },
    });
    assert.deepEqual(calls, []);
  });

  it("skips upload when credentialMode=none", async () => {
    const { sandbox, calls } = fakeSandbox();
    await prepareDaytonaClaudeAssets({
      sandbox,
      plan: { acpAgent: "claude", credentialMode: "none", hasApiKey: false },
    });
    assert.deepEqual(calls, []);
  });

  it("uploads own-login credentials on a runtime_provided run", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), '{"token":"abc"}', "utf-8");
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;

    const { sandbox, calls } = fakeSandbox();
    await prepareDaytonaClaudeAssets({
      sandbox,
      plan: { acpAgent: "claude", credentialMode: "runtime_provided", hasApiKey: false },
    });

    const creds = calls.find(
      (c) => c.op === "write" && c.path === `${DAYTONA_CLAUDE_DIR}/.credentials.json`,
    );
    assert.ok(creds, "uploads .credentials.json on runtime_provided");
    assert.equal(creds!.body, '{"token":"abc"}');
  });

  it("back-compat: uploads own-login when credentialMode is absent and no api key", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;

    const { sandbox, calls } = fakeSandbox();
    await prepareDaytonaClaudeAssets({
      sandbox,
      plan: { acpAgent: "claude", credentialMode: undefined, hasApiKey: false },
    });
    assert.ok(
      calls.some((c) => c.op === "write" && c.path.includes(".credentials.json")),
      "uploads on back-compat (no credentialMode, no api key)",
    );
  });

  it("back-compat: skips upload when credentialMode is absent but api key is present", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-claude-home-test-"));
    dirs.push(fakeHome);
    const claudeDir = join(fakeHome, ".claude");
    mkdirSync(claudeDir);
    writeFileSync(join(claudeDir, ".credentials.json"), "{}", "utf-8");
    process.env.HOME = fakeHome;
    delete process.env.CLAUDE_CONFIG_DIR;

    const { sandbox, calls } = fakeSandbox();
    await prepareDaytonaClaudeAssets({
      sandbox,
      plan: { acpAgent: "claude", credentialMode: undefined, hasApiKey: true },
    });
    assert.deepEqual(calls, []);
  });
});

describe("createCookieFetch", () => {
  it("persists Daytona preview cookies per host", async () => {
    const seenCookies: Array<string | null> = [];
    const innerFetch = (async (_input: any, init?: any) => {
      seenCookies.push(new Headers(init?.headers).get("cookie"));
      return new Response("ok", { headers: { "set-cookie": "session=abc; Path=/" } });
    }) as typeof fetch;
    const cookieFetch = createCookieFetch(innerFetch);

    await cookieFetch("https://sandbox.example.test/first");
    await cookieFetch("https://sandbox.example.test/second", {
      headers: { cookie: "existing=1" },
    });
    await cookieFetch("https://other.example.test/first");

    assert.deepEqual(seenCookies, [null, "existing=1; session=abc", null]);
  });
});
