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
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  buildPiExtensionEnv,
  configurePiSkillSnapshot,
  configurePiSessionWorkspace,
  materializeDaytonaPiSkillSnapshot,
  materializeLocalPiSkillSnapshot,
  PI_SKILL_SNAPSHOT_MARKER,
  piSessionWorkspaceDir,
  prepareLocalAgentDir,
  prepareLocalPiAssets,
  resolvePiSkillSnapshot,
  uploadDirToSandbox,
  writeOtlpAuthFile,
  writeSystemPromptLocal,
} from "../../src/engines/sandbox_agent/pi-assets.ts";

describe("Pi session workspace", () => {
  it("uses one stable transcript directory inside the conversation cwd", () => {
    assert.equal(
      piSessionWorkspaceDir("/work/session-1"),
      "/work/session-1/agents/sessions/pi",
    );

    const env: Record<string, string> = {};
    const sessionDir = configurePiSessionWorkspace(
      { isPi: true, cwd: "/work/session-1" },
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
        { isPi: false, cwd: "/work/session-1" },
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

    const env = buildPiExtensionEnv(request, true, {
      relayDir: "/tmp/relay",
      usageOutPath: "/tmp/usage.json",
      otlpAuthFilePath: "/tmp/otlp-auth",
    });

    assert.equal(env.TRACEPARENT, request.context?.propagation?.traceparent);
    assert.equal(
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      request.telemetry?.exporters?.otlp?.endpoint,
    );
    // the bearer rides a file path, never a plain env var the harness can read/echo.
    assert.equal(env.AGENTA_AGENT_OTLP_AUTH_FILE, "/tmp/otlp-auth");
    assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, undefined);
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

  it("sets builtin gating env WITHOUT a relay dir (the gate rides the ACP dialog plane)", () => {
    const env = buildPiExtensionEnv({} as AgentRunRequest, false, {
      relayDir: "/tmp/relay",
      builtinGatingActive: true,
      builtinGrants: ["read", "write"],
    });

    assert.equal(env.AGENTA_AGENT_BUILTIN_GATING, "1");
    assert.equal(env.AGENTA_AGENT_BUILTIN_GRANTS, "read,write");
    assert.equal(env.AGENTA_AGENT_TOOLS_RELAY_DIR, undefined);
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

    const runDir = prepareLocalAgentDir(source);
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
    assert.equal(existsSync(join(runDir, "skills")), false);
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

describe("Pi skill snapshots", () => {
  it("publishes content-addressed local snapshots without replacing older versions", () => {
    const cwd = tempDir("agenta-pi-snapshot-cwd-");
    const skill = tempDir("agenta-pi-snapshot-skill-");
    mkdirSync(join(skill, "references"));
    writeFileSync(join(skill, "SKILL.md"), "first", "utf-8");
    writeFileSync(join(skill, "references", "guide.md"), "guide", "utf-8");

    const first = resolvePiSkillSnapshot({
      isPi: true,
      cwd,
      skillDirs: [{ name: "release-notes", dir: skill }],
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
      cwd,
      skillDirs: [{ name: "release-notes", dir: skill }],
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
      cwd,
      skillDirs: [{ name: "release-notes", dir: skill }],
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
      resolvePiSkillSnapshot({ isPi: false, cwd: "/work", skillDirs: [] }),
      undefined,
    );
    assert.equal(
      resolvePiSkillSnapshot({ isPi: true, cwd: "/work", skillDirs: [] }),
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
    over: Record<string, unknown> = {},
  ) => ({
    isPi: true,
    isDaytona: false,
    credentialMode: "runtime_provided",
    skillDirs: [],
    hasSystemPrompt: false,
    systemPrompt: undefined,
    appendSystemPrompt: undefined,
    sourcePiAgentDir: mount,
    ...over,
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

    const runDir = prepareLocalPiAssets({
      plan: subscriptionPlan(mount, {
        skillDirs: [],
        hasSystemPrompt: true,
        appendSystemPrompt: "extra",
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

    const runDir = prepareLocalPiAssets({
      plan: subscriptionPlan(source, {
        credentialMode: "env",
        hasSystemPrompt: true,
        appendSystemPrompt: "extra",
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
      cwd: "/workspace",
      skillDirs: [{ name: "release-notes", dir: skill }],
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
