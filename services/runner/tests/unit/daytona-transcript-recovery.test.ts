/**
 * Recovering a swallowed provider error from a REMOTE (Daytona) sandbox.
 *
 * `findSwallowedPiError` reads Pi's transcript to turn an empty turn into a real failure, but it
 * reads the runner's own filesystem, so it is switched off on Daytona (`pi-error.ts` says so in
 * its header, `run-turn.ts` gates it behind `!plan.isDaytona`). Cloud runs on Daytona. That makes
 * production the one place where the safety net does not exist — every swallowed provider error
 * there becomes a blank bubble, and the only copy of the message dies with the sandbox.
 *
 * The sandbox already exposes a daemon file API that other code reads through (`usage.ts` pulls
 * the usage file, `pi-assets.ts` pulls the skill-snapshot marker), so the transcript is reachable
 * before teardown. These tests stand a Pi transcript up inside a fake remote sandbox and pin that
 * the error reaches the caller.
 *
 * Fixture note: an implementation that LISTS the transcript directory (rather than reading a
 * known path) will need `runProcess` in `tests/utils/silent-turn.ts` taught to answer that
 * listing.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/daytona-transcript-recovery.test.ts)
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findSwallowedPiError } from "../../src/engines/sandbox_agent/pi-error.ts";
import {
  enableDaytonaProvider,
  piTranscriptWithError,
  runSilentTurn,
  seedFailedTranscript,
  textChunk,
} from "../utils/silent-turn.ts";

const RATE_LIMIT_ERROR =
  "Rate limit reached for gpt-5 in organization org-abc on tokens per min.";

const dirs: string[] = [];

beforeEach(enableDaytonaProvider);

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("a Pi transcript inside a remote sandbox", () => {
  it("is the shape the existing reader understands", async () => {
    // Guards the fixture itself: the same bytes the fake sandbox serves must be readable by the
    // reader that already ships, so a transcript-format change fails here and not as a confusing
    // silence in the expectations below.
    const cwd = mkdtempSync(join(tmpdir(), "agenta-daytona-transcript-"));
    dirs.push(cwd);
    seedFailedTranscript(cwd, RATE_LIMIT_ERROR);

    assert.equal(findSwallowedPiError(cwd), RATE_LIMIT_ERROR);
  });

  it("does not disturb a Daytona turn that produced an answer", async () => {
    // Guards the fake sandbox: a run through it must still complete normally, so a failure below
    // means the empty turn, not a broken remote fixture.
    const { result } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        promptEvents: [textChunk("The answer is 4.\n")],
        sandboxTranscript: piTranscriptWithError(
          "/home/sandbox",
          RATE_LIMIT_ERROR,
        ),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "The answer is 4.");
  });

  it.fails(
    "surfaces the provider failure on an empty turn [awaiting fix: Daytona swallowed-error reader]",
    async () => {
      const { result } = await runSilentTurn(
        { harness: "pi_core", sandbox: "daytona" },
        {
          sandboxTranscript: piTranscriptWithError(
            "/home/sandbox",
            RATE_LIMIT_ERROR,
          ),
        },
      );

      assert.equal(result.ok, false);
      // Asserting on the substance of THIS failure, not on wording: only a recovery that actually
      // read the remote transcript can produce it. A generic "the agent produced no output"
      // cannot satisfy this, which is the point.
      assert.ok(
        result.error?.toLowerCase().includes("rate limit"),
        `expected the transcript's failure, got: ${result.error}`,
      );
    },
  );

  it.fails(
    "reads the transcript out of the sandbox before teardown [awaiting fix: Daytona swallowed-error reader]",
    async () => {
      const { readFsFilePaths } = await runSilentTurn(
        { harness: "pi_core", sandbox: "daytona" },
        {
          sandboxTranscript: piTranscriptWithError(
            "/home/sandbox",
            RATE_LIMIT_ERROR,
          ),
        },
      );

      // The recovery has to happen while the sandbox is still alive. Pinning the read (rather
      // than only the message) is what stops the check being satisfied by a hard-coded string.
      assert.ok(
        readFsFilePaths.some((path) => path.endsWith(".jsonl")),
        `no transcript read from the sandbox, only: ${readFsFilePaths.join(", ")}`,
      );
    },
  );
});
