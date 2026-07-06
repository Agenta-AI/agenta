import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { messageTranscript } from "../../src/engines/sandbox_agent/transcript.ts";
import type { ContentBlock } from "../../src/protocol.ts";

function toolApprovalContent(approved: boolean): ContentBlock[] {
  return [
    {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "mcp__agenta-tools__commit_revision",
      input: { name: "draft", parameters: { temperature: 0.2 } },
    },
    {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "mcp__agenta-tools__commit_revision",
      output: { approved },
    },
  ];
}

describe("messageTranscript", () => {
  it("renders approved permission envelopes as pending execution, not tool output", () => {
    const transcript = messageTranscript(toolApprovalContent(true));

    assert.match(transcript, /APPROVED mcp__agenta-tools__commit_revision/);
    assert.match(transcript, /NOT run yet/);
    assert.match(transcript, /Call the tool again with the same arguments now to execute it/);
    assert.doesNotMatch(transcript, /returned: \{"approved":true\}/);
  });

  it("renders denied permission envelopes as not executed", () => {
    const transcript = messageTranscript(toolApprovalContent(false));

    assert.match(transcript, /DENIED mcp__agenta-tools__commit_revision/);
    assert.match(transcript, /not executed/);
  });

  it("keeps unrelated tool results on the generic returned path", () => {
    const transcript = messageTranscript([
      {
        type: "tool_result",
        toolName: "mcp__agenta-tools__summarize",
        output: { summary: "3 issues found" },
      },
    ]);

    assert.match(
      transcript,
      /mcp__agenta-tools__summarize returned: \{"summary":"3 issues found"\}/,
    );
  });

  it("documents the accepted ambiguity for real tool data shaped like an approval", () => {
    // This narrow ambiguity already exists in the approval decision store.
    const transcript = messageTranscript([
      {
        type: "tool_result",
        toolName: "approval_status",
        output: { approved: true },
      },
    ]);

    assert.match(transcript, /APPROVED approval_status/);
    assert.match(transcript, /NOT run yet/);
  });
});
