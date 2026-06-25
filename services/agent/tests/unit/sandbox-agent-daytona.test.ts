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
  DAYTONA_PI_DIR,
  DAYTONA_PI_INSTALL,
  DAYTONA_PI_INSTALL_DIR,
  applyDaytonaClientEnv,
  createCookieFetch,
  daytonaEnvVars,
  uploadPiAuthToSandbox,
} from "../../src/engines/sandbox_agent/daytona.ts";

const envKeys = [
  "SANDBOX_AGENT_DAYTONA_API_KEY",
  "SANDBOX_AGENT_DAYTONA_API_URL",
  "SANDBOX_AGENT_DAYTONA_TARGET",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "DAYTONA_TARGET",
  "PI_CODING_AGENT_DIR",
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
      { AGENTA_TRACEPARENT: "trace", AGENTA_TOOL_RELAY_DIR: "/relay" },
      { OPENAI_API_KEY: "key" },
    );

    assert.equal(env.PI_CODING_AGENT_DIR, DAYTONA_PI_DIR);
    assert.equal(env.AGENTA_TRACEPARENT, "trace");
    assert.equal(env.AGENTA_TOOL_RELAY_DIR, "/relay");
    assert.equal(env.OPENAI_API_KEY, "key");
    if (DAYTONA_PI_INSTALL) {
      assert.equal(env.PI_ACP_PI_COMMAND, `${DAYTONA_PI_INSTALL_DIR}/node_modules/.bin/pi`);
    }
  });
});

describe("applyDaytonaClientEnv", () => {
  it("normalizes sandbox-agent Daytona env names to Daytona SDK names", () => {
    process.env.SANDBOX_AGENT_DAYTONA_API_KEY = "api-key";
    process.env.SANDBOX_AGENT_DAYTONA_API_URL = "https://daytona.example.test";
    process.env.SANDBOX_AGENT_DAYTONA_TARGET = "us";

    applyDaytonaClientEnv();

    assert.equal(process.env.DAYTONA_API_KEY, "api-key");
    assert.equal(process.env.DAYTONA_API_URL, "https://daytona.example.test");
    assert.equal(process.env.DAYTONA_TARGET, "us");
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
