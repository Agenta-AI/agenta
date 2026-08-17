/**
 * What a completed tool call reports as its output, per harness wire shape.
 *
 * Claude and Pi close a tool call with an ACP `content` array. codex-acp does not: it closes with
 * a plain OBJECT `rawOutput` whose shape depends on the tool. The reader only understood content
 * arrays, so every codex tool result stored and streamed EMPTY — successes and errors alike — and
 * nothing caught it because this path had no test.
 *
 * The rawOutput fixtures below are the shapes `@agentclientprotocol/codex-acp` 1.1.7 actually
 * builds (`dist/index.js`: `createMcpRawOutput`, `completeCommandExecutionEvent`, and the unified
 * exec function-call path). Keep them faithful to the bundle — a fixture invented here proves
 * nothing about the bridge.
 *
 * Run: pnpm exec vitest run tests/unit/otel-tool-output-text.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import type { AgentEvent } from "../../src/protocol.ts";

/** Drive one tool call to completion and return the `tool_result` it records. */
function resultOf(
  update: Record<string, unknown>,
  harness = "codex",
): { output: string; isError: boolean } {
  const run = createSandboxAgentOtel({
    harness,
    model: "openai-codex/gpt-5.5",
  });
  run.start({ prompt: "run it" });
  run.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "call_1",
    title: "shell",
    rawInput: { command: ["bash", "-lc", "ls"] },
  });
  run.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "call_1",
    status: "completed",
    ...update,
  });
  run.finish();
  const result = run
    .events()
    .find((event) => event.type === "tool_result") as Extract<
    AgentEvent,
    { type: "tool_result" }
  >;
  assert.ok(result, "the completing update must record a tool_result");
  return { output: result.output ?? "", isError: result.isError === true };
}

describe("codex tool results (object rawOutput)", () => {
  it("reports a shell command's output, not an empty string", () => {
    const result = resultOf({
      rawOutput: {
        formatted_output: "AGENTS.md\nREADME.md\n",
        exit_code: 0,
      },
    });
    assert.equal(result.output, "AGENTS.md\nREADME.md\n");
    assert.equal(result.isError, false);
  });

  it("reports the text blocks of a successful MCP call", () => {
    const result = resultOf({
      rawOutput: {
        result: {
          content: [{ type: "text", text: "variant deployed" }],
          isError: false,
        },
        error: null,
      },
    });
    assert.equal(result.output, "variant deployed");
  });

  it("reports a failed MCP call's error message, so the failure is diagnosable", () => {
    const result = resultOf({
      status: "failed",
      rawOutput: {
        result: null,
        error: "MCP server 'agenta' returned: unauthorized (401)",
      },
    });
    assert.equal(result.isError, true);
    assert.match(result.output, /unauthorized \(401\)/);
  });

  it("reports the output of the unified exec path, which sends `{output}`", () => {
    const result = resultOf({
      rawOutput: { output: "hello from the sandbox" },
    });
    assert.equal(result.output, "hello from the sandbox");
  });

  it("keeps the exit code when a command succeeded with no output", () => {
    // Falling through an empty `formatted_output` to the whole object is what keeps a silent
    // command from looking identical to the bug this test pins.
    const result = resultOf({
      rawOutput: { formatted_output: "", exit_code: 0 },
    });
    assert.notEqual(result.output, "");
    assert.match(result.output, /exit_code/);
  });

  it("serializes an object with no known key rather than dropping it", () => {
    const result = resultOf({
      rawOutput: { status: "ok", saved_path: "/w/a.png" },
    });
    assert.notEqual(result.output, "");
    assert.deepEqual(JSON.parse(result.output), {
      status: "ok",
      saved_path: "/w/a.png",
    });
  });
});

describe("the harnesses that already worked stay unchanged", () => {
  it("reads a Claude/Pi content array", () => {
    const result = resultOf(
      { content: [{ content: { type: "text", text: "sunny" } }] },
      "claude",
    );
    assert.equal(result.output, "sunny");
  });

  it("prefers the content array over rawOutput when both are present", () => {
    const result = resultOf(
      {
        content: [{ content: { type: "text", text: "from content" } }],
        rawOutput: { formatted_output: "from rawOutput" },
      },
      "claude",
    );
    assert.equal(result.output, "from content");
  });

  it("reads a plain string rawOutput", () => {
    const result = resultOf({ rawOutput: "plain text output" }, "pi");
    assert.equal(result.output, "plain text output");
  });

  it("records an empty output when the update carries no output at all", () => {
    // Not every close carries a payload (codex-acp closes a fileChange with status only).
    // The fallback must not invent text for an absent rawOutput.
    const result = resultOf({});
    assert.equal(result.output, "");
  });
});
