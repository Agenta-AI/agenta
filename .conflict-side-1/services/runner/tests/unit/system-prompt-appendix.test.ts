/**
 * The system-prompt appendix composer.
 *
 * The composer moved out of `agent-mount-guidance.ts` so the mount stops owning a mechanism that
 * is not about mounts. More contributors are coming (build-kit guidance, the skills-target
 * disambiguation, memory guidance), and the properties they will depend on are pinned here rather
 * than rediscovered per contributor.
 *
 * Run: pnpm exec vitest run tests/unit/system-prompt-appendix.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  appendToSystemPrompt,
  claudeSystemPromptMeta,
  composeSystemPromptAppendix,
} from "../../src/engines/sandbox_agent/system-prompt-appendix.ts";
import {
  agentMountAppendix,
  agentMountGuidance,
  agentMountUnavailableAppendix,
} from "../../src/engines/sandbox_agent/agent-mount-guidance.ts";

const a = { id: "a", text: "first paragraph" };
const b = { id: "b", text: "second paragraph" };

describe("composeSystemPromptAppendix", () => {
  it("keeps the caller's order, because order is a decision", () => {
    // A contributor that qualifies another must be placeable relative to it. If composition
    // reordered or sorted, that placement would be impossible to express.
    assert.equal(
      composeSystemPromptAppendix([a, b]),
      "first paragraph\n\nsecond paragraph",
    );
    assert.equal(
      composeSystemPromptAppendix([b, a]),
      "second paragraph\n\nfirst paragraph",
    );
  });

  it("skips a contributor that did not apply, so callers can build the list unconditionally", () => {
    assert.equal(composeSystemPromptAppendix([undefined, a, undefined]), "first paragraph");
  });

  it("skips a contributor that applied but had nothing to say", () => {
    assert.equal(
      composeSystemPromptAppendix([{ id: "empty", text: "   " }, a]),
      "first paragraph",
    );
  });

  it("returns undefined when nothing contributed, so an unused channel stays silent", () => {
    // Not the empty string: a channel handed "" would deliver an empty appendix rather than none.
    assert.equal(composeSystemPromptAppendix([]), undefined);
    assert.equal(composeSystemPromptAppendix([undefined]), undefined);
    assert.equal(composeSystemPromptAppendix([{ id: "x", text: "" }]), undefined);
  });

  it("separates paragraphs by a blank line and trims each", () => {
    assert.equal(
      composeSystemPromptAppendix([
        { id: "a", text: "  padded  " },
        { id: "b", text: "\nalso padded\n" },
      ]),
      "padded\n\nalso padded",
    );
  });
});

describe("appendToSystemPrompt", () => {
  it("puts the author's text first and ours after it", () => {
    // Ours is guidance about the environment; it should read as an addition to what the author
    // said rather than as a preamble that frames it.
    assert.equal(appendToSystemPrompt("author", "platform"), "author\n\nplatform");
  });

  it("is the whole prompt when the author supplied none", () => {
    assert.equal(appendToSystemPrompt(undefined, "platform"), "platform");
    assert.equal(appendToSystemPrompt("", "platform"), "platform");
  });
});

describe("the mount contributor", () => {
  it("carries the same text it always did, under a stable id", () => {
    // The move must not change a word the model reads.
    assert.equal(agentMountAppendix("/mnt/agent").text, agentMountGuidance("/mnt/agent"));
    assert.equal(agentMountAppendix("/mnt/agent").id, "agent-mount");
    assert.equal(agentMountUnavailableAppendix().id, "agent-mount-unavailable");
  });

  it("composes into Claude's delivery shape unchanged", () => {
    const appendix = composeSystemPromptAppendix([agentMountAppendix("/mnt/agent")]);
    assert.ok(appendix);
    assert.deepEqual(claudeSystemPromptMeta(appendix), {
      systemPrompt: { append: appendix },
    });
  });

  it("composes to exactly the single paragraph when it is the only contributor", () => {
    // Today's production shape. A lone contributor must not gain separators or padding from the
    // composer, or the move would have changed the prompt after all.
    assert.equal(
      composeSystemPromptAppendix([agentMountAppendix("/mnt/agent")]),
      agentMountGuidance("/mnt/agent"),
    );
  });
});
