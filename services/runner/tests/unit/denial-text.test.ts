/**
 * What a refused call tells the model (QA follow-up).
 *
 * These strings are an instruction to a model, so they are pinned like an interface. QA watched an
 * agent read "denied by the permission policy", decide the block was temporary, retry the same
 * commit three times with reshaped payloads, drift into unrelated commits, and then tell the user
 * that writes were "currently blocked" and it would retry "as soon as that is allowed".
 *
 * Each assertion below is one of the behaviors that produced. None of them tests prose for its
 * own sake.
 *
 * Run: pnpm exec vitest run tests/unit/denial-text.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  declinedByUserText,
  approvalUnavailableText,
  deniedByPolicyText,
  refusedAtGateText,
} from "../../src/tools/denial-text.ts";

describe("the text a declined call returns", () => {
  const text = declinedByUserText("commit_revision");

  it("names the call, so the model knows which one was refused", () => {
    assert.match(text, /'commit_revision'/);
  });

  it("says a person decided, not a system", () => {
    assert.match(text, /The user declined/);
  });

  it("says the decision is about this change and is not temporary", () => {
    assert.match(text, /this specific change/);
    assert.match(text, /not a temporary block/);
  });

  it("forbids the retry AND the reshaped retry", () => {
    // Both halves are load-bearing. Told only "do not send this call again", the agent QA watched
    // sent a differently shaped payload instead and called it a new call.
    assert.match(text, /Do not send this call again/);
    assert.match(text, /do not send a reshaped version of it/);
  });

  it("gives the model something to do next", () => {
    assert.match(text, /Ask the user what they would like to do instead/);
  });

  it("never calls a human decision a policy block", () => {
    // The exact confusion to prevent: the old wording said "policy" for a person's answer.
    assert.doesNotMatch(text, /policy/i);
    assert.doesNotMatch(text, /currently|for now|at this time|try again later/i);
  });
});

describe("the text a policy refusal returns", () => {
  const text = deniedByPolicyText("delete_variant");

  it("names the tool and says the run does not permit it", () => {
    assert.match(text, /'delete_variant'/);
    assert.match(text, /is not permitted in this run/);
  });

  it("closes off both retrying and re-arguing the arguments", () => {
    assert.match(text, /does not change while the conversation continues/);
    assert.match(text, /no argument makes it permitted/);
    assert.match(text, /Do not send this call again/);
  });

  it("tells the model to inform the user rather than to ask them to unblock it", () => {
    assert.match(text, /Tell the user the tool is unavailable/);
    assert.doesNotMatch(text, /try again later|as soon as/i);
  });

  it("does not blame the user for a policy refusal", () => {
    assert.doesNotMatch(text, /declined/i);
  });
});

describe("the text a gate returns when the decider is unknowable", () => {
  const text = refusedAtGateText("bash");

  it("names the call", () => {
    assert.match(text, /'bash'/);
  });

  it("claims NEITHER a person nor a policy, because this side cannot tell", () => {
    // The whole reason this third string exists. The Pi extension gates through
    // `ctx.ui.confirm`, which resolves to a boolean, so a policy deny, a live human decline, a
    // replayed stored decline and a fail-closed reject all arrive identical. Naming either
    // decider would be a confident guess, wrong in one arm every time.
    assert.doesNotMatch(text, /policy/i);
    assert.doesNotMatch(text, /The user declined|declined this/i);
  });

  it("still says the decision is settled, and forbids the reshaped retry", () => {
    // Everything that remains TRUE without knowing who decided. Losing these would trade one
    // wrong message for a useless one: the reshaped retry is the behavior QA actually watched.
    assert.match(text, /already made/);
    assert.match(text, /reshaped version of it/);
    assert.match(text, /will be refused too/);
  });

  it("sends the model to the user, which is correct under BOTH arms", () => {
    assert.match(text, /Tell the user this call was refused/);
    assert.match(text, /ask how they would like to proceed/);
  });

  it("never suggests waiting, on any of the three", () => {
    // The failure mode that started this file: an agent telling a user it would retry "as soon
    // as that is allowed". No refusal message may imply time will help.
    for (const t of [
      refusedAtGateText("bash"),
      declinedByUserText("bash"),
      deniedByPolicyText("bash"),
    ]) {
      assert.doesNotMatch(t, /currently|for now|at this time|try again later|as soon as/i);
    }
  });
});

describe("the text a BROKEN approval channel returns", () => {
  const text = approvalUnavailableText("bash", "this session has no approval dialog.");

  it("names the call and the operational cause", () => {
    assert.match(text, /'bash'/);
    assert.match(text, /no approval dialog/);
  });

  it("says nothing ran, which is the part that stops a retry loop", () => {
    assert.match(text, /Nothing ran/);
    assert.match(text, /not something you can fix by trying again/);
  });

  it("does not blame a person or a policy, because neither refused", () => {
    // This is not a denial. The machinery that would have ASKED was missing, so claiming a
    // decider would be inventing one.
    assert.doesNotMatch(text, /declined|policy|refused by/i);
  });

  it("sends the model to the user rather than leaving it to guess", () => {
    assert.match(text, /Tell the user the approval step is unavailable/);
    assert.match(text, /ask how they would like to proceed/);
  });

  it("keeps the two causes distinguishable for whoever reads the transcript", () => {
    const missing = approvalUnavailableText("bash", "this session has no approval dialog.");
    const threw = approvalUnavailableText("bash", "the approval dialog failed (socket closed).");
    assert.notEqual(missing, threw);
    assert.match(threw, /socket closed/);
  });

  it("never suggests waiting, like every other message in this file", () => {
    assert.doesNotMatch(text, /currently|for now|at this time|try again later|as soon as/i);
  });
});
