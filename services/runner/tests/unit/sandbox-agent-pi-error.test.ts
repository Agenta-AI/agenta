/**
 * Unit tests for recovering a model error Pi swallows on the local sandbox-agent path.
 *
 * When Pi's provider call fails, Pi records the failed turn in its session transcript with
 * `stopReason: "error"` + `errorMessage`, but reports a plain `end_turn` with no content over
 * ACP. `findSwallowedPiError` reads that transcript so the empty turn can fail loud.
 *
 * The transcript lives where `configurePiSessionWorkspace` points Pi: the directory returned
 * by `piSessionWorkspaceDir(cwd)`, with the `.jsonl` files written flat into it (an explicit
 * PI_CODING_AGENT_SESSION_DIR gets no encoded-cwd subdir). These tests write transcripts
 * through that same shared helper, so the reader and the writer cannot drift apart again
 * (QA finding F-11: the reader once scanned the old Pi agent dir and found nothing, turning
 * every provider failure into a generic "The agent produced no output.").
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-pi-error.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  capturePiTranscriptCursor,
  findSwallowedPiError,
} from "../../src/engines/sandbox_agent/pi-error.ts";
import { piSessionWorkspaceDir } from "../../src/engines/sandbox_agent/pi-assets.ts";
// The transcript encoder is shared with the silent-turn suites, so the format lives in one
// place: two hand-rolled copies could drift together and both stop matching what Pi writes.
import {
  piTranscriptFileName,
  writePiTranscript as writeTranscript,
} from "../utils/silent-turn.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-pi-error-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("findSwallowedPiError", () => {
  it("returns the last assistant errorMessage from the session-workspace transcript", () => {
    const cwd = tempDir();
    const cursor = capturePiTranscriptCursor(cwd, "sess-quota");
    assert.ok(cursor);
    writeTranscript(cwd, "sess-quota", [
      {
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage:
            "You exceeded your current quota, please check your plan.",
        },
      },
    ]);

    const error = findSwallowedPiError(cwd, cursor);
    assert.equal(
      error,
      "You exceeded your current quota, please check your plan.",
    );
  });

  it("returns undefined for a successful turn", () => {
    const cwd = tempDir();
    const cursor = capturePiTranscriptCursor(cwd, "sess-ok");
    assert.ok(cursor);
    writeTranscript(cwd, "sess-ok", [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          stopReason: "end_turn",
        },
      },
    ]);

    assert.equal(findSwallowedPiError(cwd, cursor), undefined);
  });

  it("does not surface an error cleared by a later successful turn", () => {
    const cwd = tempDir();
    const cursor = capturePiTranscriptCursor(cwd, "sess-recovered");
    assert.ok(cursor);
    writeTranscript(cwd, "sess-recovered", [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "transient",
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "recovered" }],
          stopReason: "end_turn",
        },
      },
    ]);

    assert.equal(findSwallowedPiError(cwd, cursor), undefined);
  });

  it("reads only the records appended after an existing transcript cursor", () => {
    const cwd = tempDir();
    writeTranscript(cwd, "sess-continued", [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "古いエラー",
        },
      },
    ]);
    const cursor = capturePiTranscriptCursor(cwd, "sess-continued");
    assert.ok(cursor);
    appendFileSync(
      join(piSessionWorkspaceDir(cwd), piTranscriptFileName("sess-continued")),
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "current error",
        },
      })}\n`,
    );

    assert.equal(findSwallowedPiError(cwd, cursor), "current error");
  });

  it("ignores transcripts whose session record was stamped with a different cwd", () => {
    const cwd = tempDir();
    const cursor = capturePiTranscriptCursor(cwd, "sess-stale");
    assert.ok(cursor);
    writeTranscript(
      cwd,
      "sess-stale",
      [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "nope",
          },
        },
      ],
      "/tmp/some-other-cwd",
    );

    assert.equal(findSwallowedPiError(cwd, cursor), undefined);
  });

  it("returns undefined when the transcript dir is absent", () => {
    const cwd = tempDir();
    const cursor = capturePiTranscriptCursor(cwd, "sess-missing");
    assert.ok(cursor);
    assert.equal(findSwallowedPiError(cwd, cursor), undefined);
  });
});
