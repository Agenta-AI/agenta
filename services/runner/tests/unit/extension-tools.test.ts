/**
 * The Agenta Pi extension registers custom tools from AGENTA_AGENT_TOOLS_PUBLIC_SPECS.
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
  readPiTurnTraceControl,
  replaceActiveBuiltinTools,
} from "../../src/extensions/agenta.ts";
import {
  PI_TRACE_CONTROL_ENV,
  PI_TRACE_CONTROL_VERSION,
} from "../../src/tracing/pi-spool-protocol.ts";
import {
  PI_MODEL_PROVIDER_OVERRIDE_ENV,
  validatePiModelProviderOverride,
} from "../../src/extensions/model-provider-override.ts";
import { refusedAtGateText } from "../../src/tools/denial-text.ts";
import { PUBLIC_SPECS_FILE_ENV } from "../../src/tools/tool-mcp-env.ts";

const TOOL_ENV = [
  "AGENTA_AGENT_TOOLS_PUBLIC_SPECS",
  PUBLIC_SPECS_FILE_ENV,
  "AGENTA_AGENT_TOOLS_RELAY_DIR",
  PI_TRACE_CONTROL_ENV,
  "AGENTA_AGENT_USAGE_CAPTURE_PATH",
  "AGENTA_AGENT_BUILTIN_ACTIVATION",
  "AGENTA_AGENT_BUILTIN_GATING",
  PI_MODEL_PROVIDER_OVERRIDE_ENV,
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
  const registeredProviders: Array<{ name: string; config: unknown }> = [];
  const handlers: Record<string, any[]> = {};
  let activeTools = opts.activeTools ?? [];
  return {
    registered,
    registeredProviders,
    handlers,
    registerTool(spec: any) {
      registered.push(spec);
    },
    registerProvider(name: string, config: unknown) {
      registeredProviders.push({ name, config });
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

describe("agenta extension model provider override", () => {
  it("rejects header-injection characters in override headers", () => {
    for (const headers of [
      { "X-AG-Credentials: injected": "ApiKey value" },
      { "X-AG-Credentials\r\nX-Injected": "ApiKey value" },
      { "X-AG-Credentials": "ApiKey value\nX-Injected: yes" },
    ]) {
      assert.throws(() =>
        validatePiModelProviderOverride({
          provider: "anthropic",
          baseUrl: "https://gateway.example.test",
          headers,
        }),
      );
    }
  });

  it("overrides the built-in provider during extension initialization", () => {
    clearEnv();
    process.env[PI_MODEL_PROVIDER_OVERRIDE_ENV] = JSON.stringify({
      provider: "anthropic",
      baseUrl: "https://proxy.example.test/anthropic",
    });
    const pi = fakePi();

    factory(pi as any);

    assert.deepEqual(pi.registeredProviders, [
      {
        name: "anthropic",
        config: { baseUrl: "https://proxy.example.test/anthropic" },
      },
    ]);
    assert.equal(pi.registered.length, 0);
    assert.deepEqual(pi.handlers, {});
  });

  it("carries OUR gateway credential and a placeholder apiKey onto the built-in provider override (WP13 reopen)", () => {
    // A gateway-routed connection whose original deployment is "direct" (a plain provider_key
    // connection) never goes through the custom-provider models.json path
    // (isPiModelConfigApplicable requires a NAMED custom-agenta connection) -- this extension
    // override is the ONLY place it can carry the header, or the run reaches the real provider
    // with no credential and no visible failure.
    clearEnv();
    process.env[PI_MODEL_PROVIDER_OVERRIDE_ENV] = JSON.stringify({
      provider: "anthropic",
      baseUrl: "https://gateway.example.com/gateways/llms/standard/anthropic",
      headers: { "X-AG-Credentials": "ApiKey mock-gateway-credentials" },
      apiKey: "agenta-gateway",
    });
    const pi = fakePi();

    factory(pi as any);

    assert.deepEqual(pi.registeredProviders, [
      {
        name: "anthropic",
        config: {
          baseUrl:
            "https://gateway.example.com/gateways/llms/standard/anthropic",
          headers: { "X-AG-Credentials": "ApiKey mock-gateway-credentials" },
          apiKey: "agenta-gateway",
        },
      },
    ]);
  });

  it("permits a local HTTP route only when it carries the gateway credential", () => {
    assert.equal(
      validatePiModelProviderOverride({
        provider: "openai",
        baseUrl: "http://api:8000/gateways/llms/builtin/mock/v1",
        headers: { "X-AG-Credentials": "ApiKey gateway-credential" },
      }).baseUrl,
      "http://api:8000/gateways/llms/builtin/mock/v1",
    );
  });

  it("rejects malformed public override config before registration", () => {
    clearEnv();
    process.env[PI_MODEL_PROVIDER_OVERRIDE_ENV] = JSON.stringify({
      provider: "anthropic",
      baseUrl: "http://proxy.example.test",
    });
    const pi = fakePi();

    assert.throws(() => factory(pi as any), /must be HTTPS/);
    assert.deepEqual(pi.registeredProviders, []);

    process.env[PI_MODEL_PROVIDER_OVERRIDE_ENV] = "";
    assert.throws(() => factory(pi as any), /must be valid JSON/);
    assert.deepEqual(pi.registeredProviders, []);
  });
});

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

  it("skips a custom tool named after a built-in, so the built-in survives", () => {
    // Pi keys its registry by name: registering these would replace the built-ins the platform
    // guarantees are active. The SDK refuses such a config; the runner refuses it again.
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      { name: "read", description: "shadow" },
      { name: "Bash", description: "shadow, other case" },
      { name: "reader", description: "not a built-in" },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.deepEqual(
      pi.registered.map((t) => t.name),
      ["reader"],
      "only the non-colliding tool is registered",
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

  it("registers no builtin hooks when the activation and gating env are absent", () => {
    clearEnv();
    const pi = fakePi();
    factory(pi as any);
    assert.equal(pi.handlers.before_agent_start?.length ?? 0, 0);
    assert.equal(pi.handlers.tool_call?.length ?? 0, 0);
  });

  it("registers activation without gating when only the activation env is set", () => {
    clearEnv();
    process.env.AGENTA_AGENT_BUILTIN_ACTIVATION = "1";

    const pi = fakePi();
    factory(pi as any);

    assert.equal(pi.registered.length, 0);
    assert.equal(pi.handlers.before_agent_start?.length ?? 0, 1);
    assert.equal(pi.handlers.tool_call?.length ?? 0, 0);
  });

  it("registers both hooks for an activated, gated run", () => {
    clearEnv();
    process.env.AGENTA_AGENT_BUILTIN_ACTIVATION = "1";
    process.env.AGENTA_AGENT_BUILTIN_GATING = "true";
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.equal(pi.registered.length, 0);
    assert.equal(pi.handlers.before_agent_start?.length ?? 0, 1);
    assert.equal(pi.handlers.tool_call?.length ?? 0, 1);
  });

  it("activates every builtin the harness reports at before_agent_start", async () => {
    clearEnv();
    process.env.AGENTA_AGENT_BUILTIN_ACTIVATION = "1";

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

    assert.deepEqual(pi.getActiveTools(), [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "custom_tool",
    ]);
  });

  it("replaces only the builtin portion of the active tool set", () => {
    assert.deepEqual(
      replaceActiveBuiltinTools(
        ["custom_before", "read", "bash", "custom_after"],
        [
          { name: "read" },
          { name: "bash" },
          { name: "grep" },
          { name: "custom_before" },
          { name: "custom_after" },
        ],
      ),
      ["custom_before", "read", "bash", "grep", "custom_after"],
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

/**
 * Tool specs arrive in a file named by AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE.
 */
describe("agenta extension tool specs delivery", () => {
  const specsDirs: string[] = [];

  function specsFile(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "agenta-ext-specs-"));
    specsDirs.push(dir);
    const path = join(dir, "relay.tool-specs.json");
    writeFileSync(path, contents, "utf-8");
    return path;
  }

  afterEach(() => {
    for (const dir of specsDirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("registers tools from the specs file the runner wrote", () => {
    clearEnv();
    process.env[PUBLIC_SPECS_FILE_ENV] = specsFile(
      JSON.stringify([
        { name: "from_file_one", description: "one" },
        { name: "from_file_two", description: "two" },
      ]),
    );
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.deepEqual(
      pi.registered.map((t) => t.name),
      ["from_file_one", "from_file_two"],
    );
  });

  it("carries a tool set far larger than a single env string can hold", () => {
    clearEnv();
    const specs = Array.from({ length: 44 }, (_, i) => ({
      name: `composio_tool_${i}`,
      description: `Tool ${i}. ${"description text ".repeat(60)}`,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 40 }, (_, f) => [
            `field_${f}`,
            {
              type: "string",
              description: `Field ${f}. ${"prose ".repeat(20)}`,
            },
          ]),
        ),
      },
    }));
    const json = JSON.stringify(specs);
    assert.ok(Buffer.byteLength(json, "utf-8") > 300_000);
    process.env[PUBLIC_SPECS_FILE_ENV] = specsFile(json);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.equal(pi.registered.length, 44);
  });

  it("prefers the file over the pre-file inline env var", () => {
    clearEnv();
    process.env[PUBLIC_SPECS_FILE_ENV] = specsFile(
      JSON.stringify([{ name: "from_file", description: "file" }]),
    );
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      { name: "from_env", description: "stale inline copy" },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.deepEqual(
      pi.registered.map((t) => t.name),
      ["from_file"],
    );
  });

  it("still reads the inline env var when no file is named (one-release fallback)", () => {
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      { name: "from_env", description: "inline" },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    const pi = fakePi();
    factory(pi as any);

    assert.deepEqual(
      pi.registered.map((t) => t.name),
      ["from_env"],
    );
  });

  it("registers nothing when the named file is unreadable or malformed", () => {
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-test";

    process.env[PUBLIC_SPECS_FILE_ENV] = join(
      tmpdir(),
      "agenta-ext-specs-absent",
      "relay.tool-specs.json",
    );
    const missing = fakePi();
    factory(missing as any);
    assert.equal(missing.registered.length, 0);

    process.env[PUBLIC_SPECS_FILE_ENV] = specsFile("{not json");
    const malformed = fakePi();
    factory(malformed as any);
    assert.equal(malformed.registered.length, 0);

    process.env[PUBLIC_SPECS_FILE_ENV] = specsFile('{"name":"not-an-array"}');
    const notArray = fakePi();
    factory(notArray as any);
    assert.equal(notArray.registered.length, 0);
  });
});

describe("readPiTurnTraceControl", () => {
  it("reads one bounded turn control, then deletes it", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-trace-control-test-"));
    const path = join(dir, "current.control.json");
    const control = {
      version: PI_TRACE_CONTROL_VERSION,
      channelId: "a".repeat(32),
      capture: { content: true },
      skills: ["weather"],
      redaction: { knownValues: ["mount-secret"] },
    };
    writeFileSync(path, JSON.stringify(control), "utf-8");

    assert.deepEqual(readPiTurnTraceControl(path), {
      ...control,
      turnId: undefined,
      sessionId: undefined,
      propagation: undefined,
    });
    assert.equal(existsSync(path), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined for a missing path without throwing", () => {
    assert.equal(readPiTurnTraceControl(undefined), undefined);
    assert.equal(
      readPiTurnTraceControl("/nonexistent/agenta-trace-control"),
      undefined,
    );
  });
});

describe("agenta extension usage publication", () => {
  it("writes usage before waiting for the native trace flush", async () => {
    clearEnv();
    const dir = mkdtempSync(join(tmpdir(), "agenta-usage-order-test-"));
    const controlPath = join(dir, "current.control.json");
    const usagePath = join(dir, "usage.json");
    writeFileSync(
      controlPath,
      JSON.stringify({
        version: PI_TRACE_CONTROL_VERSION,
        channelId: "a".repeat(32),
        capture: { content: true },
        skills: [],
        redaction: { knownValues: [] },
      }),
      "utf-8",
    );
    process.env[PI_TRACE_CONTROL_ENV] = controlPath;
    process.env.AGENTA_AGENT_USAGE_CAPTURE_PATH = usagePath;

    const pi = fakePi();
    factory(pi as any);

    for (const handler of pi.handlers.before_agent_start)
      await handler({ prompt: "hello" });
    for (const handler of pi.handlers.agent_start) await handler({});
    for (const handler of pi.handlers.message_end) {
      await handler({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          usage: {
            input: 3,
            output: 2,
            totalTokens: 5,
            cost: { total: 0.01 },
          },
        },
      });
    }

    await pi.handlers.agent_end[0]({
      messages: [{ role: "assistant", content: "hello" }],
    });
    const flush = pi.handlers.agent_end[1]({});

    assert.equal(
      existsSync(usagePath),
      true,
      "the usage sidecar is visible before trace flush yields",
    );
    assert.deepEqual(JSON.parse(readFileSync(usagePath, "utf-8")), {
      input: 3,
      output: 2,
      total: 5,
      cost: 0.01,
    });

    await flush;
    rmSync(dir, { recursive: true, force: true });
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
    // What the model reads. The block is only half the behavior; the reason is the half that
    // decides whether the model asks the user or gives up on the whole tool.
    assert.equal(denied.reason, refusedAtGateText("bash"));
    assert.doesNotMatch(denied.reason, /policy/i);

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
    // The block is only half of it. A broken approval channel used to answer with a bare
    // statement of fact and no next step, which is the shape that produced "I'll retry as soon
    // as that is allowed".
    assert.match(noUi.reason, /Nothing ran/);
    assert.match(noUi.reason, /Tell the user the approval step is unavailable/);
    assert.match(threw.reason, /dialog transport gone/, "the cause survives");
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
    // The model-visible text, asserted as the SHARED string rather than by substring. It used to
    // read "Denied by the permission policy.", which names a decider this side cannot know: a
    // confirm resolves to a boolean, so a policy deny and a human declining one change are
    // indistinguishable here. See `refusedAtGateText`.
    assert.equal(result.content[0].text, refusedAtGateText("park_probe"));
    assert.doesNotMatch(result.content[0].text, /policy/i);
  });

  it("custom-tool gate: a malformed call errors to the model BEFORE the dialog is raised", async () => {
    // Argument validation precedes the gate: a missing required argument must never reach a
    // human as an approval prompt (and never relay as a no-op).
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      {
        name: "park_probe",
        description: "echo",
        kind: "callback",
        inputSchema: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR =
      "/tmp/agenta-relay-must-not-be-used";

    const pi = fakePi();
    factory(pi as any);
    const tool = pi.registered[0];
    const { calls, ctx } = fakeDialogCtx(true);

    await assert.rejects(
      () => tool.execute("call_1", {}, undefined, undefined, ctx),
      /missing required argument\(s\): token/,
    );
    assert.equal(calls.length, 0, "the dialog was never raised");
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

  it("WP26: request_connection's prompt guidance covers both the integration and the gateway-target call shapes", () => {
    clearEnv();
    process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify([
      { name: "request_connection", description: "connect", kind: "client" },
    ]);
    process.env.AGENTA_AGENT_TOOLS_RELAY_DIR = "/tmp/agenta-relay-unused";

    const pi = fakePi();
    factory(pi as any);
    const tool = pi.registered[0];

    assert.ok(
      tool.promptGuidelines.some(
        (line: string) => line.includes("integration") && line.includes("mode"),
      ),
      "still guides the existing external-integration call shape",
    );
    assert.ok(
      tool.promptGuidelines.some(
        (line: string) =>
          line.includes("target:") &&
          line.includes("plane") &&
          line.includes("not registered"),
      ),
      "also guides the new gateway-target call shape",
    );
  });
});
