/**
 * The wire contract for a turn that produced nothing (ASD-EST100, the "No response" class).
 *
 * When a provider rejects a model call (no credit, quota, rate limit, bad key, context overflow),
 * pi-acp maps the failure to a clean `{stopReason: "end_turn"}` with no content. The runner
 * believes it, returns `ok: true` with an empty output, records the turn as a completed one, and
 * the user sees a blank bubble with no error anywhere. The only copy of the real message is inside
 * the sandbox, which is then destroyed.
 *
 * These tests assert the WIRE contract, never prose:
 *   - a turn that produced no output must not come back `ok: true`
 *   - a failed turn must emit an `error` event BEFORE the terminal `done` the API reconciles on
 *   - a failed turn must not record continuity (recording it poisons later turns with the same
 *     empty state, which is how one bad turn became a whole bad session)
 *
 * The suite is deliberately two-sided. Every fail-loud assertion is paired with a guard that a
 * turn which legitimately produced no text (a park) or which produced a real answer keeps working,
 * so the fail-loud fix cannot be satisfied by failing everything, and the empty-turn check cannot
 * be satisfied by suppressing it.
 *
 * Tests marked `it.fails` pin behavior that is NOT implemented yet; they pass today BECAUSE the
 * assertion fails, and turn red the moment the named fix lands, which is the signal to drop the
 * `.fails`. The fix names are in the test titles. Note that `it.fails` is satisfied by ANY
 * failure, including a fixture that dies before running a turn — so each one is backed by a guard
 * test above it that proves its setup reaches a real turn.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/silent-turn-contract.test.ts)
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "../../src/protocol.ts";
import {
  AGENT_SESSION_ID,
  SESSION_ID,
  enableDaytonaProvider,
  runSilentTurn,
  seedFailedTranscript,
  textChunk,
  toolCallChunk,
} from "../utils/silent-turn.ts";

const QUOTA_ERROR = "Your credit balance is too low to run this model.";

// pi-acp's startup banner, which it emits as the first message chunk of a session.
const BANNER = [
  "pi v0.79.4\n---\n\n## Context\n- /tmp/x/AGENTS.md\n\n",
  "New version available: v0.80.2 (installed v0.79.4).\n",
];

const dirs: string[] = [];

/** A run cwd holding a Pi transcript whose last turn failed, where the reader looks for it. */
function cwdWithFailedTranscript(): string {
  const cwd = mkdtempSync(join(tmpdir(), "agenta-silent-turn-"));
  dirs.push(cwd);
  seedFailedTranscript(cwd, QUOTA_ERROR);
  return cwd;
}

function types(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

beforeEach(enableDaytonaProvider);

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("a turn whose model call failed", () => {
  it("fails loud with the provider's own message (local Pi)", async () => {
    const cwd = cwdWithFailedTranscript();

    const { result, events, store } = await runSilentTurn(
      { harness: "pi_core" },
      { cwd },
    );

    assert.equal(result.ok, false);
    // The error must name THIS failure. `conciseError` classifies the provider's raw text into a
    // curated message, so assert on the substance both forms carry ("credit"), never on wording:
    // only actually reading the transcript can produce it.
    assert.ok(
      result.error?.includes("credit"),
      `the provider's failure must reach the caller, got: ${result.error}`,
    );
    // The playground renders the event stream, not the result envelope: the error has to be IN
    // the stream, and ahead of the terminal `done`, or the turn still renders as a silent blank.
    const order = types(events);
    assert.ok(order.includes("error"), `no error event in stream: ${order}`);
    assert.ok(
      order.indexOf("error") < order.lastIndexOf("done"),
      `the error event must precede the terminal done: ${order}`,
    );
    // A failed turn must not be remembered as the session's last good turn.
    assert.equal(store.get(SESSION_ID, "pi_core"), undefined);
  });

  it("returns no output and no messages when the harness itself throws", async () => {
    const { result } = await runSilentTurn(
      { harness: "pi_core" },
      { promptError: new Error("fetch failed") },
    );

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(result.output, undefined);
    assert.equal(result.messages, undefined);
  });
});

describe("turns that must keep working (guards against an over-eager fail-loud)", () => {
  it("succeeds and records continuity when the turn produced an answer", async () => {
    const { result, events, store } = await runSilentTurn(
      { harness: "pi_core" },
      { promptEvents: [textChunk("The answer is 4.\n")] },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "The answer is 4.");
    assert.deepEqual(result.messages, [
      { role: "assistant", content: "The answer is 4." },
    ]);
    assert.ok(
      !types(events).includes("error"),
      "a good turn emitted an error event",
    );
    assert.equal(
      store.get(SESSION_ID, "pi_core")?.agentSessionId,
      AGENT_SESSION_ID,
    );
  });

  it("does not treat a parked turn as an empty failure", async () => {
    // A turn paused on an approval gate legitimately ends with no assistant text. It is the
    // single most likely false positive for any empty-turn check, and it is a reported symptom
    // in its own right (a reloaded paused turn renders as "No response", issue #5542).
    const { result, events } = await runSilentTurn(
      { harness: "pi_core" },
      { park: true },
    );

    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "paused");
    assert.ok(
      !types(events).includes("error"),
      "a parked turn must not emit an error event",
    );
  });
});

describe("empty turns that still pass silently", () => {
  it("reaches a real turn on Daytona and closes it (guards the expectations below)", async () => {
    // Without this, a fixture that dies during sandbox setup would satisfy every `it.fails`
    // below forever — which is exactly how this fixture first "passed". Both assertions hold
    // before and after the fail-loud fix, so this stays a fixture check and not a second alarm.
    const { result, events } = await runSilentTurn({
      harness: "pi_core",
      sandbox: "daytona",
    });

    assert.equal(types(events).at(-1), "done");
    assert.equal(result.output ?? "", "");
  });

  it("reaches a real turn on a non-Pi harness (guards the expectation below)", async () => {
    const { result } = await runSilentTurn(
      { harness: "claude" },
      { promptEvents: [textChunk("The answer is 4.\n")] },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "The answer is 4.");
  });

  it("puts a tool call in the stream (guards the expectation below)", async () => {
    // The tool-call expectation below is `it.fails`, so its own in-body check that the tool call
    // arrived would be satisfied by a fixture that stopped emitting one — the test would sit at
    // "expected fail" forever, including after the fix lands. This guard is the external one.
    const { events } = await runSilentTurn(
      { harness: "pi_core" },
      { promptEvents: [toolCallChunk("tool-1")] },
    );

    assert.ok(
      types(events).includes("tool_call"),
      `the fixture must emit a tool_call event, got: ${types(events)}`,
    );
  });

  it("strips a banner-only turn down to nothing (guards the expectation below)", async () => {
    // The premise of the banner case: after stripping, a turn that streamed only the banner is
    // indistinguishable from a turn that streamed nothing. Asserting it here rather than inside
    // the `it.fails` means a change to the banner format shows up as a real failure.
    const { result } = await runSilentTurn(
      { harness: "pi_core" },
      { promptEvents: BANNER.map(textChunk) },
    );

    assert.equal(result.output, "");
  });

  it.fails(
    "must fail loud on Daytona, where the transcript reader is switched off [awaiting fix: fail-loud empty turn]",
    async () => {
      // Cloud runs on Daytona, so this is the one placement where the safety net does not exist.
      const { result } = await runSilentTurn({
        harness: "pi_core",
        sandbox: "daytona",
      });

      assert.equal(result.ok, false);
    },
  );

  it.fails(
    "must fail loud for a non-Pi harness, whose transcript is never read [awaiting fix: fail-loud empty turn]",
    async () => {
      // The swallowed-error probe is Pi-only, so an empty Claude/Codex turn is silent everywhere.
      const { result } = await runSilentTurn({ harness: "claude" });

      assert.equal(result.ok, false);
    },
  );

  it.fails(
    "must not record continuity for an empty turn [awaiting fix: fail-loud empty turn]",
    async () => {
      // Recording an empty turn as the session's last good turn is what let one silent failure
      // poison every later turn: the next turn restores that state cleanly and fails the same way.
      const { store } = await runSilentTurn({
        harness: "pi_core",
        sandbox: "daytona",
      });

      assert.equal(store.get(SESSION_ID, "pi_core"), undefined);
    },
  );

  it.fails(
    "must fail loud when the whole answer was the startup banner [awaiting fix: fail-loud empty turn]",
    async () => {
      // pi-acp emits its startup banner as the first message chunk. The stripper removes it, so a
      // turn that streamed ONLY the banner arrives at the same place as a turn that streamed
      // nothing: empty output, `ok: true`, blank bubble.
      const { result } = await runSilentTurn(
        { harness: "pi_core" },
        { promptEvents: BANNER.map(textChunk) },
      );

      assert.equal(result.ok, false);
    },
  );

  it.fails(
    "must surface the error when the turn called a tool and then died [awaiting fix: fail-loud empty turn]",
    async () => {
      // The probe is skipped whenever the turn emitted a tool call, so a turn that ran a tool and
      // then hit the provider failure stays silent even on the local path that can read the
      // transcript. This is the shape of issue #6102 (a turn ends after a tool call, no answer,
      // no stated reason).
      const cwd = cwdWithFailedTranscript();

      const { result, events } = await runSilentTurn(
        { harness: "pi_core" },
        { cwd, promptEvents: [toolCallChunk("tool-1")] },
      );

      // The tool call really reached the stream, so this is about the empty turn after it.
      assert.ok(types(events).includes("tool_call"));
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes("credit"));
    },
  );
});
