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
 * Fixture note: the fake honors the daemon contract — `runProcess` answers an `ls` on stdout
 * the way `sandboxRelayHost.list` reads it (`src/tools/relay.ts`) and only for the transcript
 * directory, and `readFsFile` serves the transcript only at its exact path — so these tests
 * pin both that the transcript is read and that it is located where Pi writes it.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/daytona-transcript-recovery.test.ts)
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  capturePiTranscriptCursor,
  findSwallowedPiError,
  type PiTranscriptCursor,
} from "../../src/engines/sandbox_agent/pi-error.ts";
import { piSessionWorkspaceDir } from "../../src/engines/sandbox_agent/pi-assets.ts";
import {
  enableDaytonaProvider,
  AGENT_SESSION_ID,
  piTranscriptFileName,
  piTranscript,
  piTranscriptWithError,
  runSilentTurn,
  seedFailedTranscript,
  textChunk,
  type RecordedRunProcessCall,
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
    const cursor = capturePiTranscriptCursor(cwd, AGENT_SESSION_ID);
    assert.ok(cursor);
    seedFailedTranscript(cwd, RATE_LIMIT_ERROR);

    assert.equal(findSwallowedPiError(cwd, cursor), RATE_LIMIT_ERROR);
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
    const { result, events } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        cwd: REMOTE_CWD,
        sandboxTranscript: piTranscriptWithError(REMOTE_CWD, RATE_LIMIT_ERROR),
      },
    );

    assert.equal(result.ok, false);
    // The combined contract classifies the transcript's raw provider refusal before exposing it.
    // Only a recovery that read RATE_LIMIT_ERROR can produce this stable user-facing message; a
    // generic "the agent produced no output" cannot satisfy it.
    assert.equal(
      result.error,
      "Too many requests right now. Try again in a moment.",
    );
    // The playground renders the event stream, not the result envelope: the error has to be IN
    // the stream, and ahead of the terminal `done`, or the turn still renders as a silent blank.
    const order = events.map((e) => e.type);
    const errorEvent = events.find((event) => event.type === "error");
    assert.ok(errorEvent, `no error event in stream: ${order}`);
    assert.equal(
      errorEvent.message,
      "Too many requests right now. Try again in a moment.",
    );
    assert.equal(errorEvent.code, "rate_limited");
    assert.ok(
      order.indexOf("error") < order.lastIndexOf("done"),
      `the error event must precede the terminal done: ${order}`,
    );
  });

  it("does not resurrect a previous turn's error when the transcript is unchanged", async () => {
    const { result, events } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        cwd: REMOTE_CWD,
        initialSandboxTranscript: piTranscriptWithError(
          REMOTE_CWD,
          RATE_LIMIT_ERROR,
        ),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "end_turn");
    assert.ok(
      !events.some((event) => event.type === "error"),
      "an unchanged transcript cannot supply this turn's error",
    );
  });

  it("recovers only the error appended to an existing transcript by this turn", async () => {
    const previousError = piTranscriptWithError(
      REMOTE_CWD,
      "previous turn failed",
    );
    const currentError = "Current turn model call failed.";
    const currentRecords =
      [
        {
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "again" }] },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: currentError,
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n";

    const { result } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        cwd: REMOTE_CWD,
        initialSandboxTranscript: previousError,
        sandboxTranscript: previousError + currentRecords,
      },
    );

    assert.equal(result.ok, false);
    assert.ok(
      result.error?.includes("Current turn"),
      `expected only the appended error, got: ${result.error}`,
    );
    assert.ok(!result.error?.includes("previous turn"));
  });

  it("does not resurrect a previous turn's error when the turn is cancelled", async () => {
    const { result, events } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        cwd: REMOTE_CWD,
        cancel: true,
        initialSandboxTranscript: piTranscriptWithError(
          REMOTE_CWD,
          RATE_LIMIT_ERROR,
        ),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "cancelled");
    assert.ok(
      !events.some((event) => event.type === "error"),
      "a cancelled turn cannot inherit a previous turn's error",
    );
  });

  it("does not resurrect a previous turn's error when the turn is paused", async () => {
    const { result, events } = await runSilentTurn(
      { harness: "pi_core", sandbox: "daytona" },
      {
        cwd: REMOTE_CWD,
        park: true,
        initialSandboxTranscript: piTranscriptWithError(
          REMOTE_CWD,
          RATE_LIMIT_ERROR,
        ),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "paused");
    assert.ok(!events.some((event) => event.type === "error"));
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

/** What one file in the fake remote transcript directory does when read. */
interface FakeRemoteFile {
  content?: string;
  /** Reject the read, like a vanished or permission-broken file. */
  unreadable?: boolean;
  /** Never settle the read, like a stalled daemon response. */
  hang?: boolean;
  /** Override the metadata returned by `stat`, including malformed output. */
  statOutput?: string;
}

/**
 * A minimal remote sandbox for driving `findSwallowedPiError`'s remote mode directly:
 * `ls` lists `files` in the given order (newest first, the way `-t` answers), reads serve,
 * reject, or hang per file. Calls are recorded so tests can pin the daemon contract.
 */
function fakeRemoteSandbox(files: Array<[name: string, file: FakeRemoteFile]>) {
  const runProcessCalls: RecordedRunProcessCall[] = [];
  const readPaths: string[] = [];
  const sandbox = {
    async runProcess(input?: RecordedRunProcessCall) {
      runProcessCalls.push({ ...input });
      if (input?.command === "stat") {
        const path = input.args?.at(-1);
        const transcriptDir = piSessionWorkspaceDir(REMOTE_CWD);
        const file = files.find(
          ([name]) => path === join(transcriptDir, name),
        )?.[1];
        if (!file || file.unreadable) return { exitCode: 1, stdout: "" };
        return {
          exitCode: 0,
          stdout:
            file.statOutput ??
            `${new TextEncoder().encode(file.content ?? "").length}\n`,
        };
      }
      return {
        exitCode: 0,
        stdout: files.map(([name]) => name).join("\n") + "\n",
      };
    },
    async readFsFile({ path }: { path: string }) {
      readPaths.push(path);
      const transcriptDir = piSessionWorkspaceDir(REMOTE_CWD);
      const file = files.find(
        ([name]) => path === join(transcriptDir, name),
      )?.[1];
      if (!file || file.unreadable) throw new Error(`ENOENT: ${path}`);
      if (file.hang) return new Promise<never>(() => {});
      return new TextEncoder().encode(file.content ?? "");
    },
  };
  return { sandbox, runProcessCalls, readPaths };
}

function successTranscript(cwd: string, name: string): string {
  return piTranscript(cwd, name, [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        stopReason: "end_turn",
      },
    },
  ]);
}

function errorTranscript(
  cwd: string,
  name: string,
  message: string,
  recordCwd: string = cwd,
): string {
  return piTranscript(
    cwd,
    name,
    [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: message,
        },
      },
    ],
    recordCwd,
  );
}

describe("the remote reader, driven directly", () => {
  const newTurnCursor = (sessionId: string): PiTranscriptCursor => ({
    sessionId,
    offset: 0,
  });

  it("asks the daemon for a bounded ls of the run's transcript directory", async () => {
    const { sandbox, runProcessCalls } = fakeRemoteSandbox([
      [
        piTranscriptFileName("sess-a"),
        { content: errorTranscript(REMOTE_CWD, "sess-a", RATE_LIMIT_ERROR) },
      ],
    ]);

    assert.equal(
      await findSwallowedPiError(REMOTE_CWD, newTurnCursor("sess-a"), {
        sandbox,
      }),
      RATE_LIMIT_ERROR,
    );

    const ls = runProcessCalls.find((call) => call.command === "ls");
    assert.ok(ls, "no ls reached the daemon");
    assert.equal(ls.args?.at(-1), piSessionWorkspaceDir(REMOTE_CWD));
    assert.ok(
      typeof ls.timeoutMs === "number" && ls.timeoutMs > 0,
      `the ls child must carry its own deadline, got: ${ls.timeoutMs}`,
    );
  });

  it("captures the existing boundary with metadata and no transcript download", async () => {
    const content = errorTranscript(REMOTE_CWD, "sess-a", RATE_LIMIT_ERROR);
    const { sandbox, runProcessCalls, readPaths } = fakeRemoteSandbox([
      [piTranscriptFileName("sess-a"), { content }],
    ]);

    assert.deepEqual(
      await capturePiTranscriptCursor(REMOTE_CWD, "sess-a", { sandbox }),
      {
        sessionId: "sess-a",
        fileName: piTranscriptFileName("sess-a"),
        offset: new TextEncoder().encode(content).length,
      },
    );
    assert.ok(runProcessCalls.some((call) => call.command === "stat"));
    assert.deepEqual(readPaths, []);
  });

  it("rejects an empty stat result instead of treating the transcript as new", async () => {
    const { sandbox } = fakeRemoteSandbox([
      [
        piTranscriptFileName("sess-a"),
        {
          content: errorTranscript(REMOTE_CWD, "sess-a", RATE_LIMIT_ERROR),
          statOutput: "",
        },
      ],
    ]);

    assert.equal(
      await capturePiTranscriptCursor(REMOTE_CWD, "sess-a", { sandbox }),
      undefined,
    );
  });

  it("lets the newest owning transcript decide even when an older one holds an error", async () => {
    // The current session ended cleanly; only a PREVIOUS session of the same workspace failed.
    // Surfacing that older error would invent a failure this turn did not have.
    const { sandbox } = fakeRemoteSandbox([
      [
        piTranscriptFileName("sess-new"),
        { content: successTranscript(REMOTE_CWD, "sess-new") },
      ],
      [
        piTranscriptFileName("sess-old"),
        { content: errorTranscript(REMOTE_CWD, "sess-old", RATE_LIMIT_ERROR) },
      ],
    ]);

    assert.equal(
      await findSwallowedPiError(REMOTE_CWD, newTurnCursor("sess-new"), {
        sandbox,
      }),
      undefined,
    );
  });

  it("skips a foreign transcript to the newest one this run owns", async () => {
    // A transcript stamped with another workspace's cwd is stale or copied, never a candidate;
    // stepping past it to this run's own newest transcript is not a stale fallback.
    const { sandbox } = fakeRemoteSandbox([
      [
        piTranscriptFileName("sess-foreign"),
        {
          content: errorTranscript(
            REMOTE_CWD,
            "sess-foreign",
            "foreign boom",
            "/tmp/other-cwd",
          ),
        },
      ],
      [
        piTranscriptFileName("sess-mine"),
        { content: errorTranscript(REMOTE_CWD, "sess-mine", RATE_LIMIT_ERROR) },
      ],
    ]);

    assert.equal(
      await findSwallowedPiError(REMOTE_CWD, newTurnCursor("sess-mine"), {
        sandbox,
      }),
      RATE_LIMIT_ERROR,
    );
  });

  it("recovers nothing when the newest transcript cannot be read", async () => {
    // With the newest candidate unreadable, which transcript is "the newest this run owns"
    // cannot be established — an older sibling must not supply this turn's error.
    const { sandbox } = fakeRemoteSandbox([
      [piTranscriptFileName("sess-new"), { unreadable: true }],
      [
        piTranscriptFileName("sess-old"),
        { content: errorTranscript(REMOTE_CWD, "sess-old", RATE_LIMIT_ERROR) },
      ],
    ]);

    assert.equal(
      await findSwallowedPiError(REMOTE_CWD, newTurnCursor("sess-new"), {
        sandbox,
      }),
      undefined,
    );
  });

  it("recovers nothing when the transcript's final record is partially written", async () => {
    // A truncated trailing record means the transcript's end is not trustworthy; the reader
    // must not step over it to the older error record above.
    const partial =
      errorTranscript(REMOTE_CWD, "sess-partial", RATE_LIMIT_ERROR) +
      '{"type":"message","message":{"role":"assistant"';
    const { sandbox } = fakeRemoteSandbox([
      [piTranscriptFileName("sess-partial"), { content: partial }],
    ]);

    assert.equal(
      await findSwallowedPiError(REMOTE_CWD, newTurnCursor("sess-partial"), {
        sandbox,
      }),
      undefined,
    );
  });

  it("resolves within its deadline when a read hangs", async () => {
    const { sandbox } = fakeRemoteSandbox([
      [piTranscriptFileName("sess-hang"), { hang: true }],
    ]);

    const startedAt = Date.now();
    assert.equal(
      await findSwallowedPiError(REMOTE_CWD, newTurnCursor("sess-hang"), {
        sandbox,
        timeoutMs: 50,
      }),
      undefined,
    );
    // Generous ceiling for a slow CI box; the point is that a stalled daemon response cannot
    // hold the turn (and with it, sandbox teardown) open past the probe's deadline.
    assert.ok(
      Date.now() - startedAt < 5_000,
      "the probe must resolve by its deadline, not wait on the read",
    );
  });
});
