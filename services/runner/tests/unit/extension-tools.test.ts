/**
 * Regression: the Agenta Pi extension registers custom tools from AGENTA_AGENT_TOOLS_PUBLIC_SPECS.
 *
 * Guards QA finding F-005 (docs/design/agent-workflows/qa/findings.md): a build where the
 * extension stopped reading AGENTA_AGENT_TOOLS_PUBLIC_SPECS shipped custom tools that the model never
 * saw, so it improvised with bash and failed. This pins the contract at the source: given the
 * public-spec env the runner sets (buildPiExtensionEnv in engines/sandbox_agent.ts), the extension
 * factory calls pi.registerTool once per spec, passes the JSON Schema through, and gives each
 * tool an execute() that relays to the runner. It is also inert when the env is absent.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/extension-tools.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import factory, {
  normalizeBuiltinGrants,
  readOtlpAuthFile,
  replaceActiveBuiltinTools,
} from "../../src/extensions/agenta.ts";

const TOOL_ENV = [
  "AGENTA_AGENT_TOOLS_PUBLIC_SPECS",
  "AGENTA_AGENT_TOOLS_RELAY_DIR",
  "TRACEPARENT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "AGENTA_AGENT_OTLP_AUTH_FILE",
  "AGENTA_AGENT_USAGE_CAPTURE_PATH",
  "AGENTA_AGENT_CONTENT_CAPTURE_ENABLED",
  "AGENTA_AGENT_BUILTIN_GATING",
  "AGENTA_AGENT_BUILTIN_GRANTS",
];

/** A fake extension UI context whose `confirm` records its calls and returns a scripted answer. */
function fakeDialogCtx(answer: boolean | (() => Promise<boolean>)) {
  const calls: Array<{ title: string; message: string }> = [];
  return {
    calls,
    ctx: {
      mode: "rpc" as const,
      hasUI: true,
      ui: {
        async confirm(title: string, message: string) {
          calls.push({ title, message });
          return typeof answer === "function" ? await answer() : answer;
        },
      },
    },
  };
}

function fakePi(opts: { activeTools?: string[]; allTools?: string[] } = {}) {
  const registered: any[] = [];
  const handlers: Record<string, any[]> = {};
  let activeTools = opts.activeTools ?? [];
  return {
    registered,
    handlers,
    registerTool(spec: any) {
      registered.push(spec);
    },
    on(event: string, handler: any) {
      (handlers[event] ??= []).push(handler);
    },
    getActiveTools() {
      return activeTools;
    },
    getAllTools() {
      return (opts.allTools ?? []).map((name) => ({ name }));
    },
    setActiveTools(next: string[]) {
      activeTools = next;
    },
  };
}

function clearEnv() {
  for (const key of TOOL_ENV) delete process.env[key];
}

afterEach(clearEnv);

describe("agenta extension tool registration", () => {
  it("registers one tool per public spec, schema passed through", () => {
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      {
        name: "secret_math",
        description: "qa math",
        input_schema: {
          type: "object",
          properties: { x: { type: "integer" } },
          required: ["x"],
        },
      },
      { name: "no_schema_tool", description: "no schema" },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.equal(pi.registered.length, 2, "registers one tool per public spec");
    assert.deepEqual(
      pi.registered.map((t) => t.name),
      ["secret_math", "no_schema_tool"],
      "registers each spec by name",
    );

    const math = pi.registered[0];
    assert.equal(math.description, "qa math", "carries the description");
    assert.ok(
      math.parameters &&
        math.parameters.properties &&
        math.parameters.properties.x,
      "passes the JSON Schema through to Pi",
    );
    assert.equal(
      math.promptSnippet,
      "qa math",
      "opts the tool into Pi's Available tools prompt",
    );
    assert.ok(
      math.promptGuidelines.some((line: string) =>
        line.includes("required argument(s): x"),
      ),
      "adds prompt guidance for required arguments",
    );
    assert.equal(
      typeof math.execute,
      "function",
      "each tool has an execute() that relays",
    );

    const noSchema = pi.registered[1];
    assert.ok(
      noSchema.parameters,
      "a spec without inputSchema falls back to a schema, never undefined",
    );
  });

  it("is inert without the tool env (the F-005 bug shape: never delivered)", () => {
    clearEnv();
    const pi = fakePi();
    factory(pi as any);
    assert.equal(
      pi.registered.length,
      0,
      "no tool env => registers nothing (no silent partial state)",
    );
  });

  it("does not register builtin gating hooks when gating env is absent", () => {
    clearEnv();
    const pi = fakePi();
    factory(pi as any);
    assert.equal(pi.handlers.before_agent_start?.length ?? 0, 0);
    assert.equal(pi.handlers.tool_call?.length ?? 0, 0);
  });

  it("registers builtin gating hooks for a gating-only run", () => {
    clearEnv();
    process.env.AGENTA_AGENT_BUILTIN_GATING = "true";
    process.env.AGENTA_AGENT_BUILTIN_GRANTS = "read";
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.equal(pi.registered.length, 0);
    assert.equal(pi.handlers.before_agent_start?.length ?? 0, 1);
    assert.equal(pi.handlers.tool_call?.length ?? 0, 1);
  });

  it("removes non-granted builtins from the active set at before_agent_start", async () => {
    clearEnv();
    process.env.AGENTA_AGENT_BUILTIN_GATING = "1";
    process.env.AGENTA_AGENT_BUILTIN_GRANTS = "read,write";
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi({
      activeTools: ["read", "bash", "edit", "write", "custom_tool"],
      allTools: [
        "read",
        "bash",
        "edit",
        "write",
        "grep",
        "find",
        "ls",
        "custom_tool",
      ],
    });
    factory(pi as any);

    await pi.handlers.before_agent_start[0]({});

    assert.deepEqual(pi.getActiveTools(), ["read", "write", "custom_tool"]);
  });

  it("validates builtin grants by de-duping and dropping unknown names", () => {
    const logs: string[] = [];

    const grants = normalizeBuiltinGrants(
      "read,unknown,read,Find,BASH,unknown",
      (message) => logs.push(message),
    );

    assert.deepEqual(grants, ["read", "find", "bash"]);
    assert.deepEqual(logs, ["dropping unknown builtin grant 'unknown'"]);
  });

  it("replaces only the builtin portion of the active tool set", () => {
    assert.deepEqual(
      replaceActiveBuiltinTools(
        ["custom_before", "read", "bash", "custom_after"],
        [
          { name: "read" },
          { name: "bash" },
          { name: "edit" },
          { name: "write" },
          { name: "grep" },
          { name: "custom_before" },
          { name: "custom_after" },
        ],
        ["read", "grep"],
      ),
      ["custom_before", "read", "grep", "custom_after"],
    );
  });

  it("rejects missing required args before relaying a no-op tool call", async () => {
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      {
        name: "commit_revision",
        description: "commit",
        inputSchema: {
          type: "object",
          properties: {
            workflow_revision: {
              type: "object",
              properties: {
                data: { type: "object" },
              },
              required: ["data"],
            },
          },
          required: ["workflow_revision"],
        },
      },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    await assert.rejects(
      () => pi.registered[0].execute("call-1", {}),
      /missing required argument\(s\): workflow_revision/,
    );
  });

  it("does not register when specs are present but the relay dir is missing", () => {
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      { name: "x" },
    ]);
    const pi = fakePi();
    factory(pi as any);
    assert.equal(
      pi.registered.length,
      0,
      "specs without a relay dir do not register (incomplete wiring is not honored)",
    );
  });
});

describe("readOtlpAuthFile", () => {
  it("reads the bearer once, then deletes the file so it cannot be re-read", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-otlp-auth-test-"));
    const path = join(dir, "otlp-auth");
    writeFileSync(path, "Bearer trace-token", "utf-8");

    const value = readOtlpAuthFile(path);

    assert.equal(value, "Bearer trace-token");
    assert.equal(existsSync(path), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined for a missing path without throwing", () => {
    assert.equal(readOtlpAuthFile(undefined), undefined);
    assert.equal(readOtlpAuthFile("/nonexistent/agenta-otlp-auth"), undefined);
  });
});

describe("agenta extension: Pi dialog gate (approval parking)", () => {
  function builtinEvent(toolName: string, input: unknown) {
    return { type: "tool_call", toolName, toolCallId: "tc-b", input };
  }

  it("builtin gate rides ctx.ui.confirm with the envelope; allow -> undefined", async () => {
    clearEnv();
    process.env.AGENTA_AGENT_BUILTIN_GATING = "1";

    const pi = fakePi();
    factory(pi as any);
    const hook = pi.handlers.tool_call![0];
    const { calls, ctx } = fakeDialogCtx(true);

    const result = await hook(builtinEvent("bash", { command: "ls" }), ctx);
    assert.equal(result, undefined, "allow -> the builtin proceeds");
    assert.equal(calls.length, 1, "the dialog was raised (not the relay)");
    assert.equal(calls[0].title, "agenta-approval");
    const envelope = JSON.parse(calls[0].message);
    assert.equal(envelope.kind, "agenta.gate");
    assert.equal(envelope.gate, "pi-builtin");
    assert.equal(envelope.toolName, "bash");
    assert.deepEqual(envelope.input, { command: "ls" });
  });

  it("builtin gate: deny -> block, and a thrown/absent dialog fails closed (block)", async () => {
    clearEnv();
    process.env.AGENTA_AGENT_BUILTIN_GATING = "1";

    const pi = fakePi();
    factory(pi as any);
    const hook = pi.handlers.tool_call![0];

    const denied = await hook(
      builtinEvent("bash", {}),
      fakeDialogCtx(false).ctx,
    );
    assert.equal(denied.block, true, "deny -> block");

    const threw = await hook(
      builtinEvent("bash", {}),
      fakeDialogCtx(async () => {
        throw new Error("dialog transport gone");
      }).ctx,
    );
    assert.equal(threw.block, true, "a thrown dialog fails closed");

    const noUi = await hook(builtinEvent("bash", {}), {
      mode: "rpc",
      hasUI: false,
    });
    assert.equal(noUi.block, true, "no UI plane fails closed");
  });

  it("custom-tool gate: a deny returns the reason WITHOUT relaying (early return)", async () => {
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      { name: "park_probe", description: "echo", kind: "callback" },
    ]);
    // A relay dir that does not exist: if the deny path relayed, the poll would hang/fail. It must
    // not be reached.
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR =
      "/tmp/agenta-relay-must-not-be-used";

    const pi = fakePi();
    factory(pi as any);
    const tool = pi.registered[0];
    const { calls, ctx } = fakeDialogCtx(false);

    const result = await tool.execute(
      "call_1",
      { token: "T" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.length, 1, "the dialog was raised before the relay");
    const envelope = JSON.parse(calls[0].message);
    assert.equal(envelope.gate, "pi-custom-tool");
    assert.equal(envelope.toolName, "park_probe");
    assert.deepEqual(envelope.input, { token: "T" });
    assert.ok(
      result.content[0].text.toLowerCase().includes("denied"),
      "a denied custom tool returns the deny reason as its result",
    );
  });

  it("custom-tool gate: a CLIENT spec is NOT dialog-gated (keeps its relay path)", async () => {
    clearEnv();
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-client-"));
    // Pre-seed the relay response so the client tool's relay returns immediately.
    writeFileSync(
      join(dir, "cclient.res.json"),
      JSON.stringify({ ok: true, text: "browser-fulfilled" }),
      "utf-8",
    );
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      { name: "request_connection", description: "connect", kind: "client" },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = dir;

    const pi = fakePi();
    factory(pi as any);
    const tool = pi.registered[0];
    const { calls, ctx } = fakeDialogCtx(false);

    const result = await tool.execute(
      "cclient",
      { integration: "slack" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.length, 0, "a client tool is never dialog-gated");
    assert.equal(
      result.content[0].text,
      "browser-fulfilled",
      "it took the relay path",
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
