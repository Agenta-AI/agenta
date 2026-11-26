import { describe, expect, it } from "vitest";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

const recordedToolNames = (frame: Record<string, unknown>): string[] => {
  const run = createSandboxAgentOtel({
    harness: "claude",
    model: "claude-fable-5",
    emitSpans: false,
  });
  run.start({ prompt: "hi" });
  run.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    ...frame,
  });
  run.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    rawInput: { file_path: "/w/notes/a.md", content: "# A" },
  });
  return run
    .events()
    .filter((event) => event.type === "tool_call")
    .map((event) => (event as unknown as { name: string }).name);
};

describe("recorded tool_call name", () => {
  it("takes Claude's tool name over the placeholder title of a Write", () => {
    expect(
      recordedToolNames({
        title: "Preparing file…",
        kind: "edit",
        _meta: { claudeCode: { toolName: "Write" } },
      }),
    ).toEqual(["Write", "Write"]);
  });

  it("falls back to the title when the harness sends no tool name", () => {
    expect(recordedToolNames({ title: "read", kind: "read" })).toEqual([
      "read",
      "read",
    ]);
  });
});
