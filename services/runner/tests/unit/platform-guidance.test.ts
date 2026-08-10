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
  codexBundledSkillsAppendix,
  instructionsSourceAppendix,
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

  it("opens with a config sentence, not with the mount paragraph", () => {
    // Order is a decision. The config sentences are short and tell the model what to DO; the mount
    // paragraph is long and describes where things go. A reader who stops early must have read the
    // one that changes an action.
    //
    // DELIBERATE EDIT: this asserted the SKILL sentence opened the block. The instructions
    // sentence now leads (see the ordering comment on `platformGuidanceAppendix`), so the property
    // worth keeping is that a config sentence comes first and the mount paragraph comes last.
    const guidance = platformGuidanceAppendix(
      run({ agentMountedPath: MOUNT }),
    );
    assert.ok(guidance?.startsWith(instructionsSourceAppendix().text));
    assert.ok(guidance?.endsWith(agentMountGuidance(MOUNT)));
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
    // Asserted as the ABSENCE of mount text rather than as equality with a fixed pair: the block's
    // composition is harness-dependent now (codex gets the bundled-skills rebuttal), and pinning
    // the exact string here would fail for a reason that has nothing to do with mounts.
    const guidance = platformGuidanceAppendix(run());
    assert.ok(guidance);
    assert.ok(!guidance.includes("durable agent folder"));
    assert.ok(!guidance.includes(agentMountUnavailableGuidance()));
    assert.ok(guidance.startsWith(instructionsSourceAppendix().text));
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
  it("keeps each always-on sentence short", () => {
    // This block is in the context of every turn, for every agent, on every harness, and it draws
    // on the same attention the author's own instructions need. The number is a tripwire, not a
    // law: if a contributor genuinely needs the room, raise it deliberately and say why here.
    for (const c of [skillLocationAppendix(), instructionsSourceAppendix()]) {
      assert.ok(c.text.length < 600, `${c.id} is ${c.text.length} chars`);
    }
  });

  it("keeps the whole always-on block within a raised, justified ceiling", () => {
    // RAISED DELIBERATELY, from one sentence to two. The instructions sentence roughly doubles the
    // always-on block, and the justification is measured rather than argued: editing the rendered
    // instructions file was the DOMINANT failure shape across all three harnesses, ahead of the
    // skill mistake this block already addresses. The budget is being spent on the biggest
    // observed failure.
    //
    // If a third sentence wants in, it needs its own numbers. The block is charged to the author's
    // attention on every turn, and "it reads well" is not a reason.
    const alwaysOn = platformGuidanceAppendix(
      run({ acpAgent: "claude", toolNames: ["commit_revision"] }),
    );
    assert.ok(alwaysOn);
    assert.ok(
      alwaysOn.length < 900,
      `the always-on block is ${alwaysOn.length} chars`,
    );
  });

  it("lets CODEX pay more, because codex alone has the problem it answers", () => {
    // A SECOND, HIGHER CEILING, RAISED DELIBERATELY AND ONLY FOR CODEX. The rebuttal sentence is
    // not general guidance: it answers codex's own bundled skill-creator and skill-installer,
    // which document installing into `.codex/skills`. Claude and pi ship no such skills and pay
    // nothing for it, which is why the budget is harness-dependent rather than uniform.
    //
    // The justification is measured: codex skill scenarios sit at 6 of 21 with 13 wrong_surface,
    // against ZERO on claude and pi. If that gap closes and the sentence stays, delete it.
    const codex = platformGuidanceAppendix(
      run({ acpAgent: "codex", toolNames: ["commit_revision"] }),
    );
    assert.ok(codex);
    assert.ok(codex.length < 1200, `the codex block is ${codex.length} chars`);
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

describe("the instructions-location sentence", () => {
  it("covers BOTH directions of the same wrong mental model", () => {
    // The revision that matters. The first draft covered writing only, and the read direction is
    // the same confusion inverted: models re-read the rendered file and report a stale value while
    // honestly stating they checked (9 of 9 trials, all three harnesses). One sentence names the
    // file as a copy once and closes both directions.
    const text = instructionsSourceAppendix().text;
    assert.ok(text.includes("`parameters.agent.instructions.agents_md`"));
    assert.match(text, /is a copy of your configuration/, "names it a copy");
    assert.match(text, /does NOT change your instructions/, "closes the WRITE direction");
    assert.match(text, /may not appear here/, "closes the READ direction");
    assert.equal(instructionsSourceAppendix().id, "instructions-source");
  });

  it("ends on the positive instruction, naming both tools", () => {
    // A model told only what not to do invents what to do instead. Both tools are named because
    // the two directions need different ones: read_config to look, commit_revision to change.
    const text = instructionsSourceAppendix().text;
    assert.ok(text.includes("read_config"));
    assert.ok(text.includes("commit_revision"));
    assert.ok(
      text.indexOf("read_config") > text.indexOf("out of date"),
      "the instruction comes after the warning it answers",
    );
  });

  it("hedges the staleness claim, because a re-render really can happen", () => {
    // ACCURACY IN THE ALWAYS-ON BLOCK. The proposal said re-reading "will not" show a change made
    // since the run started. That overstates it: when a request carries changed instructions the
    // file IS re-rendered (matrix_l5 proves it live), so the honest word is "may not". The
    // actionable half, use read_config, is true either way.
    assert.doesNotMatch(instructionsSourceAppendix().text, /will not show/);
  });

  it("is self-referential, so it is accurate on every harness", () => {
    // It says "This file" rather than naming CLAUDE.md or AGENTS.md, because the block is rendered
    // INSIDE the file it describes. A per-harness path would be one more thing to keep in sync and
    // one more thing to get wrong.
    assert.match(instructionsSourceAppendix().text, /^This file is a copy of your configuration/);
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      assert.ok(!instructionsSourceAppendix().text.includes(name));
    }
  });

  it("comes FIRST, ahead of the skill sentence", () => {
    // The ordering decision, pinned so it cannot drift silently: by measured failure rate the
    // instructions mistake dominates, and the sentence describes the document being read, so it
    // belongs at the top of that document. Swapping this is a deliberate experiment, not a tidy-up.
    const guidance = platformGuidanceAppendix(run({ toolNames: ["commit_revision"] }));
    assert.ok(guidance);
    const iAt = guidance.indexOf(instructionsSourceAppendix().text);
    const sAt = guidance.indexOf(skillLocationAppendix().text);
    assert.ok(iAt >= 0 && sAt >= 0, "both sentences are present");
    assert.ok(iAt < sAt, "instructions must precede skills");
  });

  it("rides the SAME tool gate as the skill sentence, in both arms", () => {
    // One gate for both, so they can never disagree about whether this run can commit.
    const withTool = platformGuidanceAppendix(run({ toolNames: ["commit_revision"] }));
    assert.ok(withTool?.includes("agents_md"));
    assert.ok(withTool?.includes("parameters.agent.skills"));

    const withoutTool = platformGuidanceAppendix(run({ toolNames: ["bash"] }));
    assert.equal(withoutTool, undefined, "neither sentence applies without the tool");
  });

  it("still yields the mount paragraph alone when there is no config tool", () => {
    // The independence check, restated for the new sentence: gating the config pair must not
    // silence the mount paragraph, which has no tool dependency.
    const guidance = platformGuidanceAppendix(
      run({ toolNames: [], agentMountedPath: MOUNT }),
    );
    assert.ok(guidance?.includes(agentMountGuidance(MOUNT)));
    assert.ok(!guidance?.includes("agents_md"));
  });
});

describe("the codex bundled-skills rebuttal", () => {
  it("reaches codex and NOBODY else", () => {
    // The other harnesses do not ship skill-creator or skill-installer, so the sentence would be
    // an instruction about tools that do not exist. Naming absent tools is the same confusion this
    // block exists to remove.
    const codex = platformGuidanceAppendix(
      run({ acpAgent: "codex", toolNames: ["commit_revision"] }),
    );
    assert.ok(codex?.includes("skill-installer"));

    for (const other of [
      run({ acpAgent: "claude", toolNames: ["commit_revision"] }),
      run({ acpAgent: "pi", isPi: true, toolNames: ["commit_revision"] }),
    ]) {
      const g = platformGuidanceAppendix(other);
      assert.ok(g, other.acpAgent);
      assert.ok(!g.includes("skill-installer"), `${other.acpAgent} must not see it`);
    }
  });

  it("names both skills and the folder they install into", () => {
    // It has to name them. The failure is that models follow those two by name, so guidance that
    // gestured at "other tools" would not connect to what they are actually reading.
    const text = codexBundledSkillsAppendix().text;
    assert.ok(text.includes("skill-creator"));
    assert.ok(text.includes("skill-installer"));
    assert.ok(text.includes(".codex/skills"));
    assert.equal(codexBundledSkillsAppendix().id, "codex-bundled-skills");
  });

  it("rides the config-tool gate too, so a codex run without commit_revision stays silent", () => {
    const guidance = platformGuidanceAppendix(
      run({ acpAgent: "codex", toolNames: ["bash"] }),
    );
    assert.ok(!guidance?.includes("skill-installer"));
  });

  it("sits immediately after the skill sentence it defends", () => {
    // Placement is the argument: it is a rebuttal to a specific tool, not standalone guidance, so
    // it reads as an exception to the sentence above it rather than as a new topic.
    const g = platformGuidanceAppendix(
      run({ acpAgent: "codex", toolNames: ["commit_revision"] }),
    );
    assert.ok(g);
    assert.ok(
      g.indexOf(skillLocationAppendix().text) <
        g.indexOf(codexBundledSkillsAppendix().text),
    );
  });
});
