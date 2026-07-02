/**
 * Unit tests for the harness-agnostic remote asset-prep seam.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-remote-assets.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  prepareRemoteHarnessAssets,
  writeCodexAuthToSandbox,
} from "../../src/engines/sandbox_agent/remote-assets.ts";

type Call = { op: "mkdir" | "write"; path: string; body?: string };

function makeSandbox(calls: Call[]) {
  return {
    mkdirFs: async ({ path }: { path: string }) => calls.push({ op: "mkdir", path }),
    writeFsFile: async ({ path }: { path: string }, body: string) =>
      calls.push({ op: "write", path, body }),
    runProcess: async () => ({ exitCode: 0, stderr: "" }),
  };
}

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    acpAgent: "pi",
    secrets: {} as Record<string, string>,
    credentialMode: undefined,
    hasApiKey: false,
    isPi: true,
    skillDirs: [],
    hasSystemPrompt: false,
    systemPrompt: undefined,
    appendSystemPrompt: undefined,
    ...overrides,
  };
}

describe("prepareRemoteHarnessAssets / pi", () => {
  it("delegates to prepareDaytonaPiAssets for the pi agent", async () => {
    const calls: Call[] = [];
    const sandbox = makeSandbox(calls);
    await prepareRemoteHarnessAssets({
      sandbox,
      plan: basePlan({ acpAgent: "pi", isPi: true, credentialMode: "runtime_provided" }),
    });
    // prepareDaytonaPiAssets calls mkdirFs for the Pi agent dir (even when auth is absent)
    // and then installPiInSandbox (which calls mkdirFs + runProcess). At minimum it calls
    // mkdirFs at least once (the Pi agent dir).
    const mkdirs = calls.filter((c) => c.op === "mkdir");
    assert.ok(mkdirs.length > 0, "expected Pi asset-prep to run mkdirFs");
  });
});

describe("prepareRemoteHarnessAssets / codex", () => {
  it("writes ~/.codex/auth.json with the resolved key", async () => {
    const calls: Call[] = [];
    const sandbox = makeSandbox(calls);
    await prepareRemoteHarnessAssets({
      sandbox,
      plan: basePlan({
        acpAgent: "codex",
        isPi: false,
        secrets: { OPENAI_API_KEY: "sk-test-key" },
      }),
    });
    const write = calls.find((c) => c.op === "write" && c.path.endsWith("auth.json"));
    assert.ok(write, "expected auth.json write");
    const parsed = JSON.parse(write!.body ?? "{}");
    assert.deepEqual(parsed, { OPENAI_API_KEY: "sk-test-key" });
  });

  it("skips the write when no OPENAI_API_KEY is present", async () => {
    const calls: Call[] = [];
    const logs: string[] = [];
    const sandbox = makeSandbox(calls);
    await prepareRemoteHarnessAssets({
      sandbox,
      plan: basePlan({ acpAgent: "codex", isPi: false, secrets: {} }),
      log: (msg) => logs.push(msg),
    });
    assert.equal(calls.length, 0, "expected no sandbox calls");
    assert.ok(logs.some((l) => l.includes("OPENAI_API_KEY")), "expected log about missing key");
  });
});

describe("prepareRemoteHarnessAssets / claude", () => {
  it("is a no-op (key already in env via sandbox envVars)", async () => {
    const calls: Call[] = [];
    const sandbox = makeSandbox(calls);
    await prepareRemoteHarnessAssets({
      sandbox,
      plan: basePlan({
        acpAgent: "claude",
        isPi: false,
        secrets: { ANTHROPIC_API_KEY: "key" },
      }),
    });
    assert.equal(calls.length, 0, "expected no sandbox calls for claude");
  });
});

describe("prepareRemoteHarnessAssets / opencode", () => {
  it("is a no-op (key already in env via sandbox envVars)", async () => {
    const calls: Call[] = [];
    const sandbox = makeSandbox(calls);
    await prepareRemoteHarnessAssets({
      sandbox,
      plan: basePlan({
        acpAgent: "opencode",
        isPi: false,
        secrets: { OPENAI_API_KEY: "key" },
      }),
    });
    assert.equal(calls.length, 0, "expected no sandbox calls for opencode");
  });
});

describe("prepareRemoteHarnessAssets / unknown agent", () => {
  it("logs and returns without throwing", async () => {
    const calls: Call[] = [];
    const logs: string[] = [];
    const sandbox = makeSandbox(calls);
    await prepareRemoteHarnessAssets({
      sandbox,
      plan: basePlan({ acpAgent: "future-harness", isPi: false }),
      log: (msg) => logs.push(msg),
    });
    assert.equal(calls.length, 0, "expected no sandbox calls for unknown agent");
    assert.ok(logs.some((l) => l.includes("future-harness")), "expected log about unknown agent");
  });
});

describe("writeCodexAuthToSandbox", () => {
  it("creates the dir and writes the auth file", async () => {
    const calls: Call[] = [];
    const sandbox = makeSandbox(calls);
    await writeCodexAuthToSandbox(sandbox, { OPENAI_API_KEY: "sk-direct" }, () => {});
    assert.deepEqual(calls[0], { op: "mkdir", path: "/root/.codex" });
    assert.ok(calls[1]?.path.endsWith("auth.json"));
    const body = JSON.parse(calls[1]!.body ?? "{}");
    assert.equal(body.OPENAI_API_KEY, "sk-direct");
  });
});
