/**
 * Unit tests for recovering a model error Pi swallows on the local sandbox-agent path.
 *
 * When Pi's provider call fails, Pi records the failed turn in its session transcript with
 * `stopReason: "error"` + `errorMessage`, but reports a plain `end_turn` with no content over
 * ACP. `findSwallowedPiError` reads that transcript so the empty turn can fail loud.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-pi-error.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findSwallowedPiError } from "../../src/engines/sandbox_agent/pi-error.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-pi-error-test-"));
  dirs.push(dir);
  return dir;
}

/** Write a Pi-style .jsonl transcript under `<piAgentDir>/sessions/<name>/` for `cwd`. */
function writeTranscript(
  piAgentDir: string,
  name: string,
  cwd: string,
  messages: Array<Record<string, unknown>>,
): void {
  const dir = join(piAgentDir, "sessions", name);
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: name, cwd }),
    ...messages.map((m) => JSON.stringify(m)),
  ];
  writeFileSync(join(dir, `${name}.jsonl`), lines.join("\n") + "\n");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("findSwallowedPiError", () => {
  it("returns the last assistant errorMessage for a matching cwd", () => {
    const piAgentDir = tempDir();
    const cwd = "/tmp/agenta-sandbox-agent-abc123";
    writeTranscript(piAgentDir, "--tmp-agenta-sandbox-agent-abc123--", cwd, [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "You exceeded your current quota, please check your plan.",
        },
      },
    ]);

    const error = findSwallowedPiError(piAgentDir, cwd);
    assert.equal(error, "You exceeded your current quota, please check your plan.");
  });

  it("returns undefined for a successful turn", () => {
    const piAgentDir = tempDir();
    const cwd = "/tmp/agenta-sandbox-agent-ok";
    writeTranscript(piAgentDir, "--tmp-agenta-sandbox-agent-ok--", cwd, [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          stopReason: "end_turn",
        },
      },
    ]);

    assert.equal(findSwallowedPiError(piAgentDir, cwd), undefined);
  });

  it("does not surface an error cleared by a later successful turn", () => {
    const piAgentDir = tempDir();
    const cwd = "/tmp/agenta-sandbox-agent-recovered";
    writeTranscript(piAgentDir, "--recovered--", cwd, [
      {
        type: "message",
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "transient" },
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

    assert.equal(findSwallowedPiError(piAgentDir, cwd), undefined);
  });

  it("ignores transcripts for a different cwd", () => {
    const piAgentDir = tempDir();
    writeTranscript(piAgentDir, "--other--", "/tmp/some-other-cwd", [
      {
        type: "message",
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "nope" },
      },
    ]);

    assert.equal(
      findSwallowedPiError(piAgentDir, "/tmp/agenta-sandbox-agent-missing"),
      undefined,
    );
  });

  it("returns undefined when the sessions dir is absent", () => {
    const piAgentDir = tempDir();
    assert.equal(findSwallowedPiError(piAgentDir, "/tmp/whatever"), undefined);
  });

  it("finds the error in the per-run agent dir Pi was actually pointed at, not the static source dir", () => {
    // Regression: a run that materializes skills/system-prompt gets a throwaway per-run Pi
    // agent dir (prepareLocalAgentDir's return value) — the engine must read the swallowed
    // error from THAT dir (where Pi, pointed there via PI_CODING_AGENT_DIR, wrote its
    // transcript), not from the static source login dir, which never has the transcript.
    const sourceAgentDir = tempDir(); // e.g. ~/.pi/agent — never receives transcripts
    const runAgentDir = tempDir(); // the throwaway dir prepareLocalAgentDir returns
    const cwd = "/tmp/agenta-sandbox-agent-run1";
    writeTranscript(runAgentDir, "--tmp-agenta-sandbox-agent-run1--", cwd, [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "insufficient credit",
        },
      },
    ]);

    // The bug: passing the static source dir finds nothing.
    assert.equal(findSwallowedPiError(sourceAgentDir, cwd), undefined);
    // The fix: passing the actual per-run dir Pi wrote to finds the error.
    assert.equal(findSwallowedPiError(runAgentDir, cwd), "insufficient credit");
  });
});
