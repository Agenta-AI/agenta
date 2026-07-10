/**
 * Unit tests for sandbox-agent Daytona helper behavior.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-daytona.test.ts)
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DAYTONA_PI_DIR,
  DAYTONA_PI_INSTALL,
  DAYTONA_PI_INSTALL_DIR,
  DAYTONA_PI_VERSION,
  createCookieFetch,
  daytonaEnvVars,
  installPiInSandbox,
  uploadPiAuthToSandbox,
} from "../../src/engines/sandbox_agent/daytona.ts";

const envKeys = ["PI_CODING_AGENT_DIR", "AGENTA_AGENT_SANDBOX_PI_INSTALLED"];
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

describe("DAYTONA_PI_INSTALL default", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("defaults to installing Pi for a fresh bare sandbox", async () => {
    delete process.env.AGENTA_AGENT_SANDBOX_PI_INSTALLED;
    vi.resetModules();
    const mod = await import("../../src/engines/sandbox_agent/daytona.ts");
    assert.equal(mod.DAYTONA_PI_INSTALL, true);
  });

  it("installs Pi when explicitly enabled", async () => {
    process.env.AGENTA_AGENT_SANDBOX_PI_INSTALLED = "true";
    vi.resetModules();
    const mod = await import("../../src/engines/sandbox_agent/daytona.ts");
    assert.equal(mod.DAYTONA_PI_INSTALL, true);
  });

  it("skips the session install only when the snapshot already bakes Pi", async () => {
    process.env.AGENTA_AGENT_SANDBOX_PI_INSTALLED = "false";
    vi.resetModules();
    const mod = await import("../../src/engines/sandbox_agent/daytona.ts");
    assert.equal(mod.DAYTONA_PI_INSTALL, false);
  });
});

describe("installPiInSandbox", () => {
  it("installs the pinned Pi version", async () => {
    const calls: any[] = [];
    const sandbox = {
      mkdirFs: async () => {},
      runProcess: async (input: any) => {
        calls.push(input);
        return { exitCode: 0 };
      },
    };

    await installPiInSandbox(sandbox);

    assert.equal(DAYTONA_PI_VERSION, "0.80.6");
    assert.deepEqual(calls, [
      {
        command: "npm",
        args: [
          "install",
          "--no-fund",
          "--no-audit",
          "@earendil-works/pi-coding-agent@0.80.6",
        ],
        cwd: DAYTONA_PI_INSTALL_DIR,
        timeoutMs: 180_000,
      },
    ]);
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
