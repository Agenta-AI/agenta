/**
 * Unit tests for pi-acp startup-banner stripping.
 *
 * pi-acp emits its startup banner as the FIRST agent message chunk, ahead of the real answer
 * (a "pi vX.Y.Z" / "## Context" / AGENTS.md path list / "New version available" prelude). The
 * playground renders the markdown, so the user sees a bare "Context" heading and an unprefixed
 * absolute path. These tests pin both the coalesced stripper (`stripStartupBanner`, used by the
 * one-shot `finish()` path) and the streaming-safe splitter (`splitLeadingBanner`, used to hold
 * leading deltas until the banner region resolves), plus an end-to-end streaming assertion
 * through `createSandboxAgentOtel`.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/startup-banner.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  createSandboxAgentOtel,
  isBannerLine,
  splitLeadingBanner,
  stripStartupBanner,
} from "../../src/tracing/otel.ts";
import type { AgentEvent } from "../../src/protocol.ts";

// The exact banner the user saw, in its RAW (pre-render) markdown form: pi-acp's buildStartupInfo
// output followed by buildUpdateNotice. The playground strips "## " and "- " when rendering, so
// the user-visible text is the same minus those markers.
const RAW_BANNER = [
  "pi v0.79.4",
  "---",
  "",
  "## Context",
  "- /tmp/agenta-sandbox-agent-UxwfPW/AGENTS.md",
  "",
  "## Extensions",
  "- /home/agent/.pi/agent/extensions/agenta.js",
  "",
  "---",
  "New version available: v0.80.2 (installed v0.79.4). Run: `npm i -g @earendil-works/pi-coding-agent`",
].join("\n");
// ^ verbatim from a live `pi-acp@0.0.29` session/new (`_meta.piAcp.startupInfo`) on this stack:
//   "pi v0.79.4\n---\n\n## Context\n- /tmp/.../AGENTS.md\n\n---\nNew version available: v0.80.2 ...".

// The same banner as the user reported it (already markdown-rendered): bare "Context", unprefixed
// AGENTS.md path, no fenced npm command.
const RENDERED_BANNER = [
  "pi v0.79.4",
  "Context",
  "/tmp/agenta-sandbox-UxwfPW/AGENTS.md",
  "Extensions",
  "/home/agent/.pi/agent/extensions/agenta.js",
  "New version available: v0.80.2 (installed v0.79.4).",
  "Run: npm i -g @earendil-works/pi-coding-agent",
].join("\n");

describe("isBannerLine", () => {
  it("matches every banner-line variant the user saw", () => {
    for (const line of [
      "pi v0.79.4",
      "pi v0.80.2 (something)",
      "---",
      "",
      "   ",
      "## Context",
      "Context",
      "## Skills",
      "Skills",
      "## Extensions",
      "Extensions",
      "- /tmp/agenta-sandbox-agent-UxwfPW/AGENTS.md",
      "/tmp/agenta-sandbox-UxwfPW/AGENTS.md",
      "- /pi-agent/skills/foo.md",
      "- /home/agent/.pi/agent/extensions/agenta.js",
      "/home/agent/.pi/agent/extensions/agenta.js",
      "New version available: v0.80.2 (installed v0.79.4). Run: `npm i -g @earendil-works/pi-coding-agent`",
      "New version available: v0.80.2 (installed v0.79.4).",
      "Run: `npm i -g @earendil-works/pi-coding-agent`",
      "Run: npm i -g @earendil-works/pi-coding-agent",
    ]) {
      assert.equal(isBannerLine(line), true, `expected banner: ${JSON.stringify(line)}`);
    }
  });

  it("does not match genuine answer lines", () => {
    for (const line of [
      "4",
      "The answer is 4.",
      "Here is the context you asked for:",
      "I will run: npm test", // not "npm i -g"
      "Contextual information follows", // not a bare heading
      "See /etc/hosts for details", // not a .md path
    ]) {
      assert.equal(isBannerLine(line), false, `expected non-banner: ${JSON.stringify(line)}`);
    }
  });
});

describe("stripStartupBanner (coalesced / finish path)", () => {
  it("strips the raw markdown banner the user saw", () => {
    assert.equal(stripStartupBanner(RAW_BANNER + "\n4"), "4");
  });

  it("strips the rendered banner the user saw", () => {
    assert.equal(stripStartupBanner(RENDERED_BANNER + "\nThe answer is 4."), "The answer is 4.");
  });

  it("strips a multi-line answer's banner but keeps the whole answer", () => {
    const answer = "Line one of the answer.\nLine two.\n- bullet point";
    assert.equal(stripStartupBanner(RAW_BANNER + "\n" + answer), answer);
  });

  it("leaves a clean answer untouched", () => {
    assert.equal(stripStartupBanner("4"), "4");
    assert.equal(
      stripStartupBanner("The context of this question is simple: 4."),
      "The context of this question is simple: 4.",
    );
  });

  it("returns empty when the text is only the banner", () => {
    assert.equal(stripStartupBanner(RAW_BANNER), "");
  });
});

describe("splitLeadingBanner (streaming path)", () => {
  it("holds emission while only banner-or-blank has arrived", () => {
    for (const text of ["pi v0.79.4\n", RAW_BANNER, RAW_BANNER + "\n"]) {
      const { body, settled } = splitLeadingBanner(text);
      assert.deepEqual({ body, settled }, { body: "", settled: false });
    }
  });

  it("does not judge an incomplete trailing line", () => {
    // "Run: `npm i" could become the upgrade line OR a real answer; wait for the newline.
    const { body, settled } = splitLeadingBanner("pi v0.79.4\n---\nRun: `npm i");
    assert.deepEqual({ body, settled }, { body: "", settled: false });
  });

  it("settles and returns the body once a real line completes", () => {
    // Streaming preserves the answer faithfully, including a trailing newline; only the leading
    // blank line(s) between banner and answer are dropped.
    const { body, settled, start } = splitLeadingBanner(RAW_BANNER + "\n4\n");
    assert.equal(settled, true);
    assert.equal(body, "4\n");
    // `start` points exactly at the body within the original text.
    assert.equal((RAW_BANNER + "\n4\n").slice(start, start + body.length), body);
  });

  it("holds the first real line until its newline arrives (boundary safety)", () => {
    // At the banner boundary a still-arriving partial line ("4", no newline) could complete into
    // either a banner line or the answer, so we hold and let the finish path strip it instead.
    const { settled } = splitLeadingBanner(RAW_BANNER + "\n4");
    assert.equal(settled, false);
  });

  it("settles immediately for a banner-free stream", () => {
    const { body, settled, start } = splitLeadingBanner("4");
    assert.deepEqual({ body, settled, start }, { body: "4", settled: true, start: 0 });
  });
});

describe("createSandboxAgentOtel streaming suppresses the banner", () => {
  const textChunk = (text: string) => ({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });

  it("never streams banner deltas, only the real answer", () => {
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai/o4-mini",
      emitSpans: false,
      emit: (e) => emitted.push(e),
    });
    run.start({ prompt: "What is 2+2?" });
    // pi streams pure deltas; the banner arrives first, then the answer, split across chunks.
    run.handleUpdate(textChunk("pi v0.79.4\n---\n\n## Context\n- /tmp/x/AGENTS.md\n\n"));
    run.handleUpdate(
      textChunk("New version available: v0.80.2 (installed v0.79.4). Run: `npm i -g @earendil-works/pi-coding-agent`\n"),
    );
    // First real line completes with a newline -> the splitter settles and streams the body
    // INCREMENTALLY (before finish), exercising the live path, not just the finish fallback.
    run.handleUpdate(textChunk("The answer is 4.\n")); // pure delta (pi-style)
    const beforeFinish = emitted.filter((e) => e.type === "message_delta").length;
    run.handleUpdate(textChunk("Thanks!")); // pure delta (pi-style)
    run.finish();
    assert.ok(beforeFinish > 0, "body was not streamed incrementally before finish");

    const streamed = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_delta" }> => e.type === "message_delta")
      .map((e) => e.delta)
      .join("");
    assert.equal(streamed, "The answer is 4.\nThanks!");
    assert.ok(!streamed.includes("pi v0.79.4"), "banner version leaked");
    assert.ok(!streamed.includes("New version available"), "upgrade notice leaked");
    assert.ok(!streamed.includes("AGENTS.md"), "context file path leaked");
  });

  it("strips the banner on finish when the stream had no clean body line", () => {
    // A short, banner-only-then-inline answer that never produced a newline before finish.
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai/o4-mini",
      emitSpans: false,
      emit: (e) => emitted.push(e),
    });
    run.start({ prompt: "hi" });
    // The whole banner plus the answer arrive in ONE chunk with no trailing newline. The
    // streaming splitter holds (last line partial), so finish() must do the stripping.
    run.handleUpdate(textChunk(RAW_BANNER + "\n4"));
    run.finish();

    const streamed = emitted
      .filter((e): e is Extract<AgentEvent, { type: "message_delta" }> => e.type === "message_delta")
      .map((e) => e.delta)
      .join("");
    assert.equal(streamed, "4");
  });
});
