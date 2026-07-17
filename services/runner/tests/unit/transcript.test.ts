import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildTurnText,
  messageTranscript,
  TOOL_RESULT_RENDER_MAX_CHARS,
} from "../../src/engines/sandbox_agent/transcript.ts";
import { TOOL_NOT_EXECUTED_PAUSED } from "../../src/tracing/otel.ts";
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
    assert.match(
      transcript,
      /Call the tool again with the same arguments now to execute it/,
    );
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

  // The parallel-approval bug: when the model fires several gated tool calls at once, the runner
  // pauses on ONE and force-settles the siblings with `TOOL_NOT_EXECUTED_PAUSED` (isError=true).
  // On the generic path that renders as `[<tool> error: …]`, which the model reads as a refusal —
  // so it abandons the call instead of re-issuing it, and the second approval never surfaces.
  it("renders a deferred (paused-sibling) result as a retry nudge, never as an error", () => {
    const transcript = messageTranscript([
      {
        type: "tool_result",
        toolCallId: "call-2",
        toolName: "Read File",
        output: TOOL_NOT_EXECUTED_PAUSED,
        isError: true,
      },
    ]);

    // The model must be told to re-issue the call, in the same "call it again now" language an
    // approved-but-unexecuted call already gets.
    assert.match(transcript, /Read File was NOT run/);
    assert.match(transcript, /skipped, not denied/);
    assert.match(
      transcript,
      /Call Read File again with the same arguments now to run it/,
    );
    // The load-bearing regression guard: the literal word the model was reading as a refusal.
    assert.doesNotMatch(transcript, /Read File error:/);
    assert.doesNotMatch(transcript, /DEFERRED_NOT_EXECUTED/);
  });
});

describe("tool result render cap", () => {
  it("caps a huge tool RESULT body with an explicit elision marker", () => {
    const big = "x".repeat(TOOL_RESULT_RENDER_MAX_CHARS + 500);
    const transcript = messageTranscript([
      { type: "tool_result", toolName: OTHER_TOOL, output: big },
    ]);

    assert.ok(transcript.length < big.length, "result body is truncated");
    assert.match(transcript, /\[\.\.\. 500 chars omitted\]/);
  });

  it("keeps a small tool RESULT body whole, no marker", () => {
    const transcript = messageTranscript([
      { type: "tool_result", toolName: OTHER_TOOL, output: { ok: true } },
    ]);

    assert.match(transcript, /returned: \{"ok":true\}/);
    assert.doesNotMatch(transcript, /chars omitted/);
  });

  it("never caps tool CALL args (approval replay needs the exact arguments)", () => {
    const bigArg = "y".repeat(TOOL_RESULT_RENDER_MAX_CHARS + 1000);
    const transcript = messageTranscript([
      { type: "tool_call", toolName: COMMIT_TOOL, input: { blob: bigArg } },
    ]);

    assert.ok(transcript.includes(bigArg), "full call args survive the replay");
    assert.doesNotMatch(transcript, /chars omitted/);
  });
});

describe("buildTurnText history window", () => {
  const saved = process.env.AGENTA_AGENT_HISTORY_MAX_CHARS;
  function restoreEnv() {
    if (saved === undefined) delete process.env.AGENTA_AGENT_HISTORY_MAX_CHARS;
    else process.env.AGENTA_AGENT_HISTORY_MAX_CHARS = saved;
  }

  it("keeps a 30k transcript whole under the 100k default window", () => {
    delete process.env.AGENTA_AGENT_HISTORY_MAX_CHARS;
    try {
      const goal = "goal: send one slack message";
      const text = turnTextFor([
        { role: "user", content: goal },
        { role: "assistant", content: "z".repeat(30_000) },
      ]);
      assert.ok(text.includes(goal), "the original goal survives the window");
    } finally {
      restoreEnv();
    }
  });

  it("tail-slices over the window and logs eviction counts", () => {
    process.env.AGENTA_AGENT_HISTORY_MAX_CHARS = "1000";
    try {
      const logs: string[] = [];
      const request: AgentRunRequest = {
        messages: [
          { role: "user", content: "old goal" },
          { role: "assistant", content: "a".repeat(2000) },
          { role: "user", content: "continue" },
        ],
      };
      const text = buildTurnText(request, (msg) => logs.push(msg));

      assert.ok(!text.includes("old goal"), "the oldest message is evicted");
      assert.equal(logs.length, 1);
      assert.match(logs[0], /^\[HITL\] cold replay: /);
      assert.match(logs[0], /evicted 1\/2 messages/);
      assert.match(logs[0], /pendingNudge=false/);
      assert.match(logs[0], /resumeFrame=none/);
      assert.match(logs[0], /turnText \d+ chars/);
    } finally {
      restoreEnv();
    }
  });

  it("logs the pending-approval nudge presence", () => {
    const logs: string[] = [];
    buildTurnText(
      {
        messages: [
          { role: "user", content: "do the thing" },
          { role: "assistant", content: toolApprovalContent(true) },
          { role: "user", content: "continue" },
        ],
      },
      (msg) => logs.push(msg),
    );

    assert.equal(logs.length, 1);
    assert.match(logs[0], /pendingNudge=true/);
  });
});

describe("buildTurnText approval-resume closing frame", () => {
  it("closes with the resume instruction when the newest content is an approved pending call", () => {
    const staleCommand =
      "search for tools and add them if needed use the skill";
    const request: AgentRunRequest = {
      messages: [
        { role: "user", content: staleCommand },
        { role: "assistant", content: toolApprovalContent(true) },
      ],
    };
    const text = buildTurnText(request);

    assert.match(text, /responded to the pending approval above/);
    assert.match(text, /execute exactly that call now/);
    assert.match(text, /do not restart the task/);
    assert.doesNotMatch(text, /The user now says/);
    // The stale command stays in the replayed history, not in the closing frame.
    const closing = text.slice(text.lastIndexOf("\n\n"));
    assert.ok(
      !closing.includes(staleCommand),
      "stale command is out of the frame",
    );
    assert.ok(
      text.includes(`user: ${staleCommand}`),
      "stale command stays in history",
    );
  });

  it("keeps the resume frame when the approval envelope rides a trailing user turn", () => {
    const request: AgentRunRequest = {
      messages: [
        { role: "user", content: "do the thing" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "call-1",
              toolName: COMMIT_TOOL,
              input: { name: "draft" },
            } as ContentBlock,
          ],
        },
        { role: "user", content: [approvalResult("call-1", true)] },
      ],
    };
    const text = buildTurnText(request);

    assert.match(text, /responded to the pending approval above/);
    assert.match(text, /NOT run yet/);
    assert.doesNotMatch(text, /The user now says/);
  });

  it("keeps the normal closing frame for a new user message, even with a pending approval", () => {
    const text = turnTextFor([
      { role: "user", content: "do the thing" },
      { role: "assistant", content: toolApprovalContent(true) },
    ]);

    assert.match(
      text,
      /Continue the conversation\. The user now says:\ncontinue/,
    );
    assert.doesNotMatch(text, /responded to the pending approval above/);
  });

  it("closes with the client-resume frame when the newest content is an elicitation answer (#5357)", () => {
    const staleCommand = "help me schedule a report";
    const request: AgentRunRequest = {
      messages: [
        { role: "user", content: staleCommand },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "call-1",
              toolName: "__ag__request_input",
              input: { message: "What color?", requestedSchema: {} },
            },
            {
              type: "tool_result",
              toolCallId: "call-1",
              toolName: "__ag__request_input",
              output: { action: "accept", content: { color: "green" } },
            },
          ] as ContentBlock[],
        },
      ],
    };
    const text = buildTurnText(request);

    // The just-submitted answer must not be re-framed as a fresh request that restarts the task.
    assert.match(text, /responded to the request/);
    assert.match(text, /do not restart the task or ask again/);
    assert.doesNotMatch(text, /The user now says/);
    assert.doesNotMatch(text, /responded to the pending approval/);
    // The answer stays visible in the replayed history and the stale command keeps its position.
    assert.match(text, /request_input returned: .*green/);
    assert.ok(text.includes(`user: ${staleCommand}`), "stale command stays in history");
  });

  it("keeps the normal closing frame when a client-tool result precedes a new user turn", () => {
    const text = turnTextFor([
      { role: "user", content: "help me schedule a report" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            toolCallId: "call-1",
            toolName: "__ag__request_input",
            input: { message: "What color?", requestedSchema: {} },
          },
          {
            type: "tool_result",
            toolCallId: "call-1",
            toolName: "__ag__request_input",
            output: { action: "accept", content: { color: "green" } },
          },
        ] as ContentBlock[],
      },
    ]);

    // A settled client tool followed by NEW user text is a normal turn, not a resume.
    assert.match(text, /Continue the conversation\. The user now says:\ncontinue/);
    assert.doesNotMatch(text, /responded to the request/);
  });

  it("keeps the normal closing frame when the approved call already executed", () => {
    const staleCommand = "do the thing";
    const request: AgentRunRequest = {
      messages: [
        { role: "user", content: staleCommand },
        { role: "assistant", content: toolApprovalContent(true) },
        { role: "tool", content: [realResult(COMMIT_TOOL)] },
      ],
    };
    const text = buildTurnText(request);

    assert.doesNotMatch(text, /responded to the pending approval above/);
    assert.match(text, /The user now says:\ndo the thing/);
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
