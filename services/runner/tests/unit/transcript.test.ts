import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildTurnText,
  messageTranscript,
} from "../../src/engines/sandbox_agent/transcript.ts";
import type { AgentRunRequest, ContentBlock } from "../../src/protocol.ts";

const COMMIT_TOOL = "mcp__agenta-tools__commit_revision";
const OTHER_TOOL = "mcp__agenta-tools__summarize";

function toolApprovalContent(approved: boolean): ContentBlock[] {
  return [
    {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: COMMIT_TOOL,
      input: { name: "draft", parameters: { temperature: 0.2 } },
    },
    {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: COMMIT_TOOL,
      output: { approved },
    },
  ];
}

function approvalResult(
  toolCallId: string,
  approved: boolean,
  toolName = COMMIT_TOOL,
): ContentBlock {
  return {
    type: "tool_result",
    toolCallId,
    toolName,
    output: { approved },
  };
}

function realResult(toolName = COMMIT_TOOL): ContentBlock {
  return {
    type: "tool_result",
    toolName,
    output: { ok: true },
  };
}

function turnTextFor(
  prior: { role: string; content: string | ContentBlock[] }[],
): string {
  const request: AgentRunRequest = {
    messages: [...prior, { role: "user", content: "continue" }],
  };
  return buildTurnText(request);
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

describe("buildTurnText approval transcript hints", () => {
  it("renders an approval envelope as executed once a later real result exists for the same tool", () => {
    const transcript = turnTextFor([
      {
        role: "assistant",
        content: [approvalResult("call-1", true)],
      },
      {
        role: "tool",
        content: [realResult(COMMIT_TOOL)],
      },
    ]);

    assert.match(
      transcript,
      /APPROVED mcp__agenta-tools__commit_revision; executed below/,
    );
    assert.doesNotMatch(transcript, /NOT run yet/);
    assert.doesNotMatch(transcript, /Call the tool again/);
  });

  it("keeps only the latest unresolved approval nudge for duplicate pending envelopes", () => {
    const transcript = turnTextFor([
      {
        role: "assistant",
        content: [
          approvalResult("call-1", true),
          approvalResult("call-2", true),
        ],
      },
    ]);

    assert.equal((transcript.match(/Call the tool again/g) ?? []).length, 1);
    assert.equal((transcript.match(/NOT run yet/g) ?? []).length, 1);
    assert.match(
      transcript,
      /approved mcp__agenta-tools__commit_revision earlier/,
    );
    assert.doesNotMatch(transcript, /executed below/);
  });

  it("does not treat a later real result for a different tool as execution", () => {
    const transcript = turnTextFor([
      {
        role: "assistant",
        content: [approvalResult("call-1", true, COMMIT_TOOL)],
      },
      {
        role: "tool",
        content: [realResult(OTHER_TOOL)],
      },
    ]);

    assert.match(transcript, /APPROVED mcp__agenta-tools__commit_revision/);
    assert.match(transcript, /NOT run yet/);
    assert.match(transcript, /Call the tool again/);
    assert.doesNotMatch(
      transcript,
      /APPROVED mcp__agenta-tools__commit_revision; executed below/,
    );
  });

  it("keeps denied envelopes denied even if a later same-tool result exists", () => {
    const transcript = turnTextFor([
      {
        role: "assistant",
        content: [approvalResult("call-1", false, COMMIT_TOOL)],
      },
      {
        role: "tool",
        content: [realResult(COMMIT_TOOL)],
      },
    ]);

    assert.match(transcript, /DENIED mcp__agenta-tools__commit_revision/);
    assert.match(transcript, /not executed/);
    assert.doesNotMatch(
      transcript,
      /DENIED mcp__agenta-tools__commit_revision; executed below/,
    );
  });
});
