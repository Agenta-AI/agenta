/**
 * Unit tests for sandbox-agent Pi asset preparation.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-pi-assets.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  buildPiExtensionEnv,
  prepareLocalAgentDir,
  prepareLocalPiAssets,
  uploadDirToSandbox,
  uploadSkillsToSandbox,
  writeSystemPromptLocal,
} from "../../src/engines/sandbox_agent/pi-assets.ts";

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
  it("exposes tracing, usage, and public tool metadata only", () => {
    const request = {
      context: {
        propagation: {
          traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
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
          contextBindings: { "target.workflow_variant_id": "$ctx.workflow.variant.id" },
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

    const env = buildPiExtensionEnv(request, true, {
      relayDir: "/tmp/relay",
      usageOutPath: "/tmp/usage.json",
    });

    assert.equal(env.TRACEPARENT, request.context?.propagation?.traceparent);
    assert.equal(
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      request.telemetry?.exporters?.otlp?.endpoint,
    );
    assert.equal(
      env.OTEL_EXPORTER_OTLP_HEADERS,
      `Authorization=${request.telemetry?.exporters?.otlp?.headers?.authorization}`,
    );
    assert.equal(env.AGENTA_AGENT_CONTENT_CAPTURE_ENABLED, "false");
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, "/tmp/relay");
    assert.equal(env.AGENTA_AGENT_USAGE_CAPTURE_PATH, "/tmp/usage.json");

    const specs = JSON.parse(env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS ?? "[]");
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
    assert.equal(env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS, undefined);
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, undefined);
  });

  it("sets builtin gating env and relay dir without custom tools", () => {
    const env = buildPiExtensionEnv({} as AgentRunRequest, false, {
      relayDir: "/tmp/relay",
      builtinGatingActive: true,
      builtinGrants: ["read", "write"],
    });

    assert.equal(env.AGENTA_AGENT_BUILTIN_GATING, "1");
    assert.equal(env.AGENTA_AGENT_BUILTIN_GRANTS, "read,write");
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, "/tmp/relay");
    assert.equal(env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS, undefined);
  });

  it("accepts snake_case tool schemas from older Python wire payloads", () => {
    const env = buildPiExtensionEnv(
      {
        customTools: [
          {
            name: "request_connection",
            kind: "client",
            input_schema: {
              type: "object",
              required: ["integration"],
              properties: { integration: { type: "string" } },
            },
          },
        ],
      } as unknown as AgentRunRequest,
      false,
      { relayDir: "/tmp/relay" },
    );

    const specs = JSON.parse(env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS ?? "[]");
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
          traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
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
          traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        },
      },
      telemetry: { capture: { content: { enabled: true } } },
    } as AgentRunRequest;

    assert.equal(
      buildPiExtensionEnv(request, true, { skills: [] }).AGENTA_AGENT_SKILLS_LOADED,
      undefined,
    );
    assert.equal(
      buildPiExtensionEnv(request, false, { skills: ["x"] })
        .AGENTA_AGENT_SKILLS_LOADED,
      undefined,
    );
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
  it("seeds auth/settings and installs materialized skills into a throwaway dir", () => {
    const source = tempDir("agenta-pi-source-test-");
    writeFileSync(join(source, "auth.json"), '{"token":"x"}', "utf-8");
    writeFileSync(join(source, "settings.json"), '{"model":"gpt"}', "utf-8");

    const skill = tempDir("agenta-pi-skill-test-");
    writeFileSync(join(skill, "SKILL.md"), "---\nname: skill\n---\n", "utf-8");

    const runDir = prepareLocalAgentDir(source, [
      { name: "skill", dir: skill },
    ]);
    dirs.push(runDir);

    assert.notEqual(runDir, source);
    assert.equal(
      readFileSync(join(runDir, "auth.json"), "utf-8"),
      '{"token":"x"}',
    );
    assert.equal(
      readFileSync(join(runDir, "settings.json"), "utf-8"),
      '{"model":"gpt"}',
    );
    // The dest dir is named by the skill's `name`, not the (throwaway) source dir basename.
    assert.equal(
      readFileSync(join(runDir, "skills", "skill", "SKILL.md"), "utf-8"),
      "---\nname: skill\n---\n",
    );
  });
});

describe("prepareLocalPiAssets (PI_CODING_AGENT_DIR guard)", () => {
  const ENV_VAR = "PI_CODING_AGENT_DIR";
  const previous = process.env[ENV_VAR];

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = previous;
  });

  const plainPiPlan = {
    isPi: true,
    isDaytona: false,
    skillDirs: [],
    hasSystemPrompt: false,
    systemPrompt: undefined,
    appendSystemPrompt: undefined,
    sourcePiAgentDir: "/unused",
  };

  it("logs a clear warning when a plain local Pi run has no PI_CODING_AGENT_DIR", () => {
    delete process.env[ENV_VAR];
    const logs: string[] = [];

    const runDir = prepareLocalPiAssets({
      plan: plainPiPlan,
      env: {},
      log: (msg) => logs.push(msg),
    });

    assert.equal(runDir, undefined);
    assert.ok(
      logs.some((m) => m.includes("PI_CODING_AGENT_DIR is unset")),
      `expected a PI_CODING_AGENT_DIR warning, got: ${JSON.stringify(logs)}`,
    );
  });

  it("installs the extension silently (no warning) when PI_CODING_AGENT_DIR is set", () => {
    const dir = tempDir("agenta-pi-configured-dir-");
    process.env[ENV_VAR] = dir;
    const logs: string[] = [];

    prepareLocalPiAssets({
      plan: plainPiPlan,
      env: {},
      log: (msg) => logs.push(msg),
    });

    assert.ok(!logs.some((m) => m.includes("PI_CODING_AGENT_DIR is unset")));
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

  it("uploads each materialized skill under the Pi skills directory", async () => {
    const skill = tempDir("agenta-pi-skill-upload-test-");
    writeFileSync(join(skill, "SKILL.md"), "skill", "utf-8");
    const written: string[] = [];
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async ({ path }: { path: string }) => written.push(path),
    };

    await uploadSkillsToSandbox(sandbox, "/agent", [
      { name: "release-notes", dir: skill },
    ]);

    assert.equal(existsSync(skill), true);
    // The sandbox dest dir is named by the skill's `name`.
    assert.deepEqual(written, ["/agent/skills/release-notes/SKILL.md"]);
  });
});
