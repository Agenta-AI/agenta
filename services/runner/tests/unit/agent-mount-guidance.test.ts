/**
 * What the model is told about its durable folder, in both directions.
 *
 * The bug these guard against: on a Daytona run whose mounts are skipped, the model went looking
 * for the user's saved files, found nothing, and reported them missing, which reads as deletion.
 * It looked because its own conversation history contained an earlier session where the folder
 * worked. Silence in the current turn left that history unchallenged.
 *
 * Run: pnpm exec vitest run tests/unit/agent-mount-guidance.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  agentMountAppendix,
  agentMountGuidance,
  agentMountUnavailableAppendix,
  agentMountUnavailableGuidance,
} from "../../src/engines/sandbox_agent/agent-mount-guidance.ts";
import {
  appendToSystemPrompt,
  claudeSystemPromptMeta,
  composeSystemPromptAppendix,
} from "../../src/engines/sandbox_agent/system-prompt-appendix.ts";
import {
  fileCitationAppendix,
  platformGuidanceAppendix,
} from "../../src/engines/sandbox_agent/platform-guidance.ts";

const MOUNT = "/home/sandbox/agenta/mounts/proj-1/sandbox-1-agent";

describe("the guidance for a mount that WORKED", () => {
  const text = agentMountGuidance(MOUNT);

  it("names the resolved absolute path", () => {
    assert.ok(text.includes(MOUNT));
  });

  it("never names the environment variable", () => {
    // Two separate failures came from that one clause. The runner does not set the variable on
    // Daytona at all, so it expands to nothing; and the harness's file tools take a path
    // literally while its terminal expands `$VAR`, so a model that learns the name succeeds in
    // one tool and fails in the other.
    assert.doesNotMatch(text, /AGENTA_AGENT_MOUNT_DIR/);
    assert.doesNotMatch(text, /\$[A-Z_]+/);
  });

  it("still tells the model to check the folder before answering a recall", () => {
    // The whole reason the segment exists. Losing this while removing the variable would trade
    // one silent failure for another.
    assert.match(text, /list and check the durable agent folder/);
  });
});

describe("the guidance for a mount that was ATTEMPTED and SKIPPED", () => {
  const text = agentMountUnavailableGuidance();

  it("states the folder is unavailable for this turn", () => {
    assert.match(text, /not available in this sandbox for this turn/);
  });

  it("forbids the search that produced the wrong answer", () => {
    assert.match(text, /Do not search for saved files/);
  });

  it("forbids reporting the user's work as lost, which is what the user actually saw", () => {
    assert.match(text, /do not tell the user that their saved work is missing or was deleted/);
    assert.match(text, /nothing has been lost/);
  });

  it("contradicts the history explicitly, because history is why the model looked", () => {
    // The heart of the design: absence cannot correct a transcript that shows the folder working.
    assert.match(text, /If the conversation so far shows you reading or writing files there/);
  });

  it("names no path and no variable, because there is nothing to advertise", () => {
    assert.doesNotMatch(text, /AGENTA_AGENT_MOUNT_DIR/);
    assert.doesNotMatch(text, /\$[A-Z_]+/);
  });
});

describe("the delivery channels carry either statement unchanged", () => {
  it("Claude takes it through the session-init meta", () => {
    assert.deepEqual(claudeSystemPromptMeta(agentMountUnavailableGuidance()), {
      systemPrompt: { append: agentMountUnavailableGuidance() },
    });
  });

  it("Pi appends it after the author's own prompt", () => {
    assert.equal(
      appendToSystemPrompt("author text", agentMountUnavailableGuidance()),
      `author text\n\n${agentMountUnavailableGuidance()}`,
    );
  });
});

describe("file citation guidance", () => {
  it("requires a clickable full absolute path and rejects a bare basename", () => {
    const text = fileCitationAppendix().text;
    assert.match(text, /clickable Markdown link/);
    assert.match(text, /full absolute path/);
    assert.match(text, /Do not cite only a basename/);
  });

  it("is included for every harness through the rendered instructions file", () => {
    for (const acpAgent of ["pi", "claude", "codex"]) {
      const text = platformGuidanceAppendix({
        acpAgent,
        isPi: acpAgent === "pi",
        agentMountedPath: undefined,
        agentMountSkipped: false,
        toolNames: [],
      });
      assert.match(text ?? "", /full absolute path/);
    }
  });
});
