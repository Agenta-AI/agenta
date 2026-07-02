/**
 * Unit tests for sandbox-agent Pi asset preparation.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-pi-assets.test.ts)
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  buildPiExtensionEnv,
  prepareLocalAgentDir,
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

describe("writeCodexAuthFile / prepareLocalCodexAssets (dir override)", () => {
  const originalCodexDir = process.env.AGENTA_AGENT_CODEX_DIR;
  let codexDir: string;
  let mod: typeof import("../../src/engines/sandbox_agent/pi-assets.ts");

  beforeEach(async () => {
    codexDir = tempDir("agenta-codex-dir-test-");
    // CODEX_DIR is read from the env at module-eval time; reset the module registry so a
    // fresh import picks up this test's override instead of a prior test's binding.
    process.env.AGENTA_AGENT_CODEX_DIR = codexDir;
    vi.resetModules();
    mod = await import("../../src/engines/sandbox_agent/pi-assets.ts");
  });

  afterEach(() => {
    if (originalCodexDir === undefined) delete process.env.AGENTA_AGENT_CODEX_DIR;
    else process.env.AGENTA_AGENT_CODEX_DIR = originalCodexDir;
  });

  it("respects AGENTA_AGENT_CODEX_DIR override", () => {
    assert.equal(mod.CODEX_DIR, codexDir);
  });

  it("writes auth.json with mode 600 and OPENAI_API_KEY field", () => {
    const created = mod.writeCodexAuthFile("sk-test-key");
    assert.equal(created, true);

    const authPath = join(codexDir, "auth.json");
    const parsed = JSON.parse(readFileSync(authPath, "utf-8"));
    assert.equal(parsed.OPENAI_API_KEY, "sk-test-key");
    assert.equal(Object.keys(parsed).length, 1);

    const mode = statSync(authPath).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("creates the dir with mode 700", () => {
    mod.writeCodexAuthFile("sk-test-key");
    const mode = statSync(codexDir).mode & 0o777;
    assert.equal(mode, 0o700);
  });

  it("reports created=false and warns when auth.json already existed", () => {
    const authPath = join(codexDir, "auth.json");
    writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: "sk-preexisting" }), "utf-8");

    const logs: string[] = [];
    const created = mod.writeCodexAuthFile("sk-new-key", (m) => logs.push(m));

    assert.equal(created, false);
    assert.ok(logs.some((l) => l.includes("overwriting existing")));
    // Managed mode still overwrites (legacy behavior), just louder.
    assert.equal(
      JSON.parse(readFileSync(authPath, "utf-8")).OPENAI_API_KEY,
      "sk-new-key",
    );
  });

  it("prepareLocalCodexAssets managed: writes auth.json from OPENAI_API_KEY and reports created", () => {
    const logs: string[] = [];
    const created = mod.prepareLocalCodexAssets(
      { credentialMode: "env", hasApiKey: true, secrets: { OPENAI_API_KEY: "sk-managed" } },
      (m) => logs.push(m),
    );
    assert.equal(created, true);
    assert.equal(logs.filter((l) => l.includes("not found")).length, 0);
    assert.equal(
      JSON.parse(readFileSync(join(codexDir, "auth.json"), "utf-8")).OPENAI_API_KEY,
      "sk-managed",
    );
  });

  it("prepareLocalCodexAssets managed: falls back to CODEX_API_KEY when OPENAI_API_KEY absent", () => {
    const created = mod.prepareLocalCodexAssets({
      credentialMode: "env",
      hasApiKey: true,
      secrets: { CODEX_API_KEY: "sk-codex-only" },
    });
    assert.equal(created, true);
    assert.equal(
      JSON.parse(readFileSync(join(codexDir, "auth.json"), "utf-8")).OPENAI_API_KEY,
      "sk-codex-only",
    );
  });

  it("prepareLocalCodexAssets managed: no write and created=false when no key is present", () => {
    const logs: string[] = [];
    const created = mod.prepareLocalCodexAssets(
      { credentialMode: "env", hasApiKey: false, secrets: {} },
      (m) => logs.push(m),
    );
    assert.equal(created, false);
    assert.equal(existsSync(join(codexDir, "auth.json")), false);
    assert.equal(logs.filter((l) => l.includes("not found")).length, 0);
  });

  it("prepareLocalCodexAssets self-managed: logs warning and returns false when auth.json is absent", () => {
    const logs: string[] = [];
    const created = mod.prepareLocalCodexAssets(
      { credentialMode: "runtime_provided", hasApiKey: false, secrets: {} },
      (m) => logs.push(m),
    );
    assert.equal(created, false);
    const warnings = logs.filter((l) => l.includes("auth.json") && l.includes("not found"));
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("self-managed"));
    assert.ok(warnings[0].includes(codexDir));
  });

  it("prepareLocalCodexAssets self-managed: no warning when auth.json is already present", () => {
    writeFileSync(join(codexDir, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-own" }), "utf-8");
    const logs: string[] = [];
    const created = mod.prepareLocalCodexAssets(
      { credentialMode: "runtime_provided", hasApiKey: false, secrets: {} },
      (m) => logs.push(m),
    );
    assert.equal(created, false);
    assert.equal(logs.filter((l) => l.includes("not found")).length, 0);
  });

  it("prepareLocalCodexAssets self-managed: un-migrated caller (no credentialMode, no key) routes to own-login path", () => {
    const logs: string[] = [];
    const created = mod.prepareLocalCodexAssets(
      { credentialMode: undefined, hasApiKey: false, secrets: {} },
      (m) => logs.push(m),
    );
    assert.equal(created, false);
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
