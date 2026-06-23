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
import { basename, join } from "node:path";

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
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildPiExtensionEnv", () => {
  it("exposes tracing, usage, and public tool metadata only", () => {
    const request = {
      trace: {
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        endpoint: "https://otlp.example.test/v1/traces",
        authorization: "Bearer trace-token",
        captureContent: false,
      },
      customTools: [
        {
          name: "safe_tool",
          description: "safe",
          inputSchema: { type: "object", properties: { x: { type: "string" } } },
          callRef: "server-secret-ref",
          env: { SECRET: "do-not-expose" },
          kind: "callback",
        },
        {
          name: "client_only",
          description: "browser fulfilled",
          kind: "client",
        },
      ],
    } as AgentRunRequest;

    const env = buildPiExtensionEnv(request, true, {
      relayDir: "/tmp/relay",
      usageOutPath: "/tmp/usage.json",
    });

    assert.equal(env.AGENTA_TRACEPARENT, request.trace?.traceparent);
    assert.equal(env.AGENTA_OTLP_ENDPOINT, request.trace?.endpoint);
    assert.equal(env.AGENTA_OTLP_AUTHORIZATION, request.trace?.authorization);
    assert.equal(env.AGENTA_CAPTURE_CONTENT, "false");
    assert.equal(env.AGENTA_TOOL_RELAY_DIR, "/tmp/relay");
    assert.equal(env.AGENTA_USAGE_OUT, "/tmp/usage.json");

    const specs = JSON.parse(env.AGENTA_TOOL_PUBLIC_SPECS ?? "[]");
    assert.deepEqual(specs, [
      {
        name: "safe_tool",
        description: "safe",
        inputSchema: { type: "object", properties: { x: { type: "string" } } },
      },
    ]);
    assert.equal(JSON.stringify(specs).includes("server-secret-ref"), false);
    assert.equal(JSON.stringify(specs).includes("do-not-expose"), false);
  });

  it("omits trace and tool env when tracing and relay are disabled", () => {
    const env = buildPiExtensionEnv(
      {
        trace: {
          traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        },
        customTools: [{ name: "safe_tool", kind: "callback" }],
      } as AgentRunRequest,
      false,
    );

    assert.equal(env.AGENTA_TRACEPARENT, undefined);
    assert.equal(env.AGENTA_TOOL_PUBLIC_SPECS, undefined);
    assert.equal(env.AGENTA_TOOL_RELAY_DIR, undefined);
  });
});

describe("writeSystemPromptLocal", () => {
  it("writes replacement and append prompt files", () => {
    const dir = tempDir("agenta-pi-prompt-test-");

    writeSystemPromptLocal(dir, "system text", "append text");

    assert.equal(readFileSync(join(dir, "SYSTEM.md"), "utf-8"), "system text");
    assert.equal(readFileSync(join(dir, "APPEND_SYSTEM.md"), "utf-8"), "append text");
  });
});

describe("prepareLocalAgentDir", () => {
  it("seeds auth/settings and installs forced skills into a throwaway dir", () => {
    const source = tempDir("agenta-pi-source-test-");
    writeFileSync(join(source, "auth.json"), "{\"token\":\"x\"}", "utf-8");
    writeFileSync(join(source, "settings.json"), "{\"model\":\"gpt\"}", "utf-8");

    const skill = tempDir("agenta-pi-skill-test-");
    writeFileSync(join(skill, "SKILL.md"), "---\nname: skill\n---\n", "utf-8");

    const runDir = prepareLocalAgentDir(source, [skill]);
    dirs.push(runDir);

    assert.notEqual(runDir, source);
    assert.equal(readFileSync(join(runDir, "auth.json"), "utf-8"), "{\"token\":\"x\"}");
    assert.equal(readFileSync(join(runDir, "settings.json"), "utf-8"), "{\"model\":\"gpt\"}");
    assert.equal(
      readFileSync(join(runDir, "skills", basename(skill), "SKILL.md"), "utf-8"),
      "---\nname: skill\n---\n",
    );
  });
});

describe("sandbox uploads", () => {
  it("recursively uploads files into sandbox fs", async () => {
    const root = tempDir("agenta-pi-upload-test-");
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "top.txt"), "top", "utf-8");
    writeFileSync(join(root, "nested", "child.txt"), "child", "utf-8");
    const calls: Array<{ op: "mkdir" | "write"; path: string; body?: string }> = [];
    const sandbox = {
      mkdirFs: async ({ path }: { path: string }) => calls.push({ op: "mkdir", path }),
      writeFsFile: async ({ path }: { path: string }, body: string) =>
        calls.push({ op: "write", path, body }),
    };

    await uploadDirToSandbox(sandbox, root, "/agent/skills/custom");

    assert.deepEqual(calls, [
      { op: "mkdir", path: "/agent/skills/custom" },
      { op: "mkdir", path: "/agent/skills/custom/nested" },
      { op: "write", path: "/agent/skills/custom/nested/child.txt", body: "child" },
      { op: "write", path: "/agent/skills/custom/top.txt", body: "top" },
    ]);
  });

  it("uploads each forced skill under the Pi skills directory", async () => {
    const skill = tempDir("agenta-pi-skill-upload-test-");
    writeFileSync(join(skill, "SKILL.md"), "skill", "utf-8");
    const written: string[] = [];
    const sandbox = {
      mkdirFs: async () => {},
      writeFsFile: async ({ path }: { path: string }) => written.push(path),
    };

    await uploadSkillsToSandbox(sandbox, "/agent", [skill]);

    assert.equal(existsSync(skill), true);
    assert.deepEqual(written, [`/agent/skills/${basename(skill)}/SKILL.md`]);
  });
});
