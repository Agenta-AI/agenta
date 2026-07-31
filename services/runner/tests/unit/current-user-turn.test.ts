import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  currentUserTurn,
  type AgentRunRequest,
  type ContentBlock,
} from "../../src/protocol.ts";

function attachmentBlock(
  attachmentId: string,
  filename = "photo.png",
): ContentBlock {
  return {
    type: "attachment",
    attachmentId,
    filename,
    mimeType: "image/png",
    size: 123,
  } as unknown as ContentBlock;
}

describe("currentUserTurn", () => {
  it("reads an attachment-only tail without reusing earlier text", () => {
    const turn = currentUserTurn({
      messages: [
        { role: "user", content: "earlier text" },
        {
          role: "user",
          content: [attachmentBlock("019a52c2-14c0-7c14-b874-2f5798f9cd21")],
        },
      ],
    });

    assert.equal(turn.text, "");
    assert.deepEqual(turn.attachments, [
      {
        attachmentId: "019a52c2-14c0-7c14-b874-2f5798f9cd21",
        filename: "photo.png",
        mediaType: "image/png",
        size: 123,
      },
    ]);
    assert.equal(turn.isFresh, true);
    assert.equal(turn.carriesToolEnvelope, false);
    assert.equal(turn.hasInlineMedia, false);
  });

  it("recognizes both legacy inline image shapes as media", () => {
    for (const block of [
      { type: "image", uri: "data:image/png;base64,AQID" },
      { type: "image", data: "AQID", mimeType: "image/webp" },
    ]) {
      const turn = currentUserTurn({
        messages: [{ role: "user", content: [block] }],
      } as AgentRunRequest);

      assert.equal(turn.text, "");
      assert.deepEqual(turn.attachments, []);
      assert.equal(turn.hasInlineMedia, true);
      assert.equal(turn.isFresh, true);
    }
  });

  it("marks an approval-resume tail as a tool envelope, not a fresh turn", () => {
    const turn = currentUserTurn({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: "call-1",
              output: { approved: true },
            },
          ],
        },
      ],
    });

    assert.equal(turn.text, "");
    assert.equal(turn.isFresh, false);
    assert.equal(turn.carriesToolEnvelope, true);
  });

  it("marks a text tail carrying a tool envelope as not fresh", () => {
    const turn = currentUserTurn({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "continue" },
            { type: "tool_call", toolCallId: "call-1" },
          ],
        },
      ],
    });

    assert.equal(turn.text, "continue");
    assert.equal(turn.isFresh, false);
    assert.equal(turn.carriesToolEnvelope, true);
  });

  it("returns an empty non-fresh turn for an empty conversation", () => {
    assert.deepEqual(currentUserTurn({} as AgentRunRequest), {
      message: null,
      text: "",
      attachments: [],
      isFresh: false,
      hasInlineMedia: false,
      carriesToolEnvelope: false,
    });
  });
});
