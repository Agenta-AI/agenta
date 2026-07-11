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
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  publishRelayRequest,
  relayToolCall,
  waitForRelayResponse,
} from "../../src/tools/relay-client.ts";
import {
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  serializeRelayRequest,
} from "../../src/tools/relay-protocol.ts";

const tempDir = () => mkdtempSync(join(tmpdir(), "agenta-relay-client-test-"));

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
