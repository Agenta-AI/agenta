/**
 * The `/run` wire contract, asserted from the TypeScript (consumer) side against the shared
 * golden fixtures. The Python (producer) side asserts the same files in
 * `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`; this is the other half it
 * names ("the TS side asserts the same files").
 *
 * Two layers, because `protocol.ts` is types only (erased at runtime):
 *  - COMPILE-TIME: a key list mirrored from the Python `KNOWN_REQUEST_KEYS`, assigned to
 *    `(keyof AgentRunRequest)[]`. If `protocol.ts` renames or drops a field the wire still
 *    emits, this fails `tsc`.
 *  - RUNTIME: load each golden file and assert its real shape, exercising the runner's own
 *    helpers (`resolvePromptText`, `resolveRunSessionId`, `messageText`).
 *
 * If a field is added/renamed/removed on the wire, update the golden, then `protocol.ts` and
 * the key lists here, deliberately.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/wire-contract.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { loadGolden } from "../utils/golden.ts";
import {
  type AgentRunRequest,
  type AgentRunResult,
  type HarnessCapabilities,
  messageText,
  resolvePromptText,
  resolveRunSessionId,
} from "../../src/protocol.ts";

// Mirror of KNOWN_REQUEST_KEYS in the Python test: the full set of top-level keys the wire
// may emit. AgentRunRequest must declare every one.
const KNOWN_REQUEST_KEYS = [
  "harness",
  "sandbox",
  "sessionId",
  "agentsMd",
  "model",
  "provider",
  "connection",
  "deployment",
  "endpoint",
  "credentialMode",
  "messages",
  "secrets",
  "context",
  "telemetry",
  "runContext",
  "tools",
  "customTools",
  "mcpServers",
  "toolCallback",
  "permissionPolicy",
  "systemPrompt",
  "appendSystemPrompt",
  "skills",
  "sandboxPermission",
  "harnessFiles",
  "turnId",
  "projectId",
] as const;

// COMPILE-TIME drift guard: every wire key must be a field of AgentRunRequest. Drop or rename
// a field in protocol.ts and this assignment stops typechecking.
const _requestKeysExistOnType: readonly (keyof AgentRunRequest)[] =
  KNOWN_REQUEST_KEYS;
void _requestKeysExistOnType;

describe("wire contract: requests (vs Python golden)", () => {
  for (const name of ["run_request.pi_core.json", "run_request.claude.json"]) {
    it(`${name}: every top-level key is known to AgentRunRequest`, () => {
      const req = loadGolden(name) as Record<string, unknown>;
      for (const key of Object.keys(req)) {
        assert.ok(
          (KNOWN_REQUEST_KEYS as readonly string[]).includes(key),
          `golden request key '${key}' is not in KNOWN_REQUEST_KEYS / AgentRunRequest`,
        );
      }
    });
  }

  it("pi request: shape, tool axes, and the runner helpers", () => {
    const req = loadGolden("run_request.pi_core.json") as AgentRunRequest;
    assert.equal(req.harness, "pi_core");
    assert.ok(Array.isArray(req.messages));
    // The serializer emits `messages` only; the runner derives the latest turn.
    assert.equal(resolvePromptText(req), "hi");
    assert.equal(messageText(req.messages![0].content), "hi");
    // The platform session id wins over the runner fallback.
    assert.equal(resolveRunSessionId(req, "runner-ephemeral"), "sess-1");
    // The custom-tool axes reach the runner intact.
    const tool = req.customTools![0];
    assert.equal(tool.kind, "callback");
    assert.ok(
      tool.callRef && tool.callRef.length > 0,
      "callback tool carries its callRef",
    );
    // The Composio read-only hint reaches the runner as `readOnly`.
    assert.equal(tool.readOnly, true);
    // The Layer-3 permission (derived `allow` from read-only) reaches the runner.
    assert.equal(tool.permission, "allow");
    // The direct-call tool (direct-call tools, Phase 1) reaches the runner carrying its `call`
    // descriptor and NO `callRef` (the `call` XOR `callRef` rule). Plumbing only here: the runner
    // forwards it opaquely; no dispatch branch reads it yet.
    const direct = req.customTools![1];
    assert.equal(direct.kind, "callback");
    assert.equal(direct.callRef, undefined);
    assert.equal(direct.call!.method, "POST");
    assert.equal(direct.call!.path, "/api/workflows/invoke");
    assert.equal(direct.call!.args_into, "data.inputs");
    assert.deepEqual(direct.call!.body, {
      references: { workflow_revision: { id: "rev_abc123" } },
    });
    // The run's own context (direct-call tools, Phase 3a) reaches the runner as `runContext`, with
    // snake_case inner keys (the `$ctx.<key>` binding namespace) and the workflow grouped into the
    // platform's artifact / variant / revision entities. The runner fills a tool's `call.context`
    // from this blob at dispatch (see tools/direct.ts `assembleBody`); the model never reads it.
    assert.equal(req.runContext!.workflow!.variant!.id, "var_abc");
    assert.equal(req.runContext!.workflow!.variant!.slug, "weather-agent");
    assert.equal(req.runContext!.workflow!.revision!.id, "rev_abc123");
    assert.equal(req.runContext!.workflow!.is_draft, false);
    assert.equal(
      req.runContext!.trace!.trace_id,
      "0af7651916cd43dd8448eb211c80319c",
    );
    // The conversation id is NOT duplicated in run context; it rides the top-level `sessionId`.
    assert.equal(
      (req.runContext as Record<string, unknown>).session_id,
      undefined,
    );
    assert.equal(req.sessionId, "sess-1");
    // The run's tracing inputs reach the runner grouped by role (trace/telemetry restructure): the
    // per-call W3C propagation under `context.propagation`, and the operator-owned exporter config +
    // capture policy under `telemetry` (the OTLP credential under the standard `authorization`
    // header). No single `trace` bucket mixes the four roles anymore.
    assert.equal(
      req.context!.propagation!.traceparent,
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    );
    assert.equal(req.telemetry!.capture!.content!.enabled, true);
    assert.equal(
      req.telemetry!.exporters!.otlp!.endpoint,
      "https://otlp.example/v1/traces",
    );
    assert.equal(
      req.telemetry!.exporters!.otlp!.headers!.authorization,
      "Access tok-123",
    );
    assert.equal((req as Record<string, unknown>).trace, undefined);
    // Pi exposes the prompt overrides.
    assert.equal(req.systemPrompt, "You are Pi.");
    assert.equal(req.appendSystemPrompt, "Be terse.");
    // The resolved inline skill package reaches the runner with its full nested shape intact:
    // the frontmatter fields, the behavior flags, and each bundled file's `executable` bit.
    const skill = req.skills![0];
    assert.equal(skill.name, "release-notes");
    assert.equal(skill.description, "Draft release notes from a changelog.");
    assert.equal(skill.body, "Read the changelog, then write release notes.");
    assert.equal(skill.disableModelInvocation, true);
    assert.equal(skill.allowExecutableFiles, true);
    assert.equal(skill.files![0].path, "scripts/draft.py");
    assert.equal(skill.files![0].content, "print('draft')");
    assert.equal(skill.files![0].executable, true);
    // The declared sandbox boundary reaches the runner as nested camelCase `sandboxPermission`.
    assert.equal(req.sandboxPermission!.network!.mode, "off");
    assert.deepEqual(req.sandboxPermission!.network!.allowlist, []);
    assert.equal(req.sandboxPermission!.enforcement, "strict");
    // Pi renders no harness config files, so the generic `harnessFiles` is absent.
    assert.equal(req.harnessFiles, undefined);
  });

  it("claude request: gates tool use, no prompt overrides, null session id", () => {
    const req = loadGolden("run_request.claude.json") as AgentRunRequest;
    assert.equal(req.harness, "claude");
    assert.deepEqual(req.tools, []); // Claude has no Pi built-ins
    assert.equal(req.permissionPolicy, "deny"); // Claude gates tool use
    assert.equal(req.systemPrompt, undefined); // Claude exposes no prompt overrides
    assert.equal(req.appendSystemPrompt, undefined);
    assert.equal(req.runContext, undefined); // no run context threaded on this config
    assert.equal(req.sandboxPermission, undefined); // no boundary declared on this config
    // The Claude harness's permission knobs are translated to a rendered file in Python: the
    // wire carries a generic `harnessFiles` entry the runner writes blind into the cwd.
    const files = req.harnessFiles!;
    assert.equal(files.length, 1);
    assert.equal(files[0].path, ".claude/settings.json");
    const settings = JSON.parse(files[0].content) as {
      permissions: Record<string, unknown>;
    };
    assert.equal(settings.permissions.defaultMode, "acceptEdits");
    // The allow list also carries the per-resolved-tool rule for the internal `agenta-tools` MCP
    // server (F-046): the golden's `get_user` is a read-only callback tool -> effective `allow` ->
    // `mcp__agenta-tools__get_user`, so Claude runs it instead of parking on its own permission gate.
    assert.deepEqual(settings.permissions.allow, [
      "Read",
      "Bash(npm run:*)",
      "mcp__agenta-tools__get_user",
    ]);
    assert.deepEqual(settings.permissions.deny, ["WebFetch"]);
    // Claude carries resolved inline skills on the same `skills` seam Pi uses; the runner
    // installs them into Claude's project-local `.claude/skills/<name>` tree. This regressed
    // twice via merge-loss, so the cross-language golden pins it for Claude, not just Pi.
    const skill = req.skills![0];
    assert.equal(skill.name, "release-notes");
    assert.equal(skill.body, "Read the changelog, then write release notes.");
    assert.equal(skill.disableModelInvocation, true);
    assert.equal(skill.files![0].path, "scripts/draft.py");
    assert.equal(skill.files![0].executable, true);
    // sessionId is null on the wire, so the runner falls back to its ephemeral id.
    assert.equal(
      resolveRunSessionId(req, "runner-ephemeral"),
      "runner-ephemeral",
    );
  });
});

// Mirror of the result capability flags: every camelCase key the wire returns must be a field
// of HarnessCapabilities. Compile-time guard, same idea as the request keys.
const CAPABILITY_KEYS = [
  "textMessages",
  "images",
  "fileAttachments",
  "mcpTools",
  "toolCalls",
  "reasoning",
  "planMode",
  "permissions",
  "usage",
  "streamingDeltas",
  "sessionLifecycle",
] as const;
const _capabilityKeysExistOnType: readonly (keyof HarnessCapabilities)[] =
  CAPABILITY_KEYS;
void _capabilityKeysExistOnType;

describe("wire contract: results (vs Python golden)", () => {
  it("ok result: shape, events, and camelCase capabilities", () => {
    const res = loadGolden("run_result.ok.json") as AgentRunResult & {
      capabilities: Record<string, unknown>;
    };
    assert.equal(res.ok, true);
    assert.equal(res.output, "Hello!");
    assert.deepEqual(
      res.messages!.map((m) => m.role),
      ["assistant"],
    );
    // The wire carries a trailing event with no `type`; the Python consumer drops it on
    // parse, so the TS contract must tolerate it (three typed events survive).
    const typed = res.events!.filter(
      (e) => typeof (e as { type?: unknown }).type === "string",
    );
    assert.deepEqual(
      typed.map((e) => e.type),
      ["message", "usage", "done"],
    );
    assert.deepEqual(res.usage, {
      input: 10,
      output: 5,
      total: 15,
      cost: 0.001,
    });
    assert.equal(res.stopReason, "end_turn");
    assert.equal(res.sessionId, "sess-42");
    assert.equal(res.model, "gpt-5.5");
    assert.equal(res.traceId, "trace-abc");
    // Capabilities come back camelCase; every key must be known to HarnessCapabilities.
    for (const key of Object.keys(res.capabilities)) {
      assert.ok(
        (CAPABILITY_KEYS as readonly string[]).includes(key),
        `golden capability key '${key}' is not in HarnessCapabilities`,
      );
    }
    assert.equal(res.capabilities.mcpTools, true);
    assert.equal(res.capabilities.images, false);
    assert.equal(res.capabilities.textMessages, true);
  });

  it("error result: ok=false carries the error message", () => {
    const res = loadGolden("run_result.error.json") as AgentRunResult;
    assert.equal(res.ok, false);
    assert.equal(res.error, "model exploded");
  });

  it("minimal ok result: bare success is valid", () => {
    const res = { ok: true } as AgentRunResult;
    assert.equal(res.ok, true);
    assert.equal(res.output, undefined);
    assert.equal(res.capabilities, undefined);
  });
});
