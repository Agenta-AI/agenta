/**
 * Platform guidance delivered through the author's instructions file.
 *
 * The channel exists for Codex, which has no system-prompt channel at all, and it is read by every
 * harness. So the property that matters most here is NEGATIVE: Pi and Claude must not receive the
 * mount paragraph twice, once through their own channel and once through the file.
 *
 * The two config sentences (the rendered file is a copy; skills live in the configuration) moved
 * to the SDK platform text on 2026-09-07. The tests below pin their ABSENCE here, so they cannot
 * creep back and be delivered twice.
 *
 * Run: pnpm exec vitest run tests/unit/platform-guidance.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  codexBundledSkillsAppendix,
  fileCitationAppendix,
  platformGuidanceAppendix,
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
  // A config-editing agent by default, since that is what the codex rebuttal addresses. The
  // gate's other arm is exercised explicitly below.
  toolNames: ["commit_revision"],
  ...overrides,
});

describe("what every harness is told", () => {
  it("always carries the file-citation sentence", () => {
    // The one contributor with no harness condition and no tool condition: any run can mention a
    // file in chat, and the client opens only one path shape.
    for (const input of [
      run({ acpAgent: "codex" }),
      run({ acpAgent: "claude" }),
      run({ acpAgent: "pi", isPi: true }),
    ]) {
      const guidance = platformGuidanceAppendix(input);
      assert.ok(
        guidance?.includes(fileCitationAppendix().text),
        input.acpAgent,
      );
    }
  });

  it("no longer carries the config sentences, which the SDK platform text now owns", () => {
    // Delivering them here as well would spend the same context twice. The SDK text gates its
    // configuration sections on the same tool name, so a run that can commit still reads them
    // once, first, in the platform text.
    for (const input of [
      run({ acpAgent: "codex" }),
      run({ acpAgent: "claude" }),
      run({ acpAgent: "pi", isPi: true }),
    ]) {
      const guidance = platformGuidanceAppendix(input);
      assert.ok(guidance, input.acpAgent);
      assert.ok(
        !guidance.includes("is a copy of your configuration"),
        `${input.acpAgent} must not carry the instructions-source sentence`,
      );
      assert.ok(
        !guidance.includes("parameters.agent.skills"),
        `${input.acpAgent} must not carry the skill-location sentence`,
      );
    }
  });

  it("states the rendered-skills read path when skills are materialized, and stays silent otherwise", () => {
    // The fix for an observed failure: with no stated path, a model guessed a structurally-wrong
    // absolute skills path from memory as its first move (ENOENT + an approval interruption).
    const withSkills = platformGuidanceAppendix(
      run({ skillsPath: "/tmp/agenta/mounts/p/s/agents/skills" }),
    );
    assert.ok(withSkills?.includes("/tmp/agenta/mounts/p/s/agents/skills"));
    assert.ok(withSkills?.includes("never construct the path from memory"));
    const withoutSkills = platformGuidanceAppendix(run({}));
    assert.ok(!withoutSkills?.includes("rendered skill files"));
  });

  it("ends on the mount paragraph, which is long and describes where things go", () => {
    const guidance = platformGuidanceAppendix(run({ agentMountedPath: MOUNT }));
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
    const guidance = platformGuidanceAppendix(run({ agentMountSkipped: true }));
    assert.ok(guidance?.includes(agentMountUnavailableGuidance()));
  });

  it("says nothing about durable storage when none was configured", () => {
    // The third state. A stack with no durable storage at all would otherwise carry the "not
    // available" caveat in every prompt forever, which is how a real warning becomes noise.
    const guidance = platformGuidanceAppendix(run());
    assert.ok(guidance);
    assert.ok(!guidance.includes("durable agent folder"));
    assert.ok(!guidance.includes(agentMountUnavailableGuidance()));
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
  it("keeps the always-on block small now that the config sentences left", () => {
    // LOWERED DELIBERATELY. The block used to hold three sentences under a 1200-char ceiling.
    // Two of them now ship in the SDK platform text, so what remains here for a non-codex run
    // is the file-citation sentence alone. If a new contributor wants in, it needs its own
    // numbers; "it reads well" is not a reason.
    const alwaysOn = platformGuidanceAppendix(
      run({ acpAgent: "claude", toolNames: ["commit_revision"] }),
    );
    assert.ok(alwaysOn);
    assert.ok(
      alwaysOn.length < 450,
      `the always-on block is ${alwaysOn.length} chars`,
    );
  });

  it("lets CODEX pay more, because codex alone has the problem it answers", () => {
    // The rebuttal sentence answers codex's own bundled skill-creator and skill-installer, which
    // document installing into `.codex/skills`. Claude and pi ship no such skills and pay nothing
    // for it. The justification is measured: codex skill scenarios sit at 6 of 21 with 13
    // wrong_surface, against ZERO on claude and pi. If that gap closes and the sentence stays,
    // delete it.
    const codex = platformGuidanceAppendix(
      run({ acpAgent: "codex", toolNames: ["commit_revision"] }),
    );
    assert.ok(codex);
    assert.ok(codex.length < 800, `the codex block is ${codex.length} chars`);
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
      assert.ok(
        !g.includes("skill-installer"),
        `${other.acpAgent} must not see it`,
      );
    }
  });

  it("names both skills, the folder they install into, and the tool that does count", () => {
    // It has to name them. The failure is that models follow those two by name, so guidance that
    // gestured at "other tools" would not connect to what they are actually reading. It also has
    // to name the right tool, now that the skill sentence it used to lean on is not in this block.
    const text = codexBundledSkillsAppendix().text;
    assert.ok(text.includes("skill-creator"));
    assert.ok(text.includes("skill-installer"));
    assert.ok(text.includes(".codex/skills"));
    assert.ok(text.includes("commit_revision"));
    assert.doesNotMatch(text, /as described above/);
    assert.equal(codexBundledSkillsAppendix().id, "codex-bundled-skills");
  });

  it("rides the config-tool gate, so a codex run without commit_revision stays silent", () => {
    // A plain agent with no config tools would otherwise read a sentence telling it to use a
    // tool it does not have.
    const guidance = platformGuidanceAppendix(
      run({ acpAgent: "codex", toolNames: ["bash"] }),
    );
    assert.ok(!guidance?.includes("skill-installer"));
    assert.ok(guidance?.includes(fileCitationAppendix().text));
  });

  it("keys on the tool name rather than on the ordered-operations flag", () => {
    // THE AXIS IS DELIBERATE. `commit_revision` is in the default build kit unconditionally and
    // the flag changes the commit's DELTA SHAPE, not the tool's existence. Presence also catches
    // what a flag check cannot: a flag-ON agent that simply has no config tools.
    assert.ok(
      platformGuidanceAppendix(
        run({ acpAgent: "codex", toolNames: ["commit_revision"] }),
      )?.includes("skill-installer"),
    );
    assert.ok(
      !platformGuidanceAppendix(
        run({ acpAgent: "codex", toolNames: ["read_config"] }),
      )?.includes("skill-installer"),
    );
  });

  it("does NOT gate the mount paragraph, which has no tool dependency", () => {
    // A Codex run with no config tools still needs to be told where its durable folder is.
    const guidance = platformGuidanceAppendix(
      run({ toolNames: [], agentMountedPath: MOUNT }),
    );
    assert.ok(guidance?.includes(agentMountGuidance(MOUNT)));
    assert.ok(!guidance?.includes("skill-installer"));
  });
});
