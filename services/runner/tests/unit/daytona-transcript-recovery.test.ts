/**
 * Recovering a swallowed provider error from a REMOTE (Daytona) sandbox.
 *
 * `findSwallowedPiError` reads Pi's transcript to turn an empty turn into a real failure. On a
 * local run it reads the runner's own filesystem; on Daytona — which is where cloud runs — the
 * transcript lives inside the remote sandbox, so the reader goes through the sandbox's daemon
 * file API (the same API `usage.ts` and `pi-assets.ts` read through), before teardown takes the
 * only copy of the message with it. These tests stand a Pi transcript up inside a fake remote
 * sandbox and pin that the error reaches the caller.
 *
 * Fixture note: the fake supports both ways a reader might find the transcript — `readFsFile`
 * serves it for any `.jsonl` path, and `runProcess` answers an `ls` on stdout the way
 * `sandboxRelayHost.list` reads it (`src/tools/relay.ts`). So the expectations below stay
 * implementation-neutral: they pin that the transcript is read, not how it is located.
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

/**
 * The workspace directory the run uses inside the remote sandbox.
 *
 * One constant for both halves on purpose. Pi stamps the cwd on every transcript's `session`
 * record and `findSwallowedPiError` only accepts a transcript whose stamp matches the run's
 * workspace, so a test that seeds `/home/sandbox` while the run works somewhere else would be
 * satisfied by a recovery that ignores transcript ownership -- i.e. one that would happily
 * report a stale or foreign session's error as this turn's.
 */
const REMOTE_CWD = "/home/sandbox";

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
        cwd: REMOTE_CWD,
        promptEvents: [textChunk("The answer is 4.\n")],
        sandboxTranscript: piTranscriptWithError(REMOTE_CWD, RATE_LIMIT_ERROR),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "The answer is 4.");
  });

  it("surfaces the provider failure on an empty turn", async () => {
    const { result } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        cwd: REMOTE_CWD,
        sandboxTranscript: piTranscriptWithError(REMOTE_CWD, RATE_LIMIT_ERROR),
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
  });

  it("reads the transcript out of the sandbox before teardown", async () => {
    const { readFsFilePaths } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        cwd: REMOTE_CWD,
        sandboxTranscript: piTranscriptWithError(REMOTE_CWD, RATE_LIMIT_ERROR),
      },
    );

    // The recovery has to happen while the sandbox is still alive. Pinning the read (rather
    // than only the message) is what stops the check being satisfied by a hard-coded string.
    assert.ok(
      readFsFilePaths.some((path) => path.endsWith(".jsonl")),
      `no transcript read from the sandbox, only: ${readFsFilePaths.join(", ")}`,
    );
  });
});
