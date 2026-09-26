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
import {
  PARSE_CHUNK_USAGE_START,
  PI_PROVIDER_COST_BUNDLE_PATH,
  PROVIDER_COST_MARKER,
  STOCK_USAGE_TAIL,
} from "../../src/tools/pi-provider-cost-patch.ts";

const MODEL_CONFIG_PLAN: PiModelConfigPlan = {
  providerId: "my-ollama",
  providerFamily: "openai",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  apiKey: "$OPENAI_API_KEY",
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
  const isProbe = (input: any) =>
    input.command === DAYTONA_PI_COMMAND && input.args?.[0] === "--version";
  const version = (v: string | undefined) =>
    v ? { exitCode: 0, stdout: `${v}\n` } : { exitCode: 127, stdout: "" };

  /**
   * A sandbox whose pinned path answers `before` until a link or install changes it: a link makes
   * it answer `linked` (the PATH pi's version), an install makes it answer the pinned version.
   */
  const piAiBundle = `${DAYTONA_PI_INSTALL_DIR}/node_modules/@earendil-works/pi-ai/${PI_PROVIDER_COST_BUNDLE_PATH}`;

  function fakeSandbox(options: {
    before?: string;
    linked?: string;
    installLeaves?: string;
  }) {
    const calls: any[] = [];
    // What npm leaves behind: the stock pi-ai bundle, hoisted beside the harness.
    const files = new Map<string, string>([
      [
        piAiBundle,
        `${PARSE_CHUNK_USAGE_START}\n    const usage = {};\n${STOCK_USAGE_TAIL}\n`,
      ],
    ]);
    let current = options.before;
    const sandbox = {
      files,
      mkdirFs: async () => {},
      readFsFile: async ({ path }: { path: string }) => {
        const body = files.get(path);
        if (body === undefined) throw new Error(`ENOENT: ${path}`);
        return new TextEncoder().encode(body);
      },
      writeFsFile: async ({ path }: { path: string }, body: string) => {
        files.set(path, body);
      },
      runProcess: async (input: any) => {
        calls.push(input);
        if (isProbe(input)) return version(current);
        if (input.command === "sh") {
          if (!options.linked) return { exitCode: 1 }; // no pi on PATH
          current = options.linked;
          return { exitCode: 0 };
        }
        if (input.command === "npm") current = options.installLeaves;
        return { exitCode: 0 };
      },
    };
    return { calls, sandbox };
  }

  it("skips the install when the pinned Pi version is already present (baked snapshot)", async () => {
    const { calls, sandbox } = fakeSandbox({ before: PINNED_PI_VERSION });

    await ensurePiInSandbox(sandbox);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["--version"]);
    assert.equal(calls[0].command, DAYTONA_PI_COMMAND);
  });

  it("links a PATH-baked pi to the pinned path instead of reinstalling (recipe snapshot)", async () => {
    const { calls, sandbox } = fakeSandbox({ linked: PINNED_PI_VERSION });

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
    const { calls, sandbox } = fakeSandbox({
      installLeaves: PINNED_PI_VERSION,
    });

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

  it("patches the installed pi-ai to keep the provider's billed cost", async () => {
    const { sandbox } = fakeSandbox({ installLeaves: PINNED_PI_VERSION });

    await ensurePiInSandbox(sandbox);

    assert.ok(sandbox.files.get(piAiBundle)!.includes(PROVIDER_COST_MARKER));
  });

  it.each([
    ["at the pinned path", { before: "0.85.1" }],
    ["on PATH", { linked: "0.85.1" }],
  ])(
    "replaces an older Pi %s with the pinned version",
    async (_where, options) => {
      const { calls, sandbox } = fakeSandbox({
        ...options,
        installLeaves: PINNED_PI_VERSION,
      });

      await ensurePiInSandbox(sandbox);

      const commands = calls.map((c) => c.command);
      assert.ok(commands.includes("npm"), "expected a pinned npm install");
      // The stale link goes first, so npm can write its own bin link.
      assert.ok(commands.indexOf("rm") < commands.indexOf("npm"));
    },
  );

  it("fails the run when Pi is still missing after the install attempt", async () => {
    const { sandbox } = fakeSandbox({});

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
