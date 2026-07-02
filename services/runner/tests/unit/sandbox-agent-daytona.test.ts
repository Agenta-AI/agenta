/**
 * Unit tests for sandbox-agent Daytona helper behavior.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-daytona.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DAYTONA_CODEX_DIR,
  DAYTONA_PI_DIR,
  DAYTONA_PI_INSTALL,
  DAYTONA_PI_INSTALL_DIR,
  createCookieFetch,
  daytonaEnvVars,
  prepareDaytonaCodexAssets,
  uploadCodexAuthToSandbox,
  uploadPiAuthToSandbox,
} from "../../src/engines/sandbox_agent/daytona.ts";

const envKeys = ["PI_CODING_AGENT_DIR", "AGENTA_AGENT_SANDBOX_CODEX_DIR"];
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

describe("uploadCodexAuthToSandbox", () => {
  it("writes auth.json from a resolved key (managed mode)", async () => {
    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ path, body }),
    };

    await uploadCodexAuthToSandbox(sandbox, "sk-test-key");

    assert.deepEqual(calls, [
      { path: DAYTONA_CODEX_DIR },
      {
        path: `${DAYTONA_CODEX_DIR}/auth.json`,
        body: JSON.stringify({ OPENAI_API_KEY: "sk-test-key" }),
      },
    ]);
  });

  it("uploads local ~/.codex/auth.json when no key is given (self-managed fallback)", async () => {
    const localCodexDir = mkdtempSync(join(tmpdir(), "agenta-codex-auth-test-"));
    dirs.push(localCodexDir);
    // Temporarily point HOME at our temp dir so homedir() resolves there.
    const originalHome = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-codex-home-test-"));
    dirs.push(fakeHome);
    mkdirSync(join(fakeHome, ".codex"));
    writeFileSync(
      join(fakeHome, ".codex", "auth.json"),
      '{"OPENAI_API_KEY":"sk-local"}',
      "utf-8",
    );
    process.env.HOME = fakeHome;

    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ path, body }),
    };

    try {
      await uploadCodexAuthToSandbox(sandbox, undefined);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }

    // The auth.json from the fake HOME is uploaded verbatim.
    const writeCall = calls.find((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`);
    assert.ok(writeCall, "auth.json must be written");
    assert.equal(writeCall?.body, '{"OPENAI_API_KEY":"sk-local"}');
  });

  it("does nothing when no key is given and no local auth.json exists", async () => {
    const emptyHome = mkdtempSync(join(tmpdir(), "agenta-codex-empty-home-"));
    dirs.push(emptyHome);
    const originalHome = process.env.HOME;
    process.env.HOME = emptyHome;

    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ path, body }),
    };

    try {
      await uploadCodexAuthToSandbox(sandbox, undefined);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }

    // mkdirFs was called but no writeFsFile since there is nothing to upload.
    assert.equal(
      calls.some((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`),
      false,
    );
  });
});

describe("prepareDaytonaCodexAssets", () => {
  function makeSandbox(): {
    calls: Array<{ path: string; body?: string }>;
    sandbox: any;
  } {
    const calls: Array<{ path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ path, body }),
    };
    return { calls, sandbox };
  }

  it("is a no-op for non-codex runs", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareDaytonaCodexAssets({
      sandbox,
      plan: { acpAgent: "pi", credentialMode: "env", hasApiKey: true, secrets: {} },
    });

    assert.equal(calls.length, 0);
  });

  it("writes auth.json from the resolved key on a managed run", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareDaytonaCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: true,
        secrets: { OPENAI_API_KEY: "sk-managed" },
      },
    });

    const writeCall = calls.find((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`);
    assert.ok(writeCall, "auth.json must be written for a managed run");
    assert.equal(writeCall?.body, JSON.stringify({ OPENAI_API_KEY: "sk-managed" }));
  });

  it("prefers OPENAI_API_KEY over CODEX_API_KEY on a managed run", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareDaytonaCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: true,
        secrets: { OPENAI_API_KEY: "sk-openai", CODEX_API_KEY: "sk-codex" },
      },
    });

    const writeCall = calls.find((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`);
    assert.ok(writeCall);
    assert.equal(writeCall?.body, JSON.stringify({ OPENAI_API_KEY: "sk-openai" }));
  });

  it("falls back to CODEX_API_KEY when OPENAI_API_KEY is absent", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareDaytonaCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: true,
        secrets: { CODEX_API_KEY: "sk-codex-only" },
      },
    });

    const writeCall = calls.find((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`);
    assert.ok(writeCall);
    assert.equal(writeCall?.body, JSON.stringify({ OPENAI_API_KEY: "sk-codex-only" }));
  });

  it("does nothing on a managed run with no resolved key", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareDaytonaCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "env",
        hasApiKey: false,
        secrets: {},
      },
    });

    assert.equal(
      calls.some((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`),
      false,
      "no auth.json written when managed key is absent",
    );
  });

  it("uploads local auth.json on a runtime_provided run", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "agenta-codex-rtprov-"));
    dirs.push(fakeHome);
    mkdirSync(join(fakeHome, ".codex"));
    writeFileSync(
      join(fakeHome, ".codex", "auth.json"),
      '{"OPENAI_API_KEY":"sk-own"}',
      "utf-8",
    );
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;

    const { calls, sandbox } = makeSandbox();
    try {
      await prepareDaytonaCodexAssets({
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

    const writeCall = calls.find((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`);
    assert.ok(writeCall, "auth.json must be uploaded on runtime_provided");
    assert.equal(writeCall?.body, '{"OPENAI_API_KEY":"sk-own"}');
  });

  it("does not upload on a credentialMode=none run", async () => {
    const { calls, sandbox } = makeSandbox();

    await prepareDaytonaCodexAssets({
      sandbox,
      plan: {
        acpAgent: "codex",
        credentialMode: "none",
        hasApiKey: false,
        secrets: {},
      },
    });

    assert.equal(
      calls.some((c) => c.path === `${DAYTONA_CODEX_DIR}/auth.json`),
      false,
    );
  });
});
