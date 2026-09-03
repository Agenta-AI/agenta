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
  piTranscriptWithError,
  runSilentTurn,
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

/** A private local run cwd, cleaned up after each test. */
function localRunCwd(): string {
  const cwd = mkdtempSync(join(tmpdir(), "agenta-silent-turn-"));
  dirs.push(cwd);
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
    const cwd = localRunCwd();

    const { result, events, store } = await runSilentTurn(
      { harness: "pi_core" },
      { cwd, localTranscript: piTranscriptWithError(cwd, QUOTA_ERROR) },
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

describe("paths where an empty turn is still silent", () => {
  it("reaches a real turn on Daytona and closes it", async () => {
    // An empty Daytona turn still ends as a clean, silent `done`. This pins that the fixture
    // completes a real turn rather than dying during sandbox setup, which is what every other
    // Daytona assertion in this suite rests on.
    const { result, events } = await runSilentTurn({
      harness: "pi_core",
      sandbox: "daytona",
    });

    assert.equal(types(events).at(-1), "done");
    assert.equal(result.output ?? "", "");
  });

  it("answers on a non-Pi harness", async () => {
    const { result } = await runSilentTurn(
      { harness: "claude" },
      { promptEvents: [textChunk("The answer is 4.\n")] },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "The answer is 4.");
  });

  it("puts a tool call in the stream", async () => {
    // The swallowed-error probe is skipped whenever a turn emitted a tool call, so several
    // behaviors here hinge on the fixture really putting one in the stream.
    const { events } = await runSilentTurn(
      { harness: "pi_core" },
      { promptEvents: [toolCallChunk("tool-1")] },
    );

    assert.ok(
      types(events).includes("tool_call"),
      `the fixture must emit a tool_call event, got: ${types(events)}`,
    );
  });

  it("strips a banner-only turn down to nothing", async () => {
    // pi-acp emits its startup banner as the first message chunk. After stripping, a turn that
    // streamed only the banner is indistinguishable from a turn that streamed nothing — which is
    // why such a turn still arrives at empty output and a blank bubble.
    const { result } = await runSilentTurn(
      { harness: "pi_core" },
      { promptEvents: BANNER.map(textChunk) },
    );

    assert.equal(result.output, "");
  });
});
