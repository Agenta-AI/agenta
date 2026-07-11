/**
 * Unit tests for the in-sandbox relay writer client (tools/relay-client.ts) and the
 * wire protocol it writes (tools/relay-protocol.ts).
 *
 * The golden test pins the exact request-file bytes; the rest exercise the writer's
 * round-trip, error, abort, and timeout behavior against a real temp dir (no network,
 * no harness — the test plays the runner side by writing the `.res.json` file).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/relay-client.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRelayDirWatch,
  publishRelayRequest,
  relayToolCall,
  waitForRelayResponse,
} from "../../src/tools/relay-client.ts";
import {
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  relayTempPath,
  serializeRelayRequest,
  sleep,
} from "../../src/tools/relay-protocol.ts";

const tempDir = () => mkdtempSync(join(tmpdir(), "agenta-relay-client-test-"));

const WATCH_FLAG = "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED";

/** Publish a response file the atomic way the runner now does: temp write + rename. */
function publishResponseAtomically(resPath: string, res: unknown): void {
  const tmpPath = relayTempPath(resPath);
  writeFileSync(tmpPath, JSON.stringify(res), "utf-8");
  renameSync(tmpPath, resPath);
}

describe("serializeRelayRequest / publishRelayRequest (golden request bytes)", () => {
  // These bytes are the cross-writer contract (Pi extension, local Claude loopback,
  // future MCP shim per #5234); changing them breaks this golden ON PURPOSE. Key order
  // is toolName, toolCallId, args; args keys keep their insertion order.
  const golden =
    '{"toolName":"x","toolCallId":"call-1","args":{"b":2,"a":"1"}}';

  it("serializes the exact golden bytes", () => {
    const out = serializeRelayRequest({
      toolName: "x",
      toolCallId: "call-1",
      args: { b: 2, a: "1" },
    });
    assert.equal(out, golden);
  });

  it("writes byte-identical content to disk", () => {
    const dir = tempDir();
    try {
      const { reqPath, resPath } = publishRelayRequest(dir, {
        toolName: "x",
        toolCallId: "call-1",
        args: { b: 2, a: "1" },
      });
      assert.equal(reqPath, join(dir, `call-1${RELAY_REQ_SUFFIX}`));
      assert.equal(resPath, join(dir, `call-1${RELAY_RES_SUFFIX}`));
      assert.equal(readFileSync(reqPath, "utf-8"), golden);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults missing args to an empty object", () => {
    const out = serializeRelayRequest({
      toolName: "x",
      toolCallId: "call-1",
      args: undefined,
    });
    assert.equal(out, '{"toolName":"x","toolCallId":"call-1","args":{}}');
  });
});

describe("relayToolCall (writer round-trip)", () => {
  it("returns the response text and deletes both files", async () => {
    const dir = tempDir();
    try {
      const reqPath = join(dir, `call-rt${RELAY_REQ_SUFFIX}`);
      const resPath = join(dir, `call-rt${RELAY_RES_SUFFIX}`);
      // Play the runner: answer shortly after the request file appears.
      setTimeout(() => {
        assert.ok(
          existsSync(reqPath),
          "request file was written before the response",
        );
        writeFileSync(
          resPath,
          JSON.stringify({ ok: true, text: "round-trip-ok" }),
        );
      }, 50);
      const out = await relayToolCall(dir, "myTool", "call-rt", { a: 1 });
      assert.equal(out, "round-trip-ok");
      assert.ok(!existsSync(reqPath), "request file was cleaned up");
      assert.ok(!existsSync(resPath), "response file was cleaned up");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects with the response error message on ok:false", async () => {
    const dir = tempDir();
    try {
      const resPath = join(dir, `call-err${RELAY_RES_SUFFIX}`);
      writeFileSync(
        resPath,
        JSON.stringify({ ok: false, error: "boom from runner" }),
      );
      await assert.rejects(
        () => relayToolCall(dir, "myTool", "call-err", {}),
        /boom from runner/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects with 'aborted' on an already-aborted signal", async () => {
    const dir = tempDir();
    try {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        () =>
          relayToolCall(
            dir,
            "myTool",
            "call-abort",
            {},
            undefined,
            controller.signal,
          ),
        /^Error: aborted$/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("waitForRelayResponse", () => {
  // relayToolCall adds +10s to any positive timeoutMs (per-tool grace), so the timeout
  // path is tested here directly with a tiny deadline instead.
  it("throws a timeout error when no response appears before the deadline", async () => {
    const dir = tempDir();
    try {
      const resPath = join(dir, `never${RELAY_RES_SUFFIX}`);
      await assert.rejects(
        () => waitForRelayResponse(resPath, { timeoutMs: 50 }),
        /tool relay timed out/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("waitForRelayResponse (hop-1 response watch)", () => {
  it("a directory event wakes it well before one poll interval", async () => {
    const dir = tempDir();
    try {
      const resPath = join(dir, `call-watch${RELAY_RES_SUFFIX}`);
      setTimeout(() => {
        publishResponseAtomically(resPath, { ok: true, text: "watched" });
      }, 50);
      const started = Date.now();
      const res = await waitForRelayResponse(resPath, { timeoutMs: 5000 });
      const elapsed = Date.now() - started;
      assert.equal(res.ok, true);
      assert.equal(res.text, "watched");
      // The response landed at ~50 ms; the plain poll would sleep a full RELAY_POLL_MS
      // (300 ms) before re-checking, so finishing well under one interval proves the
      // watch — not the poll — woke the waiter. The bound derives from RELAY_POLL_MS so
      // the test keeps its meaning if CI ever overrides the poll cadence env.
      assert.ok(
        elapsed < RELAY_POLL_MS - 50,
        `expected a watch wake well under RELAY_POLL_MS (${RELAY_POLL_MS} ms), took ${elapsed} ms`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves immediately when the response pre-exists (arm-before-check order)", async () => {
    const dir = tempDir();
    try {
      const resPath = join(dir, `call-pre${RELAY_RES_SUFFIX}`);
      publishResponseAtomically(resPath, { ok: true, text: "already-there" });
      const started = Date.now();
      const res = await waitForRelayResponse(resPath, { timeoutMs: 5000 });
      assert.equal(res.text, "already-there");
      assert.ok(
        Date.now() - started < 100,
        "no wait at all for an existing file",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a pre-aborted signal still rejects 'aborted' with the watch armed", async () => {
    const dir = tempDir();
    try {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        () =>
          waitForRelayResponse(join(dir, `call-a${RELAY_RES_SUFFIX}`), {
            timeoutMs: 5000,
            signal: controller.signal,
          }),
        /^Error: aborted$/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("watch disabled via env: a later-arriving response is still picked up by the poll", async () => {
    const dir = tempDir();
    const previous = process.env[WATCH_FLAG];
    process.env[WATCH_FLAG] = "false";
    try {
      const resPath = join(dir, `call-poll${RELAY_RES_SUFFIX}`);
      setTimeout(() => {
        publishResponseAtomically(resPath, { ok: true, text: "polled" });
      }, 100);
      const res = await waitForRelayResponse(resPath, { timeoutMs: 5000 });
      assert.equal(res.text, "polled");
    } finally {
      if (previous === undefined) delete process.env[WATCH_FLAG];
      else process.env[WATCH_FLAG] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("watch disabled via env: a pre-existing response resolves", async () => {
    const dir = tempDir();
    const previous = process.env[WATCH_FLAG];
    process.env[WATCH_FLAG] = "false";
    try {
      const resPath = join(dir, `call-poll-pre${RELAY_RES_SUFFIX}`);
      publishResponseAtomically(resPath, { ok: true, text: "pre" });
      const res = await waitForRelayResponse(resPath, { timeoutMs: 5000 });
      assert.equal(res.text, "pre");
    } finally {
      if (previous === undefined) delete process.env[WATCH_FLAG];
      else process.env[WATCH_FLAG] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createRelayDirWatch (coalescing invariants)", () => {
  it("returns undefined when fs.watch throws (missing dir) so callers degrade to the poll", () => {
    assert.equal(
      createRelayDirWatch(join(tmpdir(), "agenta-relay-no-such-dir-xyz")),
      undefined,
    );
  });

  it("an event with no waiter sticks: the next wait resolves 'activity', the one after times out", async () => {
    const dir = tempDir();
    const dirWatch = createRelayDirWatch(dir);
    try {
      assert.ok(dirWatch, "watch armed on an existing dir");
      writeFileSync(join(dir, "poke.txt"), "x", "utf-8");
      await sleep(50); // let the event deliver while NO waiter is armed
      assert.equal(await dirWatch.wait(50), "activity");
      assert.equal(
        await dirWatch.wait(30),
        "timeout",
        "sticky bit consumed once",
      );
    } finally {
      dirWatch?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hundreds of timer-win waits accumulate no listeners and the watch still wakes after", async () => {
    const dir = tempDir();
    const dirWatch = createRelayDirWatch(dir);
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => {
      if (warning.name === "MaxListenersExceededWarning")
        warnings.push(warning);
    };
    process.on("warning", onWarning);
    try {
      assert.ok(dirWatch, "watch armed on an existing dir");
      for (let i = 0; i < 200; i += 1) {
        assert.equal(await dirWatch.wait(1), "timeout");
      }
      assert.deepEqual(
        warnings,
        [],
        "200 consecutive timer wins emitted no MaxListenersExceededWarning",
      );
      const waiting = dirWatch.wait(2000);
      writeFileSync(join(dir, "poke.txt"), "x", "utf-8");
      assert.equal(
        await waiting,
        "activity",
        "the watch still wakes after the loop",
      );
    } finally {
      process.off("warning", onWarning);
      dirWatch?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("close() resolves an in-flight wait as a timer win and stops future waits", async () => {
    const dir = tempDir();
    const dirWatch = createRelayDirWatch(dir);
    try {
      assert.ok(dirWatch, "watch armed on an existing dir");
      const waiting = dirWatch.wait(60_000);
      dirWatch.close();
      assert.equal(await waiting, "timeout");
      assert.equal(await dirWatch.wait(1), "timeout");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
