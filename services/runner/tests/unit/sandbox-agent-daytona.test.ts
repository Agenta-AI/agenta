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
  createDaytonaFetch,
  daytonaEnvVars,
  ensurePiInSandbox,
  removePiModelsConfigFromSandbox,
  uploadPiModelsConfigToSandbox,
} from "../../src/engines/sandbox_agent/daytona.ts";
import {
  PREVIEW_TOKEN_HEADER,
  daytonaWithLifecycle,
  type PreviewToken,
} from "../../src/engines/sandbox_agent/daytona-provider.ts";
import type { PiModelConfigPlan } from "../../src/engines/sandbox_agent/pi-model-config.ts";
import {
  PI_CLI_ANCHOR,
  PI_CLI_PROVIDER_COST_BUNDLE_PATH,
  PROVIDER_COST_MARKER,
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
  const piCliBundle = `${DAYTONA_PI_INSTALL_DIR}/node_modules/@earendil-works/pi-coding-agent/${PI_CLI_PROVIDER_COST_BUNDLE_PATH}`;
  const globalScope = "/usr/local/lib/node_modules/@earendil-works";
  const globalPiCliBundle = `${globalScope}/pi-coding-agent/${PI_CLI_PROVIDER_COST_BUNDLE_PATH}`;
  const stockBundle = `${PI_CLI_ANCHOR.functionStart}let usage={};${PI_CLI_ANCHOR.anchor}function mapStopReason(reason){`;

  function fakeSandbox(options: {
    before?: string;
    linked?: string;
    installLeaves?: string;
  }) {
    const calls: any[] = [];
    // What npm leaves behind, here and in a global install: the pi CLI's stock bundled chunk.
    const files = new Map<string, string>([
      [piCliBundle, stockBundle],
      [globalPiCliBundle, stockBundle],
    ]);
    let current = options.before;
    let harnessDir = `${DAYTONA_PI_INSTALL_DIR}/node_modules/@earendil-works/pi-coding-agent`;
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
        if (input.command === "sh" && input.args[1].includes("readlink")) {
          return { exitCode: 0, stdout: `${harnessDir}\n` };
        }
        if (input.command === "sh") {
          if (!options.linked) return { exitCode: 1 }; // no pi on PATH
          current = options.linked;
          harnessDir = `${globalScope}/pi-coding-agent`;
          return { exitCode: 0 };
        }
        if (input.command === "npm") {
          current = options.installLeaves;
          harnessDir = `${DAYTONA_PI_INSTALL_DIR}/node_modules/@earendil-works/pi-coding-agent`;
        }
        return { exitCode: 0 };
      },
    };
    return { calls, sandbox };
  }

  it("skips the install when the pinned Pi version is already present (baked snapshot)", async () => {
    const { calls, sandbox } = fakeSandbox({ before: PINNED_PI_VERSION });

    await ensurePiInSandbox(sandbox);

    assert.deepEqual(calls[0].args, ["--version"]);
    assert.equal(calls[0].command, DAYTONA_PI_COMMAND);
    assert.equal(
      calls.some((c) => c.command === "npm" || c.command === "rm"),
      false,
    );
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

  it("patches the installed pi CLI's bundled pi-ai to keep the provider's billed cost", async () => {
    const { sandbox } = fakeSandbox({ installLeaves: PINNED_PI_VERSION });

    await ensurePiInSandbox(sandbox);

    assert.ok(sandbox.files.get(piCliBundle)!.includes(PROVIDER_COST_MARKER));
  });

  it("patches a reused Pi of the pinned version (custom image, earlier install)", async () => {
    const { sandbox } = fakeSandbox({ before: PINNED_PI_VERSION });

    await ensurePiInSandbox(sandbox);

    assert.ok(sandbox.files.get(piCliBundle)!.includes(PROVIDER_COST_MARKER));
  });

  it("patches the global Pi the pinned path links to", async () => {
    const { sandbox } = fakeSandbox({ linked: PINNED_PI_VERSION });

    await ensurePiInSandbox(sandbox);

    assert.ok(
      sandbox.files.get(globalPiCliBundle)!.includes(PROVIDER_COST_MARKER),
    );
    assert.equal(sandbox.files.get(piCliBundle), stockBundle);
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

describe("createDaytonaFetch", () => {
  /** A token source with one host whose refresh hands out `fresh`. */
  function tokenFor(host: string, value: string, fresh = "fresh") {
    const refreshes: string[] = [];
    const token: PreviewToken & { current: string } = {
      current: value,
      get value() {
        return this.current;
      },
      async refresh(stale: string) {
        refreshes.push(stale);
        this.current = fresh;
        return fresh;
      },
    };
    return { refreshes, source: (h: string) => (h === host ? token : undefined) };
  }

  /** An inner fetch that records the token header of each request and answers from `statuses`. */
  function recordingFetch(statuses: number[]) {
    const seen: Array<string | null> = [];
    const inner = (async (_input: any, init?: any) => {
      seen.push(new Headers(init?.headers).get(PREVIEW_TOKEN_HEADER));
      return new Response("body", { status: statuses.shift() ?? 200 });
    }) as typeof fetch;
    return { seen, inner };
  }

  it("sends the preview token of the request's host, and none to another host", async () => {
    const { source } = tokenFor("3000-sb.proxy.test", "token-1");
    const { seen, inner } = recordingFetch([]);
    const daemonFetch = createDaytonaFetch(inner, {}, source);

    await daemonFetch("https://3000-sb.proxy.test/v1/health");
    await daemonFetch("https://other.proxy.test/v1/health");

    assert.deepEqual(seen, ["token-1", null]);
  });

  it("follows no redirect on a request that carries a token", async () => {
    const { source } = tokenFor("3000-sb.proxy.test", "token-1");
    const redirects: Array<string | undefined> = [];
    const inner = (async (_input: any, init?: any) => {
      redirects.push(init?.redirect);
      return new Response("body");
    }) as typeof fetch;
    const daemonFetch = createDaytonaFetch(inner, {}, source);

    await daemonFetch("https://3000-sb.proxy.test/v1/health");
    await daemonFetch("https://other.proxy.test/v1/health");

    assert.deepEqual(redirects, ["error", undefined]);
  });

  it("on a 401 gets a new token once and sends the request again", async () => {
    const { source, refreshes } = tokenFor("3000-sb.proxy.test", "old");
    const { seen, inner } = recordingFetch([401, 200]);
    const daemonFetch = createDaytonaFetch(inner, {}, source);

    const response = await daemonFetch("https://3000-sb.proxy.test/v1/fs/file", {
      method: "PUT",
      body: "content",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(seen, ["old", "fresh"]);
    assert.deepEqual(refreshes, ["old"]);
  });

  it("returns a second 401 instead of retrying again", async () => {
    const { source, refreshes } = tokenFor("3000-sb.proxy.test", "old");
    const { seen, inner } = recordingFetch([401, 401]);
    const daemonFetch = createDaytonaFetch(inner, {}, source);

    const response = await daemonFetch("https://3000-sb.proxy.test/v1/health");

    assert.equal(response.status, 401);
    assert.equal(seen.length, 2);
    assert.equal(refreshes.length, 1);
  });

  it("does not resend a body it cannot send twice", async () => {
    const { source, refreshes } = tokenFor("3000-sb.proxy.test", "old");
    const { seen, inner } = recordingFetch([401]);
    const daemonFetch = createDaytonaFetch(inner, {}, source);

    const response = await daemonFetch("https://3000-sb.proxy.test/v1/fs/file", {
      method: "PUT",
      body: new Uint8Array([1, 2, 3]),
    });

    assert.equal(response.status, 401);
    assert.equal(seen.length, 1);
    assert.equal(refreshes.length, 0);
  });

  it("fetches one new preview link for many requests refused at the same time", async () => {
    let links = 0;
    const sandbox = {
      async getPreviewLink() {
        links += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { url: "https://3000-sb.proxy.test", token: `token-${links}` };
      },
    };
    const provider = daytonaWithLifecycle({}, { client: { get: async () => sandbox } as any });
    await provider.getUrl("sb");
    // The daemon accepts only the newest token, as Daytona does after a start.
    const seen: Array<string | null> = [];
    const inner = (async (_input: any, init?: any) => {
      const sent = new Headers(init?.headers).get(PREVIEW_TOKEN_HEADER);
      seen.push(sent);
      return new Response("body", { status: sent === "token-2" ? 200 : 401 });
    }) as typeof fetch;
    const daemonFetch = createDaytonaFetch(inner, {}, (host) => provider.previewToken(host));

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => daemonFetch(`https://3000-sb.proxy.test/v1/fs/file?n=${i}`)),
    );

    assert.deepEqual(responses.map((r) => r.status), Array(8).fill(200));
    assert.equal(links, 2, "one link at getUrl, one shared refresh");
    assert.equal(seen.filter((t) => t === "token-2").length, 8);
  });
});
