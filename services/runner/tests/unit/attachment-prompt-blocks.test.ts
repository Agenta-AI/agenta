import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  attachmentWorkingPath,
  buildPromptBlocks,
  collectLegacyInlineImages,
  type ResolvedAttachment,
} from "../../src/engines/sandbox_agent/attachments.ts";
import { COLD_FRAME_USER_LABEL } from "../../src/engines/sandbox_agent/transcript.ts";
import type { ChatMessage } from "../../src/protocol.ts";

const ATTACHMENT_ID = "019a52c2-14c0-7c14-b874-2f5798f9cd21";

function resolved(
  outcome: "native" | "workspace_only" | "failed",
): ResolvedAttachment {
  const ref = {
    attachmentId: ATTACHMENT_ID,
    filename: "photo.png",
    mediaType: "image/png",
    size: 3,
  };
  return {
    ref,
    bytes: new Uint8Array([1, 2, 3]),
    path: attachmentWorkingPath("/cwd", ref),
    gate: {
      outcome,
      reasonCode:
        outcome === "native"
          ? "native_supported"
          : outcome === "failed"
            ? "fetch_failed"
          : "model_modality_unknown",
      kind: "image",
    },
  };
}

describe("attachment prompt blocks", () => {
  it("puts native images first and emits exactly one mention-plus-text block", () => {
    const blocks = buildPromptBlocks("describe this", [resolved("native")]);
    assert.deepEqual(blocks, [
      {
        type: "image",
        data: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "image/png",
      },
      {
        type: "text",
        text:
          "[attached file: photo.png at attachments/" +
          ATTACHMENT_ID +
          "/photo.png]\ndescribe this",
      },
    ]);
  });

  it("keeps an attachment-only turn non-empty through its mention", () => {
    const blocks = buildPromptBlocks("", [resolved("native")]);
    assert.equal(blocks.length, 2);
    assert.match(blocks[1].type === "text" ? blocks[1].text : "", /attached file/);
  });

  it("sends a legacy image-only prompt without an empty text block", () => {
    assert.deepEqual(
      buildPromptBlocks("", [], [{ data: "AQID", mimeType: "image/png" }]),
      [{ type: "image", data: "AQID", mimeType: "image/png" }],
    );
  });

  it("places mentions in the latest-user section of a cold replay frame", () => {
    const turnText =
      "Conversation so far:\nassistant: ready\n\n" +
      COLD_FRAME_USER_LABEL +
      "describe this";
    const blocks = buildPromptBlocks(
      turnText,
      [resolved("workspace_only")],
      [],
      "describe this",
    );
    const text = blocks[0].type === "text" ? blocks[0].text : "";

    assert.equal(
      text,
      "Conversation so far:\nassistant: ready\n\n" +
        COLD_FRAME_USER_LABEL +
        "[attached file: photo.png at attachments/" +
        ATTACHMENT_ID +
        "/photo.png]\ndescribe this",
    );
  });

  it("puts attachment-only mentions after the cold frame's closing label", () => {
    const turnText =
      "Conversation so far:\nassistant: ready\n\n" + COLD_FRAME_USER_LABEL;
    const blocks = buildPromptBlocks(
      turnText,
      [resolved("workspace_only")],
      [],
      "",
    );
    const text = blocks[0].type === "text" ? blocks[0].text : "";

    assert.match(text, /The user now says:\n\[attached file:/);
    assert.ok(text.startsWith("Conversation so far:"));
  });

  it("renders a failed attachment as unavailable", () => {
    const blocks = buildPromptBlocks("continue", [resolved("failed")]);
    assert.equal(
      blocks[0].type === "text" ? blocks[0].text : "",
      "[attached file: photo.png - no longer available]\ncontinue",
    );
  });

  it("omits a workspace-only native block but keeps the mention and turn", () => {
    const blocks = buildPromptBlocks("inspect it", [
      resolved("workspace_only"),
    ]);
    assert.deepEqual(
      blocks.map((block) => block.type),
      ["text"],
    );
    assert.match(blocks[0].type === "text" ? blocks[0].text : "", /inspect it/);
  });

  it("reads the real uri data URL before the historical data fallback", () => {
    const message = {
      role: "user",
      content: [
        {
          type: "image",
          uri: "data:image/png;base64,dXJp",
          data: "ZmFsbGJhY2s=",
          mimeType: "image/jpeg",
        },
        {
          type: "image",
          data: "aGlzdG9yaWNhbA==",
          mimeType: "image/webp",
        },
      ],
    } as ChatMessage;
    assert.deepEqual(collectLegacyInlineImages(message), [
      { data: "dXJp", mimeType: "image/png" },
      { data: "aGlzdG9yaWNhbA==", mimeType: "image/webp" },
    ]);
  });
});
