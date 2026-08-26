/**
 * Unit tests for sandbox-agent Pi asset preparation.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-pi-assets.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { PI_MODEL_PROVIDER_OVERRIDE_ENV } from "../../src/extensions/model-provider-override.ts";
import { PI_GATEWAY_MCP_SERVERS_ENV } from "../../src/extensions/pi-mcp.ts";
import {
  buildPiExtensionEnv,
  configurePiSkillSnapshot,
  configurePiSessionWorkspace,
  materializeDaytonaPiSkillSnapshot,
  materializeLocalPiSkillSnapshot,
  PI_SKILL_SNAPSHOT_MARKER,
  PI_TOOL_SPECS_UNAVAILABLE_MESSAGE,
  piSessionWorkspaceDir,
  piToolSpecsFilePath,
  prepareLocalAgentDir,
  prepareLocalPiAssets,
  resolvePiSkillSnapshot,
  resolvePiToolSpecsDelivery,
  uploadDirToSandbox,
  uploadPiToolSpecsToSandbox,
  writeOtlpAuthFile,
  writePiModelsConfigLocal,
  writePiToolSpecsFileLocal,
  writeSystemPromptLocal,
} from "../../src/engines/sandbox_agent/pi-assets.ts";
import { PUBLIC_SPECS_FILE_ENV } from "../../src/tools/tool-mcp-env.ts";
import type { PiModelConfigPlan } from "../../src/engines/sandbox_agent/pi-model-config.ts";

const MODEL_CONFIG_PLAN: PiModelConfigPlan = {
  providerId: "my-ollama",
  providerFamily: "openai",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  apiKey: "$OPENAI_API_KEY",
  apiKeyEnv: "OPENAI_API_KEY",
  models: [{ id: "qwen2.5-coder:7b" }],
};

describe("Pi session workspace", () => {
  it("uses one stable transcript directory inside the conversation cwd", () => {
    assert.equal(
      piSessionWorkspaceDir("/work/session-1"),
      "/work/session-1/agents/sessions/pi",
    );

    const env: Record<string, string> = {};
    const sessionDir = configurePiSessionWorkspace(
      { isPi: true, workspace: { cwd: "/work/session-1" } },
      env,
    );

    assert.equal(sessionDir, "/work/session-1/agents/sessions/pi");
    assert.equal(
      env.PI_CODING_AGENT_SESSION_DIR,
      "/work/session-1/agents/sessions/pi",
    );
  });

  it("does not add Pi configuration to another harness", () => {
    const env: Record<string, string> = {};

    assert.equal(
      configurePiSessionWorkspace(
        { isPi: false, workspace: { cwd: "/work/session-1" } },
        env,
      ),
      undefined,
    );
    assert.equal(env.PI_CODING_AGENT_SESSION_DIR, undefined);
  });
});

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("buildPiExtensionEnv", () => {
  it("renders only the gateway route and short-lived gateway credential for Pi MCP", () => {
    const env = buildPiExtensionEnv(
      {
        mcpServers: [
          {
            name: "mock",
            connection: {
              type: "http",
              url: "https://api.example.test/gateways/mcps/custom/mock",
              headers: { "X-Agenta-Mock-Profile": "mcp-custom-mock" },
              credentials: [
                {
                  binding: { kind: "header", name: "X-AG-Credentials" },
                  value: "short-lived-gateway-token",
                  usage: "opaque_http",
                },
              ],
            },
            policy: { tools: { mode: "all" } },
          },
        ],
      } as AgentRunRequest,
      false,
    );
    const rendered = env[PI_GATEWAY_MCP_SERVERS_ENV] ?? "";
    assert.deepEqual(JSON.parse(rendered), {
      version: 1,
      servers: [
        {
          name: "mock",
          url: "https://api.example.test/gateways/mcps/custom/mock",
          headers: {
            "X-Agenta-Mock-Profile": "mcp-custom-mock",
            "X-AG-Credentials": "short-lived-gateway-token",
          },
          policy: { tools: { mode: "all" } },
        },
      ],
    });
    assert.equal(rendered.includes("upstream-secret"), false);
    assert.equal(rendered.includes("mock-mcp-gateway"), false);
  });

  it("carries only public provider endpoint config for Pi", () => {
    const request = {
      modelConnection: {
        provider: "anthropic",
        deployment: "claude-sonnet-4-5",
        endpoint: {
          baseUrl: "https://proxy.example.test/anthropic",
          headers: { Authorization: "Bearer do-not-expose" },
        },
        credentialMode: "env",
        environment: { PUBLIC_HINT: "not-needed-by-extension" },
        credentials: [
          {
            binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
            value: "secret-model-key",
            usage: "local_use",
          },
        ],
      },
    } as AgentRunRequest;

    const env = buildPiExtensionEnv(request, false);

    assert.deepEqual(JSON.parse(env[PI_MODEL_PROVIDER_OVERRIDE_ENV]), {
      provider: "anthropic",
      baseUrl: "https://proxy.example.test/anthropic",
    });
    assert.equal(JSON.stringify(env).includes("do-not-expose"), false);
    assert.equal(JSON.stringify(env).includes("secret-model-key"), false);
    assert.equal(JSON.stringify(env).includes("PUBLIC_HINT"), false);
  });

  it("a direct-deployment gateway connection carries the base URL and X-AG-Credentials (WP13 reopen)", () => {
    // The majority case (a plain provider_key vault connection, deployment "direct") is NOT a
    // named custom-agenta connection, so isPiModelConfigApplicable is false and this extension
    // override is the only place the gateway route can reach Pi. Before this fix the override
    // carried baseUrl alone -- no header, so the gateway would refuse the call for missing
    // credentials with nothing telling the caller why.
    const request = {
      harness: "pi_core",
      modelConnection: {
        provider: "anthropic",
        deployment: "direct",
        endpoint: { baseUrl: "https://gateway.example.com/gateways/llms/standard/anthropic" },
        credentialMode: "none",
        credentials: [],
        gatewayCredentials: {
          header: "X-AG-Credentials",
          value: "ApiKey mock-gateway-credentials",
        },
      },
    } as AgentRunRequest;

    const env = buildPiExtensionEnv(request, false);

    assert.deepEqual(JSON.parse(env[PI_MODEL_PROVIDER_OVERRIDE_ENV]), {
      provider: "anthropic",
      baseUrl: "https://gateway.example.com/gateways/llms/standard/anthropic",
      headers: { "X-AG-Credentials": "ApiKey mock-gateway-credentials" },
      apiKey: "agenta-gateway",
    });
  });

  it("a non-gateway direct-deployment connection carries no headers or placeholder key (unchanged)", () => {
    const request = {
      harness: "pi_core",
      modelConnection: {
        provider: "anthropic",
        deployment: "claude-sonnet-4-5",
        endpoint: { baseUrl: "https://proxy.example.test/anthropic" },
        credentialMode: "env",
        credentials: [],
      },
    } as AgentRunRequest;

    const env = buildPiExtensionEnv(request, false);

    assert.deepEqual(JSON.parse(env[PI_MODEL_PROVIDER_OVERRIDE_ENV]), {
      provider: "anthropic",
      baseUrl: "https://proxy.example.test/anthropic",
    });
  });

  it("rejects malformed provider endpoint overrides", () => {
    const request = (provider: string, baseUrl: string) =>
      ({
        modelConnection: {
          provider,
          deployment: "model",
          endpoint: { baseUrl },
          credentialMode: "none",
          credentials: [],
        },
      }) as AgentRunRequest;

    assert.throws(
      () =>
        buildPiExtensionEnv(
          request("bad/provider", "https://proxy.example.test"),
          false,
        ),
      /invalid provider/,
    );
    assert.throws(
      () =>
        buildPiExtensionEnv(
          request("anthropic", "http://proxy.example.test"),
          false,
        ),
      /must be an HTTPS URL/,
    );
    assert.throws(
      () =>
        buildPiExtensionEnv(
          request("anthropic", "https://user:pass@proxy.example.test"),
          false,
        ),
      /without credentials/,
    );
  });

  it("exposes tracing, usage, and public tool metadata only", () => {
    const request = {
      context: {
        propagation: {
          traceparent:
            "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        },
      },
      telemetry: {
        capture: { content: { enabled: false } },
        exporters: {
          otlp: {
            endpoint: "https://otlp.example.test/v1/traces",
            headers: { authorization: "Bearer trace-token" },
          },
        },
      },
      customTools: [
        {
          name: "safe_tool",
          description: "safe",
          inputSchema: {
            type: "object",
            properties: { x: { type: "string" } },
          },
          callRef: "server-secret-ref",
          contextBindings: {
            "target.workflow_variant_id": "$ctx.workflow.variant.id",
          },
          timeoutMs: 120000,
          env: { SECRET: "do-not-expose" },
          kind: "callback",
        },
        {
          name: "client_only",
          description: "browser fulfilled",
          inputSchema: {
            type: "object",
            properties: { integration: { type: "string" } },
          },
          kind: "client",
          render: { kind: "connect" },
        },
      ],
    } as AgentRunRequest;

    const relayDir = join(tempDir("agenta-pi-specs-"), "relay");
    const env = buildPiExtensionEnv(request, true, {
      relayDir,
      usageOutPath: "/tmp/usage.json",
      otlpAuthFilePath: "/tmp/otlp-auth",
    });
    writePiToolSpecsFileLocal(
      resolvePiToolSpecsDelivery(request.customTools ?? [], relayDir)!,
    );

    assert.equal(env.TRACEPARENT, request.context?.propagation?.traceparent);
    assert.equal(
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      request.telemetry?.exporters?.otlp?.endpoint,
    );
    // the bearer rides a file path, never a plain env var the harness can read/echo.
    assert.equal(env.AGENTA_AGENT_OTLP_AUTH_FILE, "/tmp/otlp-auth");
    assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, undefined);
    assert.equal(env.AGENTA_AGENT_CONTENT_CAPTURE_ENABLED, "false");
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, relayDir);
    assert.equal(env.AGENTA_AGENT_USAGE_CAPTURE_PATH, "/tmp/usage.json");

    // The environment carries only the tool-spec file path.
    assert.equal(env[PUBLIC_SPECS_FILE_ENV], `${relayDir}.tool-specs.json`);
    assert.equal(env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS, undefined);
    const specs = JSON.parse(
      readFileSync(env[PUBLIC_SPECS_FILE_ENV] ?? "", "utf-8"),
    );
    assert.deepEqual(specs, [
      {
        name: "safe_tool",
        description: "safe",
        inputSchema: { type: "object", properties: { x: { type: "string" } } },
        kind: "callback",
        timeoutMs: 120000,
      },
      {
        name: "client_only",
        description: "browser fulfilled",
        inputSchema: {
          type: "object",
          properties: { integration: { type: "string" } },
        },
        kind: "client",
        render: { kind: "connect" },
      },
    ]);
    assert.equal(JSON.stringify(specs).includes("server-secret-ref"), false);
    assert.equal(JSON.stringify(specs).includes("contextBindings"), false);
    assert.equal(JSON.stringify(specs).includes("do-not-expose"), false);
  });

  it("omits trace and tool env when tracing and relay are disabled", () => {
    const env = buildPiExtensionEnv(
      {
        context: {
          propagation: {
            traceparent:
              "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
          },
        },
        telemetry: { capture: { content: { enabled: true } } },
        customTools: [{ name: "safe_tool", kind: "callback" }],
      } as AgentRunRequest,
      false,
    );

    assert.equal(env.TRACEPARENT, undefined);
    assert.equal(env[PUBLIC_SPECS_FILE_ENV], undefined);
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, undefined);
    assert.equal(env[PI_MODEL_PROVIDER_OVERRIDE_ENV], undefined);
  });

  it("sets builtin gating env WITHOUT a relay dir (the gate rides the ACP dialog plane)", () => {
    const env = buildPiExtensionEnv({} as AgentRunRequest, false, {
      relayDir: "/tmp/relay",
      builtinGatingActive: true,
    });

    assert.equal(env.AGENTA_AGENT_BUILTIN_GATING, "1");
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, undefined);
    assert.equal(env[PUBLIC_SPECS_FILE_ENV], undefined);
  });

  it("always sets the builtin activation env and never a grant list", () => {
    const gating = buildPiExtensionEnv({} as AgentRunRequest, false, {
      builtinGatingActive: true,
    });
    const noGating = buildPiExtensionEnv({} as AgentRunRequest, false, {});

    assert.equal(gating.AGENTA_AGENT_BUILTIN_ACTIVATION, "1");
    assert.equal(noGating.AGENTA_AGENT_BUILTIN_ACTIVATION, "1");
    assert.equal(noGating.AGENTA_AGENT_BUILTIN_GATING, undefined);
    assert.equal(gating.AGENTA_AGENT_BUILTIN_GRANTS, undefined);
    assert.equal(noGating.AGENTA_AGENT_BUILTIN_GRANTS, undefined);
  });

  it("accepts snake_case tool schemas from older Python wire payloads", () => {
    const customTools = [
      {
        name: "request_connection",
        kind: "client",
        input_schema: {
          type: "object",
          required: ["integration"],
          properties: { integration: { type: "string" } },
        },
      },
    ];
    const env = buildPiExtensionEnv(
      { customTools } as unknown as AgentRunRequest,
      false,
      { relayDir: "/tmp/relay" },
    );

    assert.equal(env[PUBLIC_SPECS_FILE_ENV], "/tmp/relay.tool-specs.json");
    const specs = JSON.parse(
      resolvePiToolSpecsDelivery(customTools as never, "/tmp/relay")!.contents,
    );
    assert.deepEqual(specs[0].inputSchema, {
      type: "object",
      required: ["integration"],
      properties: { integration: { type: "string" } },
    });
  });

  it("carries the loaded skill names under tracing (F-029)", () => {
    const request = {
      context: {
        propagation: {
          traceparent:
            "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        },
      },
      telemetry: { capture: { content: { enabled: true } } },
    } as AgentRunRequest;

    const env = buildPiExtensionEnv(request, true, {
      skills: ["weather-oracle", "_agenta.agenta-getting-started"],
    });

    assert.deepEqual(JSON.parse(env.AGENTA_AGENT_SKILLS_LOADED ?? "[]"), [
      "weather-oracle",
      "_agenta.agenta-getting-started",
    ]);
  });

  it("omits the loaded skills env when there are none or tracing is off", () => {
    const request = {
      context: {
        propagation: {
          traceparent:
            "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        },
      },
      telemetry: { capture: { content: { enabled: true } } },
    } as AgentRunRequest;

    assert.equal(
      buildPiExtensionEnv(request, true, { skills: [] })
        .AGENTA_AGENT_SKILLS_LOADED,
      undefined,
    );
    assert.equal(
      buildPiExtensionEnv(request, false, { skills: ["x"] })
        .AGENTA_AGENT_SKILLS_LOADED,
      undefined,
    );
  });

  describe("hop-1 response-watch kill switch forwarding", () => {
    const FLAG = "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED";
    const previous = process.env[FLAG];
    const relayRequest = {
      customTools: [{ name: "safe_tool", kind: "callback" }],
    } as AgentRunRequest;

    afterEach(() => {
      if (previous === undefined) delete process.env[FLAG];
      else process.env[FLAG] = previous;
    });

    it("forwards the flag verbatim into the sandbox env when the operator set it", () => {
      process.env[FLAG] = "false";
      const env = buildPiExtensionEnv(relayRequest, false, {
        relayDir: "/tmp/relay",
      });
      assert.equal(env[FLAG], "false");
    });

    it("omits the flag when the operator did not set it (writer defaults to true)", () => {
      delete process.env[FLAG];
      const env = buildPiExtensionEnv(relayRequest, false, {
        relayDir: "/tmp/relay",
      });
      assert.equal(env[FLAG], undefined);
    });
  });

  it("never leaks the bearer into env when no auth file path is given", () => {
    const env = buildPiExtensionEnv(
      {
        telemetry: {
          exporters: {
            otlp: {
              endpoint: "https://otlp.example.test/v1/traces",
              headers: { authorization: "Bearer trace-token" },
            },
          },
        },
      } as AgentRunRequest,
      true,
    );

    assert.equal(env.AGENTA_AGENT_OTLP_AUTH_FILE, undefined);
    assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, undefined);
    assert.equal(JSON.stringify(env).includes("trace-token"), false);
  });
});

/**
 * Tool specs are stored in a file so the environment remains bounded.
 */
const MAX_ARG_STRLEN = 131_072;

/** 44 tools with fat JSON Schemas: the shape that reproduced the failure in production. */
function fatToolSpecs(count = 44) {
  return Array.from({ length: count }, (_, i) => ({
    name: `composio_tool_${i}`,
    description: `Tool ${i}. ${"description text ".repeat(60)}`,
    kind: "callback" as const,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 40 }, (_, f) => [
          `field_${f}`,
          {
            type: "string",
            description: `Field ${f}. ${"schema prose ".repeat(20)}`,
          },
        ]),
      ),
    },
  }));
}

describe("Pi tool specs delivery", () => {
  it("keeps a 300 KB tool set out of the env and round-trips it through the file", () => {
    const relayDir = join(tempDir("agenta-pi-specs-e2big-"), "relay");
    const customTools = fatToolSpecs();
    const request = { customTools } as unknown as AgentRunRequest;

    const env = buildPiExtensionEnv(request, false, { relayDir });
    const delivery = resolvePiToolSpecsDelivery(customTools as never, relayDir);
    assert.ok(delivery);
    writePiToolSpecsFileLocal(delivery);

    assert.ok(
      Buffer.byteLength(delivery.contents, "utf-8") > 300_000,
      "the fixture must exceed the single-env-string limit several times over",
    );
    for (const [key, value] of Object.entries(env)) {
      assert.ok(
        Buffer.byteLength(value, "utf-8") < MAX_ARG_STRLEN,
        `env ${key} is ${Buffer.byteLength(value, "utf-8")} bytes; execve would fail with E2BIG`,
      );
    }
    assert.equal(env[PUBLIC_SPECS_FILE_ENV], piToolSpecsFilePath(relayDir));
    assert.equal(env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS, undefined);
    assert.deepEqual(
      JSON.parse(readFileSync(env[PUBLIC_SPECS_FILE_ENV] ?? "", "utf-8")),
      JSON.parse(delivery.contents),
    );
    assert.equal(JSON.parse(delivery.contents).length, 44);
  });

  it("puts the file beside the relay dir, which is cleared every turn", () => {
    assert.equal(
      piToolSpecsFilePath("/tmp/agenta/relay/session-1"),
      "/tmp/agenta/relay/session-1.tool-specs.json",
    );
    assert.equal(
      resolvePiToolSpecsDelivery([], "/tmp/relay"),
      undefined,
      "no tools, nothing to deliver",
    );
    assert.equal(
      resolvePiToolSpecsDelivery([{ name: "t" }] as never, undefined),
      undefined,
      "no relay dir means no way to execute a tool, so none is advertised",
    );
  });

  it("fails loud when the file cannot be written, rather than dropping the tools", () => {
    const dir = tempDir("agenta-pi-specs-unwritable-");
    // A FILE where the parent directory must be: mkdir fails with ENOTDIR.
    const blocked = join(dir, "blocker");
    writeFileSync(blocked, "not a directory", "utf-8");
    const delivery = resolvePiToolSpecsDelivery(
      [{ name: "t" }] as never,
      join(blocked, "relay"),
    );
    assert.ok(delivery);

    assert.throws(
      () => writePiToolSpecsFileLocal(delivery),
      (err: Error) => err.message === PI_TOOL_SPECS_UNAVAILABLE_MESSAGE,
    );
  });

  it("uploads the same bytes to the deterministic in-sandbox path on Daytona", async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const madeDirs: string[] = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => {
        madeDirs.push(path);
      },
      writeFsFile: async ({ path }: { path: string }, contents: string) => {
        writes.push({ path, contents });
      },
    };
    const customTools = fatToolSpecs(2);
    const delivery = resolvePiToolSpecsDelivery(
      customTools as never,
      "/home/sandbox/agenta/relay/session-1",
    );
    assert.ok(delivery);

    await uploadPiToolSpecsToSandbox(sandbox, delivery);

    assert.deepEqual(madeDirs, ["/home/sandbox/agenta/relay"]);
    assert.deepEqual(writes, [
      {
        path: "/home/sandbox/agenta/relay/session-1.tool-specs.json",
        contents: delivery.contents,
      },
    ]);
    // The env the sandbox was created with names exactly this path.
    assert.equal(
      buildPiExtensionEnv(
        { customTools } as unknown as AgentRunRequest,
        false,
        {
          relayDir: "/home/sandbox/agenta/relay/session-1",
        },
      )[PUBLIC_SPECS_FILE_ENV],
      writes[0].path,
    );
  });

  it("fails loud when the sandbox upload fails", async () => {
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async () => {
        throw new Error("sandbox is gone");
      },
    };
    const delivery = resolvePiToolSpecsDelivery(
      [{ name: "t" }] as never,
      "/home/sandbox/agenta/relay/session-1",
    );
    assert.ok(delivery);

    await assert.rejects(
      uploadPiToolSpecsToSandbox(sandbox, delivery),
      (err: Error) => err.message === PI_TOOL_SPECS_UNAVAILABLE_MESSAGE,
    );
  });
});

describe("writeOtlpAuthFile", () => {
  it("writes the bearer to a 0600 file, not env", () => {
    const dir = tempDir("agenta-pi-otlp-auth-test-");
    const path = join(dir, "nested", "otlp-auth");

    writeOtlpAuthFile(path, "Bearer trace-token");

    assert.equal(readFileSync(path, "utf-8"), "Bearer trace-token");
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});

describe("writeSystemPromptLocal", () => {
  it("writes replacement and append prompt files", () => {
    const dir = tempDir("agenta-pi-prompt-test-");

    writeSystemPromptLocal(dir, "system text", "append text");

    assert.equal(readFileSync(join(dir, "SYSTEM.md"), "utf-8"), "system text");
    assert.equal(
      readFileSync(join(dir, "APPEND_SYSTEM.md"), "utf-8"),
      "append text",
    );
  });
});

describe("prepareLocalAgentDir", () => {
  it("seeds auth/settings without copying skills into the agent dir", () => {
    const source = tempDir("agenta-pi-source-test-");
    writeFileSync(join(source, "auth.json"), '{"token":"x"}', "utf-8");
    writeFileSync(join(source, "settings.json"), '{"model":"gpt"}', "utf-8");

    const { dir: runDir, extensionInstalled } = prepareLocalAgentDir(source);
    dirs.push(runDir);

    assert.notEqual(runDir, source);
    assert.equal(extensionInstalled, true);
    assert.equal(
      readFileSync(join(runDir, "auth.json"), "utf-8"),
      '{"token":"x"}',
    );
    assert.equal(
      readFileSync(join(runDir, "settings.json"), "utf-8"),
      '{"model":"gpt"}',
    );
    assert.equal(existsSync(join(runDir, "skills")), false);
  });

  it("reports failure when the extension cannot be installed (bundle missing)", () => {
    const source = tempDir("agenta-pi-source-nobundle-");
    const previous = process.env.SANDBOX_AGENT_EXTENSION_BUNDLE;
    process.env.SANDBOX_AGENT_EXTENSION_BUNDLE = join(
      tmpdir(),
      "agenta-nonexistent-extension-bundle.js",
    );
    try {
      const { dir: runDir, extensionInstalled } = prepareLocalAgentDir(source);
      dirs.push(runDir);
      assert.equal(extensionInstalled, false);
      assert.equal(existsSync(join(runDir, "extensions", "agenta.js")), false);
    } finally {
      if (previous === undefined)
        delete process.env.SANDBOX_AGENT_EXTENSION_BUNDLE;
      else process.env.SANDBOX_AGENT_EXTENSION_BUNDLE = previous;
    }
  });

  it("with seedCredentials=false, skips the operator's auth.json but keeps settings.json", () => {
    const source = tempDir("agenta-pi-source-nocreds-");
    writeFileSync(join(source, "auth.json"), '{"token":"personal"}', "utf-8");
    writeFileSync(join(source, "settings.json"), '{"model":"gpt"}', "utf-8");

    const { dir: runDir } = prepareLocalAgentDir(source, undefined, {
      seedCredentials: false,
    });
    dirs.push(runDir);

    // The operator's personal login never leaks into a managed custom run's isolated dir...
    assert.equal(existsSync(join(runDir, "auth.json")), false);
    // ...but non-credential settings are still carried.
    assert.equal(
      readFileSync(join(runDir, "settings.json"), "utf-8"),
      '{"model":"gpt"}',
    );
  });
});

describe("writePiModelsConfigLocal", () => {
  it("writes an exact 0600 models.json via an atomic temp-file + rename", () => {
    const dir = tempDir("agenta-pi-models-config-");

    writePiModelsConfigLocal(dir, MODEL_CONFIG_PLAN);

    const path = join(dir, "models.json");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf-8")), {
      providers: {
        "my-ollama": {
          baseUrl: "https://example.test/v1",
          api: "openai-completions",
          apiKey: "$OPENAI_API_KEY",
          models: [{ id: "qwen2.5-coder:7b" }],
        },
      },
    });
    // No staging file lingers.
    assert.equal(
      readdirSync(dir).some((n) => n.startsWith(".models.json.")),
      false,
    );
  });

  it("throws when the target cannot be written (materialization is terminal)", () => {
    const dir = tempDir("agenta-pi-models-config-fail-");
    // A non-empty directory occupying models.json makes the rename fail.
    mkdirSync(join(dir, "models.json"));
    writeFileSync(join(dir, "models.json", "keep.txt"), "x", "utf-8");

    assert.throws(() => writePiModelsConfigLocal(dir, MODEL_CONFIG_PLAN));
  });
});

describe("prepareLocalPiAssets (managed/none routes through a throwaway dir)", () => {
  const plainPiPlan = {
    isPi: true,
    isDaytona: false,
    credentials: {},
    workspace: {
      skillDirs: [],
      sourcePiAgentDir: "/unused",
    },
    prompt: {
      hasSystemPrompt: false,
      systemPrompt: undefined,
      appendSystemPrompt: undefined,
    },
  };

  it("installs the extension into a per-run temp dir it owns, independent of PI_CODING_AGENT_DIR", () => {
    const env: Record<string, string> = {};

    const { dir: runDir, extensionInstalled } = prepareLocalPiAssets({
      plan: plainPiPlan,
      env,
    });

    assert.ok(runDir, "a plain local Pi run gets a throwaway per-run dir");
    assert.notEqual(runDir, "/unused");
    assert.equal(env.PI_CODING_AGENT_DIR, runDir);
    assert.equal(extensionInstalled, true);
    assert.equal(
      existsSync(join(runDir as string, "extensions", "agenta.js")),
      true,
    );
    dirs.push(runDir as string);
  });

  it("reports extensionInstalled=false when the extension could not be installed", () => {
    const previous = process.env.SANDBOX_AGENT_EXTENSION_BUNDLE;
    process.env.SANDBOX_AGENT_EXTENSION_BUNDLE = join(
      tmpdir(),
      "agenta-nonexistent-extension-bundle.js",
    );
    try {
      const { dir: runDir, extensionInstalled } = prepareLocalPiAssets({
        plan: plainPiPlan,
        env: {},
      });
      if (runDir) dirs.push(runDir);
      assert.equal(extensionInstalled, false);
    } finally {
      if (previous === undefined)
        delete process.env.SANDBOX_AGENT_EXTENSION_BUNDLE;
      else process.env.SANDBOX_AGENT_EXTENSION_BUNDLE = previous;
    }
  });

  it("reports modelConfigWritten=true for a plain run with no model-config plan", () => {
    const { dir: runDir, modelConfigWritten } = prepareLocalPiAssets({
      plan: plainPiPlan,
      env: {},
    });
    if (runDir) dirs.push(runDir);
    assert.equal(modelConfigWritten, true);
    assert.equal(existsSync(join(runDir as string, "models.json")), false);
  });

  it("still copies the operator's auth.json for a managed run WITHOUT a model-config plan (unchanged)", () => {
    const source = tempDir("agenta-pi-managed-noplan-source-");
    writeFileSync(join(source, "auth.json"), '{"token":"managed"}', "utf-8");

    const { dir: runDir } = prepareLocalPiAssets({
      plan: {
        ...plainPiPlan,
        workspace: { ...plainPiPlan.workspace, sourcePiAgentDir: source },
      },
      env: {},
    });
    assert.ok(runDir);
    dirs.push(runDir as string);
    assert.equal(
      readFileSync(join(runDir as string, "auth.json"), "utf-8"),
      '{"token":"managed"}',
    );
  });

  it("for a model-config plan: writes models.json, omits auth.json, and points PI_CODING_AGENT_DIR at the dir", () => {
    const source = tempDir("agenta-pi-managed-plan-source-");
    writeFileSync(join(source, "auth.json"), '{"token":"personal"}', "utf-8");
    writeFileSync(join(source, "settings.json"), '{"model":"x"}', "utf-8");
    const env: Record<string, string> = {};

    const { dir: runDir, modelConfigWritten } = prepareLocalPiAssets({
      plan: {
        ...plainPiPlan,
        workspace: { ...plainPiPlan.workspace, sourcePiAgentDir: source },
      },
      env,
      piModelConfig: MODEL_CONFIG_PLAN,
    });

    assert.ok(runDir);
    dirs.push(runDir as string);
    assert.equal(modelConfigWritten, true);
    assert.equal(env.PI_CODING_AGENT_DIR, runDir);
    // The managed custom run authenticates from $OPENAI_API_KEY, never the operator's login.
    assert.equal(existsSync(join(runDir as string, "auth.json")), false);
    // Non-credential settings are still carried.
    assert.equal(
      readFileSync(join(runDir as string, "settings.json"), "utf-8"),
      '{"model":"x"}',
    );
    // The exact models.json is present and references only the env var.
    const modelsText = readFileSync(
      join(runDir as string, "models.json"),
      "utf-8",
    );
    assert.equal(modelsText.includes("$OPENAI_API_KEY"), true);
    assert.deepEqual(JSON.parse(modelsText).providers["my-ollama"].models, [
      { id: "qwen2.5-coder:7b" },
    ]);
  });
});

describe("Pi skill snapshots", () => {
  it("publishes content-addressed local snapshots without replacing older versions", () => {
    const cwd = tempDir("agenta-pi-snapshot-cwd-");
    const skill = tempDir("agenta-pi-snapshot-skill-");
    mkdirSync(join(skill, "references"));
    writeFileSync(join(skill, "SKILL.md"), "first", "utf-8");
    writeFileSync(join(skill, "references", "guide.md"), "guide", "utf-8");

    const first = resolvePiSkillSnapshot({
      isPi: true,
      workspace: {
        cwd,
        skillDirs: [{ name: "release-notes", dir: skill }],
      },
    });
    assert.ok(first);
    assert.match(first.dir, new RegExp(`${cwd}/agents/skills/[a-f0-9]{64}$`));
    const env: Record<string, string> = {};
    configurePiSkillSnapshot(first, env);
    assert.equal(env.PI_CODING_AGENT_SKILL_DIR, first.dir);

    materializeLocalPiSkillSnapshot(first);
    assert.equal(
      readFileSync(
        join(first.dir, "release-notes", "references", "guide.md"),
        "utf-8",
      ),
      "guide",
    );
    assert.equal(
      readFileSync(join(first.dir, PI_SKILL_SNAPSHOT_MARKER), "utf-8"),
      first.marker,
    );
    materializeLocalPiSkillSnapshot(first);

    writeFileSync(join(skill, "SKILL.md"), "second", "utf-8");
    const second = resolvePiSkillSnapshot({
      isPi: true,
      workspace: {
        cwd,
        skillDirs: [{ name: "release-notes", dir: skill }],
      },
    });
    assert.ok(second);
    assert.notEqual(second.dir, first.dir);
    materializeLocalPiSkillSnapshot(second);
    assert.equal(existsSync(first.dir), true);
    assert.equal(
      readFileSync(join(second.dir, "release-notes", "SKILL.md"), "utf-8"),
      "second",
    );
  });

  it("fails closed when the digest path exists without its completion marker", () => {
    const cwd = tempDir("agenta-pi-snapshot-invalid-cwd-");
    const skill = tempDir("agenta-pi-snapshot-invalid-skill-");
    writeFileSync(join(skill, "SKILL.md"), "skill", "utf-8");
    const snapshot = resolvePiSkillSnapshot({
      isPi: true,
      workspace: {
        cwd,
        skillDirs: [{ name: "release-notes", dir: skill }],
      },
    });
    assert.ok(snapshot);
    mkdirSync(snapshot.dir, { recursive: true });
    writeFileSync(join(snapshot.dir, "partial.txt"), "keep", "utf-8");

    assert.throws(
      () => materializeLocalPiSkillSnapshot(snapshot),
      /expected completion marker/,
    );
    assert.equal(
      readFileSync(join(snapshot.dir, "partial.txt"), "utf-8"),
      "keep",
    );
  });

  it("does not configure snapshots for non-Pi or empty-skill runs", () => {
    assert.equal(
      resolvePiSkillSnapshot({
        isPi: false,
        workspace: { cwd: "/work", skillDirs: [] },
      }),
      undefined,
    );
    assert.equal(
      resolvePiSkillSnapshot({
        isPi: true,
        workspace: { cwd: "/work", skillDirs: [] },
      }),
      undefined,
    );
    const env: Record<string, string> = {};
    configurePiSkillSnapshot(undefined, env);
    assert.equal(env.PI_CODING_AGENT_SKILL_DIR, undefined);
  });
});

/**
 * A local subscription (`runtime_provided`) run authenticates from the operator's READ-WRITE
 * mounted login, and the harness runs directly out of that mount: Pi refreshes its OAuth token
 * mid-run and writes the new one back, so a per-run copy would discard the refresh and the next
 * run would fail once the provider rotated the refresh token.
 */
describe("prepareLocalPiAssets (runtime_provided runs out of the mount, read-write)", () => {
  const subscriptionPlan = (
    mount: string,
    over: {
      credentials?: Record<string, unknown>;
      workspace?: Record<string, unknown>;
      prompt?: Record<string, unknown>;
    } = {},
  ) => ({
    isPi: true,
    isDaytona: false,
    credentials: {
      credentialMode: "runtime_provided",
      ...over.credentials,
    },
    workspace: {
      skillDirs: [],
      sourcePiAgentDir: mount,
      ...over.workspace,
    },
    prompt: {
      hasSystemPrompt: false,
      systemPrompt: undefined,
      appendSystemPrompt: undefined,
      ...over.prompt,
    },
  });

  it("points PI_CODING_AGENT_DIR at the mount itself, not at a per-run copy", () => {
    const mount = tempDir("agenta-pi-subscription-mount-");
    writeFileSync(join(mount, "auth.json"), '{"token":"live"}', "utf-8");
    const env: Record<string, string> = {};

    prepareLocalPiAssets({ plan: subscriptionPlan(mount) as never, env });

    assert.equal(
      env.PI_CODING_AGENT_DIR,
      mount,
      "a subscription run must run out of the operator's mount so a refreshed token persists",
    );
  });

  /**
   * The caller `rmSync`s whatever this returns at teardown. Returning the mount would delete the
   * operator's actual login, so the contract is: a subscription run reports NO throwaway dir.
   */
  it("returns undefined so teardown can never delete the operator's login", () => {
    const mount = tempDir("agenta-pi-subscription-mount-");
    writeFileSync(join(mount, "auth.json"), '{"token":"live"}', "utf-8");

    const { dir: runDir } = prepareLocalPiAssets({
      plan: subscriptionPlan(mount, {
        workspace: { skillDirs: [] },
        prompt: { hasSystemPrompt: true, appendSystemPrompt: "extra" },
      }) as never,
      env: {},
    });

    assert.equal(runDir, undefined);
    // The login itself survives: nothing moved it, and the harness still has its token to refresh.
    assert.ok(existsSync(join(mount, "auth.json")));
  });

  it("still isolates a MANAGED run's skills in a throwaway copy (no credential at stake)", () => {
    const source = tempDir("agenta-pi-managed-source-");
    writeFileSync(join(source, "auth.json"), '{"token":"managed"}', "utf-8");
    const env: Record<string, string> = {};

    const { dir: runDir } = prepareLocalPiAssets({
      plan: subscriptionPlan(source, {
        credentials: { credentialMode: "env" },
        prompt: { hasSystemPrompt: true, appendSystemPrompt: "extra" },
      }) as never,
      env,
    });

    assert.ok(
      runDir,
      "a managed run with a system prompt still gets a per-run dir",
    );
    assert.notEqual(runDir, source);
    assert.equal(env.PI_CODING_AGENT_DIR, runDir);
    dirs.push(runDir as string);
  });

  it("reports agentDirWritable=true and prepares sessions/ on a writable mount", () => {
    const mount = tempDir("agenta-pi-subscription-mount-");
    writeFileSync(join(mount, "auth.json"), '{"token":"live"}', "utf-8");

    const { agentDirWritable } = prepareLocalPiAssets({
      plan: subscriptionPlan(mount) as never,
      env: {},
    });

    assert.equal(agentDirWritable, true);
    // The probe's side effect is exactly what Pi needs at startup; no probe file survives.
    assert.ok(existsSync(join(mount, "sessions")));
    assert.equal(readdirSync(join(mount, "sessions")).length, 0);
  });

  /**
   * Pi persists session rollouts and its OAuth refresh into the mounted agent dir; on an
   * unwritable mount it dies at startup with zero output, which the user sees as a silently
   * stuck session. The probe must report it so the engine can fail closed with a visible error.
   */
  it("reports agentDirWritable=false when only sessions/ is writable", () => {
    const mount = tempDir("agenta-pi-subscription-mount-");
    const authFile = join(mount, "auth.json");
    const sessionsDir = join(mount, "sessions");
    writeFileSync(authFile, '{"token":"live"}', "utf-8");
    mkdirSync(sessionsDir);
    // Pi can write a rollout under
    // sessions/, but it cannot write at the agent-dir root to refresh auth.json.
    chmodSync(sessionsDir, 0o755);
    chmodSync(authFile, 0o444);
    chmodSync(mount, 0o555);
    try {
      const { agentDirWritable } = prepareLocalPiAssets({
        plan: subscriptionPlan(mount) as never,
        env: {},
      });
      if (typeof process.getuid === "function" && process.getuid() === 0) {
        // root bypasses mode bits, so the probe cannot fail in a root test run
        assert.equal(agentDirWritable, true);
      } else {
        assert.equal(agentDirWritable, false);
      }
    } finally {
      chmodSync(mount, 0o755);
      chmodSync(authFile, 0o644);
    }
  });

  it("managed runs always report agentDirWritable=true (per-run dir is runtime-owned)", () => {
    const source = tempDir("agenta-pi-managed-source-");
    writeFileSync(join(source, "auth.json"), '{"token":"managed"}', "utf-8");

    const result = prepareLocalPiAssets({
      plan: subscriptionPlan(source, {
        credentials: { credentialMode: "env" },
      }) as never,
      env: {},
    });

    assert.equal(result.agentDirWritable, true);
    if (result.dir) dirs.push(result.dir);
  });
});

describe("sandbox uploads", () => {
  it("recursively uploads files into sandbox fs", async () => {
    const root = tempDir("agenta-pi-upload-test-");
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "top.txt"), "top", "utf-8");
    writeFileSync(join(root, "nested", "child.txt"), "child", "utf-8");
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> =
      [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) =>
        calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    await uploadDirToSandbox(sandbox, root, "/agent/skills/custom");

    assert.deepEqual(calls, [
      { op: "mkdir", path: "/agent/skills/custom" },
      { op: "mkdir", path: "/agent/skills/custom/nested" },
      {
        op: "write",
        path: "/agent/skills/custom/nested/child.txt",
        body: "child",
      },
      { op: "write", path: "/agent/skills/custom/top.txt", body: "top" },
    ]);
  });

  it("publishes and reuses a Daytona snapshot with a non-overwriting move", async () => {
    const skill = tempDir("agenta-pi-daytona-snapshot-skill-");
    writeFileSync(join(skill, "SKILL.md"), "skill", "utf-8");
    const snapshot = resolvePiSkillSnapshot({
      isPi: true,
      workspace: {
        cwd: "/workspace",
        skillDirs: [{ name: "release-notes", dir: skill }],
      },
    });
    assert.ok(snapshot);

    const files = new Map<string, string>();
    const moves: Array<{ from: string; to: string; overwrite: boolean }> = [];
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async ({ path }: { path: string }, body: string) => {
        files.set(path, body);
      },
      readFsFile: async ({ path }: { path: string }) => {
        const body = files.get(path);
        if (body === undefined) throw new Error("missing");
        return Buffer.from(body, "utf-8");
      },
      moveFs: async ({
        from,
        to,
        overwrite,
      }: {
        from: string;
        to: string;
        overwrite: boolean;
      }) => {
        moves.push({ from, to, overwrite });
        for (const [path, body] of [...files.entries()]) {
          if (path === from || path.startsWith(`${from}/`)) {
            files.set(`${to}${path.slice(from.length)}`, body);
            files.delete(path);
          }
        }
      },
    };

    await materializeDaytonaPiSkillSnapshot(sandbox, snapshot);
    assert.equal(moves.length, 1);
    assert.equal(moves[0]?.to, snapshot.dir);
    assert.equal(moves[0]?.overwrite, false);
    assert.equal(files.get(`${snapshot.dir}/release-notes/SKILL.md`), "skill");
    assert.equal(
      files.get(`${snapshot.dir}/${PI_SKILL_SNAPSHOT_MARKER}`),
      snapshot.marker,
    );

    await materializeDaytonaPiSkillSnapshot(sandbox, snapshot);
    assert.equal(moves.length, 1);
  });
});
