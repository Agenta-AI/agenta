/**
 * Unit tests for codex-specific E2B provisioning.
 *
 * Covers `uploadCodexAuthToE2BSandbox` (managed + self-managed), `prepareE2BCodexAssets`
 * (both modes, CODEX_API_KEY fallback, no-op for non-codex), and the `!plan.isRemoteSandbox`
 * gate on the local `writeCodexAuthFile` call.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-codex-e2b.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  E2B_CODEX_DIR,
  prepareE2BCodexAssets,
  uploadCodexAuthToE2BSandbox,
} from "../../src/engines/sandbox_agent/e2b.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// uploadCodexAuthToE2BSandbox — managed mode
// ---------------------------------------------------------------------------

describe("uploadCodexAuthToE2BSandbox", () => {
  it("writes auth.json with OPENAI_API_KEY into the sandbox (managed)", async () => {
    const written: Record<string, string> = {};
    const mkdirs: string[] = [];
    const sandbox = {
      mkdirFs: ({ path }: { path: string }) => {
        mkdirs.push(path);
        return Promise.resolve();
      },
      writeFsFile: ({ path }: { path: string }, content: string) => {
        written[path] = content;
        return Promise.resolve();
      },
    };

    await uploadCodexAuthToE2BSandbox(sandbox, "sk-e2b-test");

    assert.equal(mkdirs.length, 1);
    assert.match(mkdirs[0], /\.codex$/);
    const authPath = `${mkdirs[0]}/auth.json`;
    assert.ok(written[authPath], "auth.json was not written");
    const parsed = JSON.parse(written[authPath]);
    assert.equal(parsed.OPENAI_API_KEY, "sk-e2b-test");
  });

  it("logs and does not throw when mkdirFs rejects", async () => {
    const logs: string[] = [];
    const sandbox = {
      mkdirFs: () => Promise.reject(new Error("E2B filesystem error")),
      writeFsFile: () => Promise.resolve(),
    };

    await uploadCodexAuthToE2BSandbox(sandbox, "sk-test", (msg) => logs.push(msg));

    assert.ok(
      logs.some((l) => l.includes("codex auth.json upload skipped")),
      `expected skip log, got: ${logs.join(", ")}`,
    );
  });

  it("uploads local ~/.codex/auth.json when apiKey is undefined (self-managed)", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-e2b-codex-home-"));
    dirs.push(fakeHome);
    mkdirSync(join(fakeHome, ".codex"));
    writeFileSync(join(fakeHome, ".codex", "auth.json"), '{"OPENAI_API_KEY":"sk-own"}', "utf-8");
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;

    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) => calls.push({ path, body }),
    };

    try {
      await uploadCodexAuthToE2BSandbox(sandbox, undefined);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }

    const writeCall = calls.find((c) => c.path === `${E2B_CODEX_DIR}/auth.json`);
    assert.ok(writeCall, "auth.json must be uploaded from local home");
    assert.equal(writeCall?.body, '{"OPENAI_API_KEY":"sk-own"}');
  });

  it("does nothing when apiKey is undefined and no local auth.json exists", async () => {
    const emptyHome = mkdtempSync(join(tmpdir(), "agenta-e2b-empty-home-"));
    dirs.push(emptyHome);
    const originalHome = process.env.HOME;
    process.env.HOME = emptyHome;

    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) => calls.push({ path, body }),
    };

    try {
      await uploadCodexAuthToE2BSandbox(sandbox, undefined);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }

    assert.equal(
      calls.some((c) => c.path === `${E2B_CODEX_DIR}/auth.json`),
      false,
      "no auth.json written when nothing to upload",
    );
  });
});

// ---------------------------------------------------------------------------
// prepareE2BCodexAssets
// ---------------------------------------------------------------------------

describe("prepareE2BCodexAssets", () => {
  function makeSandbox(): { calls: Array<{ path: string; body?: string }>; sandbox: any } {
    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) => calls.push({ path, body }),
    };
    return { calls, sandbox };
  }

  it("is a no-op for non-codex runs", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareE2BCodexAssets({
      sandbox,
      plan: { acpAgent: "pi", credentialMode: "env", hasApiKey: true, secrets: {} },
    });

    assert.equal(calls.length, 0);
  });

  it("writes auth.json from the resolved key on a managed run", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareE2BCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: true,
        secrets: { OPENAI_API_KEY: "sk-managed" },
      },
    });

    const writeCall = calls.find((c) => c.path === `${E2B_CODEX_DIR}/auth.json`);
    assert.ok(writeCall, "auth.json must be written for a managed run");
    assert.equal(writeCall?.body, JSON.stringify({ OPENAI_API_KEY: "sk-managed" }));
  });

  it("prefers OPENAI_API_KEY over CODEX_API_KEY on a managed run", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareE2BCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: true,
        secrets: { OPENAI_API_KEY: "sk-openai", CODEX_API_KEY: "sk-codex" },
      },
    });

    const writeCall = calls.find((c) => c.path === `${E2B_CODEX_DIR}/auth.json`);
    assert.ok(writeCall);
    assert.equal(writeCall?.body, JSON.stringify({ OPENAI_API_KEY: "sk-openai" }));
  });

  it("falls back to CODEX_API_KEY when OPENAI_API_KEY is absent", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareE2BCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: true,
        secrets: { CODEX_API_KEY: "sk-codex-only" },
      },
    });

    const writeCall = calls.find((c) => c.path === `${E2B_CODEX_DIR}/auth.json`);
    assert.ok(writeCall);
    assert.equal(writeCall?.body, JSON.stringify({ OPENAI_API_KEY: "sk-codex-only" }));
  });

  it("does nothing on a managed run with no resolved key", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareE2BCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: false,
        secrets: {},
      },
    });

    assert.equal(
      calls.some((c) => c.path === `${E2B_CODEX_DIR}/auth.json`),
      false,
      "no auth.json written when managed key is absent",
    );
  });

  it("uploads local auth.json on a runtime_provided run", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-e2b-codex-rtprov-"));
    dirs.push(fakeHome);
    mkdirSync(join(fakeHome, ".codex"));
    writeFileSync(join(fakeHome, ".codex", "auth.json"), '{"OPENAI_API_KEY":"sk-own"}', "utf-8");
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;

    const { calls, sandbox } = makeSandbox();
    try {
      await prepareE2BCodexAssets({
        sandbox,
        plan: {
          acpAgent: "codex",
          credentialMode: "runtime_provided",
          hasApiKey: false,
          secrets: {},
        },
      });
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }

    const writeCall = calls.find((c) => c.path === `${E2B_CODEX_DIR}/auth.json`);
    assert.ok(writeCall, "auth.json must be uploaded on runtime_provided");
    assert.equal(writeCall?.body, '{"OPENAI_API_KEY":"sk-own"}');
  });

  it("does not upload on a credentialMode=none run", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareE2BCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "none",
        hasApiKey: false,
        secrets: {},
      },
    });

    assert.equal(
      calls.some((c) => c.path === `${E2B_CODEX_DIR}/auth.json`),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Local codex auth write is gated on !isRemoteSandbox
// ---------------------------------------------------------------------------

describe("codex auth.json write gating", () => {
  it("codex+local plan sets isE2B=false and isRemoteSandbox=false (local write path applies)", () => {
    const result = buildRunPlan(
      {
        harness: "codex",
        sandbox: "local",
        messages: [{ role: "user", content: "hi" }],
        secrets: { OPENAI_API_KEY: "sk-local" },
        credentialMode: "env",
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/codex-local" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.isE2B, false);
    assert.equal(result.plan.isRemoteSandbox, false);
    assert.equal(result.plan.acpAgent, "codex");
    assert.equal(result.plan.hasApiKey, true);
  });

  it("codex+e2b plan sets isE2B=true and isRemoteSandbox=true (sandbox upload path applies, not local write)", () => {
    const result = buildRunPlan(
      {
        harness: "codex",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hi" }],
        secrets: { OPENAI_API_KEY: "sk-e2b" },
        credentialMode: "env",
      } as AgentRunRequest,
      { createE2BCwd: () => "/root/work/agenta-abc" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.isE2B, true);
    assert.equal(result.plan.isRemoteSandbox, true);
    assert.equal(result.plan.acpAgent, "codex");
    assert.equal(result.plan.hasApiKey, true);
  });

  it("daemon env carries OPENAI_API_KEY for codex (the only codex provider key)", () => {
    const result = buildRunPlan(
      {
        harness: "codex",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hi" }],
        secrets: { OPENAI_API_KEY: "sk-e2b-codex" },
        credentialMode: "env",
      } as AgentRunRequest,
      { createE2BCwd: () => "/root/work/agenta-abc" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.secrets.OPENAI_API_KEY, "sk-e2b-codex");
    assert.equal(result.plan.secrets.ANTHROPIC_API_KEY, undefined);
  });
});
