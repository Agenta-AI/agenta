/**
 * Unit tests for sandbox-agent Daytona helper behavior.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-daytona.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DAYTONA_OPENCODE_ARCH_ENV_VAR,
  DAYTONA_PI_DIR,
  DAYTONA_PI_INSTALL,
  DAYTONA_PI_INSTALL_DIR,
  createCookieFetch,
  daytonaEnvVars,
  opencodeArchEnv,
  prepareDaytonaOpencodeAssets,
  uploadPiAuthToSandbox,
} from "../../src/engines/sandbox_agent/daytona.ts";

const envKeys = ["PI_CODING_AGENT_DIR", DAYTONA_OPENCODE_ARCH_ENV_VAR];
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
    delete process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR];
    const env = daytonaEnvVars(
      "pi",
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

  it("injects arch override for opencode when AGENTA_AGENT_SANDBOX_OPENCODE_ARCH is set", () => {
    process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR] = "linux-arm64";
    const env = daytonaEnvVars("opencode", {}, { ANTHROPIC_API_KEY: "key" });
    assert.equal(env[DAYTONA_OPENCODE_ARCH_ENV_VAR], "linux-arm64");
  });

  it("omits arch override for opencode when AGENTA_AGENT_SANDBOX_OPENCODE_ARCH is unset", () => {
    delete process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR];
    const env = daytonaEnvVars("opencode", {}, {});
    assert.equal(env[DAYTONA_OPENCODE_ARCH_ENV_VAR], undefined);
  });

  it("omits arch override for pi even when AGENTA_AGENT_SANDBOX_OPENCODE_ARCH is set", () => {
    process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR] = "linux-arm64";
    const env = daytonaEnvVars("pi", {}, {});
    assert.equal(env[DAYTONA_OPENCODE_ARCH_ENV_VAR], undefined);
  });

  it("omits arch override for unknown harnesses even when AGENTA_AGENT_SANDBOX_OPENCODE_ARCH is set", () => {
    process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR] = "linux-arm64";
    const env = daytonaEnvVars("codex", {}, {});
    assert.equal(env[DAYTONA_OPENCODE_ARCH_ENV_VAR], undefined);
  });
});

describe("opencodeArchEnv", () => {
  it("returns arch var when set", () => {
    process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR] = "linux-arm64";
    assert.deepEqual(opencodeArchEnv(), { [DAYTONA_OPENCODE_ARCH_ENV_VAR]: "linux-arm64" });
  });

  it("returns empty record when unset", () => {
    delete process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR];
    assert.deepEqual(opencodeArchEnv(), {});
  });
});

describe("prepareDaytonaOpencodeAssets", () => {
  it("makes no sandbox calls for an opencode plan", async () => {
    const calls: string[] = [];
    const sandbox = {
      mkdirFs: async () => { calls.push("mkdirFs"); },
      writeFsFile: async () => { calls.push("writeFsFile"); },
      runProcess: async () => { calls.push("runProcess"); return { exitCode: 0 }; },
    };

    await prepareDaytonaOpencodeAssets({ sandbox, plan: { acpAgent: "opencode" } });

    assert.deepEqual(calls, [], "no sandbox fs calls for opencode");
  });

  it("skips when acpAgent is not opencode", async () => {
    const calls: string[] = [];
    const sandbox = {
      mkdirFs: async () => { calls.push("mkdirFs"); },
      writeFsFile: async () => { calls.push("writeFsFile"); },
    };

    await prepareDaytonaOpencodeAssets({ sandbox, plan: { acpAgent: "pi" } });

    assert.deepEqual(calls, [], "no calls for non-opencode agent");
  });

  it("logs the arch override when set", async () => {
    process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR] = "linux-arm64";
    const logs: string[] = [];
    const sandbox = {};

    await prepareDaytonaOpencodeAssets({
      sandbox,
      plan: { acpAgent: "opencode" },
      log: (msg) => logs.push(msg),
    });

    assert.ok(
      logs.some((l) => l.includes("linux-arm64")),
      "should log the arch override",
    );
  });

  it("does not log when arch override is unset", async () => {
    delete process.env[DAYTONA_OPENCODE_ARCH_ENV_VAR];
    const logs: string[] = [];
    const sandbox = {};

    await prepareDaytonaOpencodeAssets({
      sandbox,
      plan: { acpAgent: "opencode" },
      log: (msg) => logs.push(msg),
    });

    assert.equal(logs.length, 0, "no log when arch override absent");
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
