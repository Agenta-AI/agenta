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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  appendPlatformGuidance,
  appendToSystemPrompt,
  claudeSystemPromptMeta,
  composeSystemPromptAppendix,
  platformGuidanceBlock,
  PLATFORM_GUIDANCE_END,
  PLATFORM_GUIDANCE_START,
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

describe("the platform-guidance fence", () => {
  /** The engine module that strips this block out of every committed configuration value. */
  const CHANGE_SET_PY = fileURLToPath(
    new URL(
      "../../../../api/oss/src/core/workflows/change_set.py",
      import.meta.url,
    ),
  );

  it("agrees with the engine's literals, read from change_set.py", () => {
    // A CROSS-LANGUAGE CONTRACT, PINNED AGAINST THE OTHER SIDE RATHER THAN AGAINST ITSELF. The
    // runner renders the fence and the engine strips it; a constant pinned to a copy of itself
    // would pass while the two drifted apart, and the symptom would be a user's configuration
    // quietly accumulating our guidance text on every commit.
    let source: string;
    try {
      source = readFileSync(CHANGE_SET_PY, "utf-8");
    } catch {
      throw new Error(
        `cannot read the engine counterpart at ${CHANGE_SET_PY}. The fence literals are a ` +
          "contract with change_set.py; if that file moved, update this test rather than " +
          "deleting it.",
      );
    }
    assert.ok(
      source.includes(`PLATFORM_GUIDANCE_START = "${PLATFORM_GUIDANCE_START}"`),
      `change_set.py does not define PLATFORM_GUIDANCE_START as ${PLATFORM_GUIDANCE_START}`,
    );
    assert.ok(
      source.includes(`PLATFORM_GUIDANCE_END = "${PLATFORM_GUIDANCE_END}"`),
      `change_set.py does not define PLATFORM_GUIDANCE_END as ${PLATFORM_GUIDANCE_END}`,
    );
  });

  it("is an HTML comment, so it renders as nothing in a markdown file", () => {
    // The file is the author's, and they may open it. A visible marker would be our text showing
    // up in their instructions; a comment is inert everywhere markdown is rendered.
    for (const fence of [PLATFORM_GUIDANCE_START, PLATFORM_GUIDANCE_END]) {
      assert.ok(fence.startsWith("<!--") && fence.endsWith("-->"), fence);
    }
  });

  it("wraps the appendix with the opener and closer on their own lines", () => {
    assert.equal(
      platformGuidanceBlock("guidance"),
      `${PLATFORM_GUIDANCE_START}\nguidance\n${PLATFORM_GUIDANCE_END}`,
    );
  });
});

describe("appendPlatformGuidance", () => {
  it("uses exactly one blank line and no trailing newline", () => {
    // THE SPACING IS THE ROUND-TRIP PROPERTY, not a style choice. The engine's strip collapses the
    // junction the block leaves to one blank line and rstrips the result, so a model that reads
    // the rendered file and commits it back yields exactly the stored value with THIS spacing and
    // a whitespace-only diff with any other. The cost of getting it wrong is a pointless revision
    // on every such commit, which is noise in the user's history.
    const rendered = appendPlatformGuidance("author text", "guidance");
    assert.equal(
      rendered,
      `author text\n\n${PLATFORM_GUIDANCE_START}\nguidance\n${PLATFORM_GUIDANCE_END}`,
    );
    assert.ok(!rendered?.endsWith("\n"), "a trailing newline would survive as a diff");
  });

  it("round-trips: stripping the block back out returns the author's text exactly", () => {
    // The engine owns the real strip (`change_set.py`). This asserts the property the strip is
    // written against, on the exact bytes we produce: everything from the opener to the closer
    // removed, the junction collapsed, the tail trimmed.
    //
    // The property was also checked against the REAL `strip_platform_guidance`, not only against
    // this reimplementation of it: rendering these bytes and passing them through the Python
    // function returns the author's text exactly, and is idempotent. That check cannot live in a
    // vitest file, so it is recorded here. The fence test above is what keeps the two ends
    // aligned well enough for this local version to stay meaningful.
    const author = "Be terse.\n\nUse the bash tool when asked.";
    const rendered = appendPlatformGuidance(author, "guidance\n\nmore guidance");
    assert.ok(rendered);
    const start = rendered.indexOf(PLATFORM_GUIDANCE_START);
    const end = rendered.indexOf(PLATFORM_GUIDANCE_END) + PLATFORM_GUIDANCE_END.length;
    const stripped = (
      rendered.slice(0, start).replace(/\s+$/, "") +
      rendered.slice(end).replace(/^\s+/, "")
    ).replace(/\s+$/, "");
    assert.equal(stripped, author);
  });

  it("is the whole file when the author wrote no instructions", () => {
    // A run with an empty configuration still needs to be told how its environment works, and an
    // agent with no instructions is exactly the one most likely to guess wrong about its skills.
    assert.equal(
      appendPlatformGuidance(undefined, "guidance"),
      platformGuidanceBlock("guidance"),
    );
    assert.equal(
      appendPlatformGuidance("", "guidance"),
      platformGuidanceBlock("guidance"),
    );
  });

  it("leaves the instructions untouched when there is no guidance", () => {
    // Including the undefined case: a harness with nothing to say must not gain an empty fence,
    // which the engine would strip to nothing while the file carried two mystery comments.
    assert.equal(appendPlatformGuidance("author text", undefined), "author text");
    assert.equal(appendPlatformGuidance(undefined, undefined), undefined);
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
