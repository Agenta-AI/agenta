/**
 * Unit tests for sandbox-agent Daytona helper behavior.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-daytona.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import {
  DAYTONA_PI_COMMAND,
  DAYTONA_PI_DIR,
  DAYTONA_PI_INSTALL_DIR,
  PINNED_PI_VERSION,
  createCookieFetch,
  daytonaEnvVars,
  ensurePiInSandbox,
  removePiModelsConfigFromSandbox,
  uploadPiModelsConfigToSandbox,
} from "../../src/engines/sandbox_agent/daytona.ts";
import type { PiModelConfigPlan } from "../../src/engines/sandbox_agent/pi-model-config.ts";

const MODEL_CONFIG_PLAN: PiModelConfigPlan = {
  providerId: "my-ollama",
  providerFamily: "openai",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  models: [{ id: "qwen2.5-coder:7b" }],
};

const envKeys = ["PI_CODING_AGENT_DIR"];
const previousEnv = new Map<string, string | undefined>();
for (const key of envKeys) previousEnv.set(key, process.env[key]);

const dirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
});

describe("daytonaEnvVars", () => {
  it("combines Pi agent dir, extension env, provider secrets, and the pinned Pi command", () => {
    const env = daytonaEnvVars(
      { TRACEPARENT: "trace", AGENTA_AGENT_TOOLS_RELAY_DIR: "/relay" },
      { OPENAI_API_KEY: "key" },
    );

    assert.equal(env.PI_CODING_AGENT_DIR, DAYTONA_PI_DIR);
    assert.equal(env.TRACEPARENT, "trace");
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, "/relay");
    assert.equal(env.OPENAI_API_KEY, "key");
    // The command always points at the runner-pinned Pi path; the probe/repair path guarantees
    // the binary is present there before the session runs.
    assert.equal(env.PI_ACP_PI_COMMAND, DAYTONA_PI_COMMAND);
  });
});

describe("ensurePiInSandbox (probe and pinned-install repair)", () => {
  it("skips the install when the pinned Pi executable is already present (baked snapshot)", async () => {
    const calls: any[] = [];
    const sandbox = {
      mkdirFs: async () => {},
      runProcess: async (input: any) => {
        calls.push(input);
        // `test -x <pinned path>` succeeds: Pi is already baked in.
        return { exitCode: 0 };
      },
    };

    await ensurePiInSandbox(sandbox);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "test");
    assert.deepEqual(calls[0].args, ["-x", DAYTONA_PI_COMMAND]);
  });

  it("links a PATH-baked pi to the pinned path instead of reinstalling (recipe snapshot)", async () => {
    const calls: any[] = [];
    let probed = 0;
    const sandbox = {
      mkdirFs: async () => {},
      runProcess: async (input: any) => {
        calls.push(input);
        if (input.command === "test") {
          probed += 1;
          // Pinned path missing before the link, present after it.
          return { exitCode: probed === 1 ? 1 : 0 };
        }
        // The `sh -lc command -v pi && ln -sf ...` link succeeds.
        return { exitCode: 0 };
      },
    };

    await ensurePiInSandbox(sandbox);

    assert.ok(
      calls.some((c) => c.command === "sh"),
      "expected the global-pi link attempt",
    );
    assert.equal(
      calls.some((c) => c.command === "npm"),
      false,
      "a baked snapshot must not pay a session-time npm install",
    );
  });

  it("installs the pinned Pi version when the probe and PATH both miss (custom image)", async () => {
    const calls: any[] = [];
    const sandbox = {
      mkdirFs: async () => {},
      runProcess: async (input: any) => {
        calls.push(input);
        if (input.command === "test") {
          // Missing until the install completes.
          return { exitCode: calls.some((c) => c.command === "npm") ? 0 : 1 };
        }
        if (input.command === "sh") return { exitCode: 1 }; // no pi on PATH
        return { exitCode: 0 };
      },
    };

    await ensurePiInSandbox(sandbox);

    const install = calls.find((c) => c.command === "npm");
    assert.ok(install, "expected a pinned npm install");
    assert.deepEqual(install.args, [
      "install",
      "--no-fund",
      "--no-audit",
      `@earendil-works/pi-coding-agent@${PINNED_PI_VERSION}`,
    ]);
    assert.equal(install.cwd, DAYTONA_PI_INSTALL_DIR);
  });

  it("fails the run when Pi is still missing after the install attempt", async () => {
    const sandbox = {
      mkdirFs: async () => {},
      runProcess: async (input: any) => {
        // Probe and PATH both always miss; install "succeeds" but leaves nothing behind.
        if (input.command === "test" || input.command === "sh") {
          return { exitCode: 1 };
        }
        return { exitCode: 0 };
      },
    };

    await assert.rejects(
      () => ensurePiInSandbox(sandbox),
      new RegExp(`pi ${PINNED_PI_VERSION} is not available`),
    );
  });
});

describe("uploadPiModelsConfigToSandbox", () => {
  it("writes the exact models.json into the Pi agent dir (key never inlined)", async () => {
    const writes: Array<{ path: string; body: string }> = [];
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async ({ path }: { path: string }, body: string) => {
        writes.push({ path, body });
      },
    };

    await uploadPiModelsConfigToSandbox(
      sandbox,
      DAYTONA_PI_DIR,
      MODEL_CONFIG_PLAN,
    );

    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `${DAYTONA_PI_DIR}/models.json`);
    assert.deepEqual(JSON.parse(writes[0].body), {
      providers: {
        "my-ollama": {
          baseUrl: "https://example.test/v1",
          api: "openai-completions",
          apiKey: "$OPENAI_API_KEY",
          models: [{ id: "qwen2.5-coder:7b" }],
        },
      },
    });
    assert.equal(writes[0].body.includes("$OPENAI_API_KEY"), true);
  });

  it("throws when the upload fails (materialization is terminal)", async () => {
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async () => {
        throw new Error("sandbox fs write failed");
      },
    };

    await assert.rejects(
      () =>
        uploadPiModelsConfigToSandbox(
          sandbox,
          DAYTONA_PI_DIR,
          MODEL_CONFIG_PLAN,
        ),
      /sandbox fs write failed/,
    );
  });
});

describe("removePiModelsConfigFromSandbox", () => {
  it("deletes a stale models.json so a reused sandbox keeps no earlier provider", async () => {
    const deletes: string[] = [];
    const sandbox = {
      deleteFsEntry: async ({ path }: { path: string }) => {
        deletes.push(path);
      },
    };

    await removePiModelsConfigFromSandbox(sandbox, DAYTONA_PI_DIR);

    assert.deepEqual(deletes, [`${DAYTONA_PI_DIR}/models.json`]);
  });

  it("swallows a missing-file / unsupported-delete error (best effort)", async () => {
    const sandbox = {
      deleteFsEntry: async () => {
        throw new Error("not found");
      },
    };
    // Must not throw.
    await removePiModelsConfigFromSandbox(sandbox, DAYTONA_PI_DIR);

    // A provider without a delete op is also tolerated.
    await removePiModelsConfigFromSandbox({}, DAYTONA_PI_DIR);
  });
});

describe("createCookieFetch", () => {
  it("persists Daytona preview cookies per host", async () => {
    const seenCookies: Array<string | null> = [];
    const innerFetch = (async (_input: any, init?: any) => {
      seenCookies.push(new Headers(init?.headers).get("cookie"));
      return new Response("ok", {
        headers: { "set-cookie": "session=abc; Path=/" },
      });
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
