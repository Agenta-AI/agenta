import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  isPiTraceSpoolFileName,
  parsePiTurnTraceControl,
  piTraceFileName,
} from "../../src/tracing/pi-spool-protocol.ts";

const CHANNEL = "0123456789abcdef0123456789abcdef";

describe("Pi trace spool protocol", () => {
  it("parses the bounded per-turn control contract", () => {
    assert.deepEqual(
      parsePiTurnTraceControl({
        version: 1,
        channelId: CHANNEL,
        turnId: "turn-1",
        sessionId: "session-1",
        propagation: { traceparent: "00-a-b-01", baggage: "tenant=x" },
        capture: { content: false },
        skills: ["one", 2, "two"],
        redaction: { knownValues: ["secret-value", null] },
      }),
      {
        version: 1,
        channelId: CHANNEL,
        turnId: "turn-1",
        sessionId: "session-1",
        propagation: { traceparent: "00-a-b-01", baggage: "tenant=x" },
        capture: { content: false },
        skills: ["one", "two"],
        redaction: { knownValues: ["secret-value"] },
      },
    );
  });

  it("rejects unknown versions and malformed channel ids", () => {
    assert.throws(
      () => parsePiTurnTraceControl({ version: 2, channelId: CHANNEL }),
      /Unsupported Pi trace control version/,
    );
    assert.throws(
      () => parsePiTurnTraceControl({ version: 1, channelId: "../escape" }),
      /channelId is invalid/,
    );
  });

  it("recognizes only owned control, final, and temporary files", () => {
    const final = piTraceFileName(CHANNEL, 3);
    assert.equal(final, `${CHANNEL}.3.otlp.pb`);
    assert.equal(isPiTraceSpoolFileName("current.control.json"), true);
    assert.equal(isPiTraceSpoolFileName(final), true);
    assert.equal(isPiTraceSpoolFileName(`${final}.tmp.nonce`), true);
    assert.equal(isPiTraceSpoolFileName("unrelated.txt"), false);
    assert.equal(isPiTraceSpoolFileName("../escape.0.otlp.pb"), false);
  });
});
