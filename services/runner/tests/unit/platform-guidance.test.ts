/**
 * Platform guidance delivered through the author's instructions file.
 *
 * The channel exists for Codex, which has no system-prompt channel at all, and it is read by every
 * harness. So the property that matters most here is NEGATIVE: Pi and Claude must not receive the
 * mount paragraph twice, once through their own channel and once through the file.
 *
 * Run: pnpm exec vitest run tests/unit/platform-guidance.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  platformGuidanceAppendix,
  skillLocationAppendix,
  type PlatformGuidanceInput,
} from "../../src/engines/sandbox_agent/platform-guidance.ts";
import {
  agentMountGuidance,
  agentMountUnavailableGuidance,
} from "../../src/engines/sandbox_agent/agent-mount-guidance.ts";

const MOUNT = "/mnt/agent-files";

const run = (
  overrides: Partial<PlatformGuidanceInput> = {},
): PlatformGuidanceInput => ({
  acpAgent: "codex",
  isPi: false,
  agentMountedPath: undefined,
  agentMountSkipped: false,
  // A config-editing agent by default, since that is what the skill sentence addresses. The
  // gate's other arm is exercised explicitly below.
  toolNames: ["commit_revision"],
  ...overrides,
});

describe("what every harness is told", () => {
  it("always carries the skill-location sentence", () => {
    // The one contributor with no harness condition. It is the fix for an observed failure: an
    // agent copied a skill file into the harness's own skills folder and reported success, so the
    // skill was never saved and the next session could not find it.
    for (const input of [
      run({ acpAgent: "codex" }),
      run({ acpAgent: "claude" }),
      run({ acpAgent: "pi", isPi: true }),
    ]) {
      const guidance = platformGuidanceAppendix(input);
      assert.ok(guidance?.includes("parameters.agent.skills"), input.acpAgent);
      assert.ok(guidance?.includes("commit_revision"), input.acpAgent);
    }
  });

  it("names the configuration path and denies the working-directory copy", () => {
    // Both halves are load-bearing. Naming the real place without denying the wrong one leaves the
    // model with two plausible targets, which is the state it was already in when it failed.
    const text = skillLocationAppendix().text;
    assert.ok(text.includes("`parameters.agent.skills`"));
    assert.match(text, /does NOT add a skill/);
    assert.equal(skillLocationAppendix().id, "skill-location");
  });

  it("opens with the skill sentence, not with the mount paragraph", () => {
    // Order is a decision. The skill sentence is short and tells the model what to DO; the mount
    // paragraph is long and describes where things go. A reader who stops early must have read the
    // one that changes an action.
    const guidance = platformGuidanceAppendix(
      run({ agentMountedPath: MOUNT }),
    );
    assert.ok(guidance?.startsWith(skillLocationAppendix().text));
  });
});

describe("the mount paragraph is delivered exactly once", () => {
  it("reaches Codex here, because Codex has no other channel", () => {
    // The whole reason this channel was built. Pi has its append prompt and Claude has the ACP
    // session `_meta`; Codex had neither, so before this it received no platform guidance at all.
    const guidance = platformGuidanceAppendix(
      run({ acpAgent: "codex", agentMountedPath: MOUNT }),
    );
    assert.ok(guidance?.includes(agentMountGuidance(MOUNT)));
  });

  it("does NOT reach Pi or Claude here, which already receive it", () => {
    // The negative property this file exists for. Pi takes the paragraph through
    // `mount-lifecycle.ts` and Claude through the session `_meta` built in `environment.ts`. A
    // second copy in the instructions file would spend context twice and invite the model to look
    // for a difference between two paragraphs that have none.
    for (const input of [
      run({ acpAgent: "pi", isPi: true, agentMountedPath: MOUNT }),
      run({ acpAgent: "claude", agentMountedPath: MOUNT }),
    ]) {
      const guidance = platformGuidanceAppendix(input);
      assert.ok(guidance, input.acpAgent);
      assert.ok(
        !guidance.includes(agentMountGuidance(MOUNT)),
        `${input.acpAgent} must not be told about the mount twice`,
      );
      assert.ok(
        !guidance.includes(MOUNT),
        `${input.acpAgent} must not carry the mount path at all`,
      );
    }
  });

  it("tells Codex when a durable folder was attempted and refused", () => {
    // The three-state arm, matching Claude's. Silence here is not neutral: the conversation's
    // history may show an earlier session that read files from the folder, and only a statement in
    // this turn can stop the model reporting the user's saved work as lost.
    const guidance = platformGuidanceAppendix(
      run({ agentMountSkipped: true }),
    );
    assert.ok(guidance?.includes(agentMountUnavailableGuidance()));
  });

  it("says nothing about durable storage when none was configured", () => {
    // The third state. A stack with no durable storage at all would otherwise carry the "not
    // available" caveat in every prompt forever, which is how a real warning becomes noise.
    const guidance = platformGuidanceAppendix(run());
    assert.equal(guidance, skillLocationAppendix().text);
  });

  it("prefers the live path over the skipped sentence when both are set", () => {
    // A mount that came up after a refusal is live. Reporting both would contradict itself.
    const guidance = platformGuidanceAppendix(
      run({ agentMountedPath: MOUNT, agentMountSkipped: true }),
    );
    assert.ok(guidance?.includes(agentMountGuidance(MOUNT)));
    assert.ok(!guidance?.includes(agentMountUnavailableGuidance()));
  });

  it("serves an unrecognized harness rather than skipping it", () => {
    // Fails toward one extra paragraph. The cost of a duplicate is context; the cost of a miss is
    // the model telling a user their saved work is gone.
    const guidance = platformGuidanceAppendix(
      run({ acpAgent: "some-future-harness", agentMountedPath: MOUNT }),
    );
    assert.ok(guidance?.includes(agentMountGuidance(MOUNT)));
  });
});

describe("the context budget", () => {
  it("keeps the always-on part short", () => {
    // This block is in the context of every turn, for every agent, on every harness, and it draws
    // on the same attention the author's own instructions need. The number is a tripwire, not a
    // law: if a contributor genuinely needs the room, raise it deliberately and say why here.
    assert.ok(
      skillLocationAppendix().text.length < 600,
      `the always-on guidance is ${skillLocationAppendix().text.length} chars`,
    );
  });
});

describe("the skill sentence follows the TOOL, not the flag", () => {
  it("is absent for a run that does not offer commit_revision", async () => {
    // A plain agent with no config tools would otherwise read a sentence telling it to use a
    // tool it does not have. The block is guidance about this environment, so naming a
    // capability the run lacks is the confusion it exists to remove.
    const guidance = platformGuidanceAppendix(run({ toolNames: [] }));
    assert.equal(guidance, undefined, "and with nothing else to say, the block is silent");
  });

  it("is present for a run that offers it, alongside unrelated tools", async () => {
    const guidance = platformGuidanceAppendix(
      run({ toolNames: ["bash", "commit_revision", "read_config"] }),
    );
    assert.ok(guidance?.includes("parameters.agent.skills"));
  });

  it("does NOT gate the mount paragraph, which has no tool dependency", async () => {
    // The two contributors are independent. A Codex run with no config tools still needs to be
    // told where its durable folder is, and silencing that with the skill sentence would be the
    // mount bug all over again.
    const guidance = platformGuidanceAppendix(
      run({ toolNames: [], agentMountedPath: MOUNT }),
    );
    assert.ok(guidance?.includes(agentMountGuidance(MOUNT)));
    assert.ok(!guidance?.includes("parameters.agent.skills"));
  });

  it("keys on the tool name rather than on the ordered-operations flag", async () => {
    // THE AXIS IS DELIBERATE. The natural guess is the flag that gates the config-editing
    // surface, and it is the wrong one: `commit_revision` is in the default build kit
    // unconditionally and the flag changes the commit's DELTA SHAPE, not the tool's existence.
    // A flag-off agent with the build kit really can add a skill (its legacy description says to
    // send the whole list), so gating on the flag would delete correct guidance from the
    // release-default configuration. Presence also catches what a flag check cannot: a flag-ON
    // agent that simply has no config tools.
    assert.ok(platformGuidanceAppendix(run({ toolNames: ["commit_revision"] })));
    assert.equal(platformGuidanceAppendix(run({ toolNames: ["read_config"] })), undefined);
  });
});
