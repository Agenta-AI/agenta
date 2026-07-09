/**
 * Unit tests for the Pi approval-gate envelope (the one sandbox-internal contract) and the
 * runner-side classification of a Pi dialog gate into a GateDescriptor.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/pi-gate-envelope.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildPiGateEnvelope,
  parsePiGateEnvelope,
  PI_GATE_DIALOG_TITLE,
  type PiGateEnvelope,
} from "../../src/engines/sandbox_agent/pi-gate-envelope.ts";
import { buildPiGateDescriptor } from "../../src/engines/sandbox_agent/acp-interactions.ts";

/** Wrap an envelope string the way the pi-acp bridge delivers it on an ACP permission request. */
function asRequest(message: unknown, title = PI_GATE_DIALOG_TITLE) {
  return {
    id: "perm-1",
    availableReplies: ["once", "reject"],
    toolCall: {
      toolCallId: "pi-ui-synthetic",
      title,
      rawInput: { method: "confirm", title, message },
    },
  };
}

describe("pi-gate-envelope build/parse round-trip", () => {
  it("round-trips a custom-tool gate byte-exact, including hostile strings", () => {
    const input = {
      token: "TOKEN-ALLOW-a1b2",
      probe: 'quotes"and\\back\\slashes and 日本語 and \n newline',
    };
    const message = buildPiGateEnvelope({
      gate: "pi-custom-tool",
      toolName: "park_probe",
      toolCallId: "call_6JFT|fc_0d79",
      input,
    });
    const result = parsePiGateEnvelope(asRequest(message));
    assert.equal(result.matched, true);
    assert.ok(result.matched && result.envelope);
    const envelope = (result as { envelope: PiGateEnvelope }).envelope;
    assert.equal(envelope.gate, "pi-custom-tool");
    assert.equal(envelope.toolName, "park_probe");
    assert.equal(envelope.toolCallId, "call_6JFT|fc_0d79");
    assert.deepEqual(envelope.input, input);
  });

  it("round-trips a builtin gate", () => {
    const message = buildPiGateEnvelope({
      gate: "pi-builtin",
      toolName: "bash",
      toolCallId: "call_x",
      input: { command: "ls" },
    });
    const result = parsePiGateEnvelope(asRequest(message));
    assert.ok(result.matched && result.envelope);
    assert.equal(result.envelope!.gate, "pi-builtin");
    assert.equal(result.envelope!.toolName, "bash");
  });
});

describe("parsePiGateEnvelope classification", () => {
  it("a non-matching dialog title is NOT a Pi gate (takes today's path)", () => {
    const message = buildPiGateEnvelope({
      gate: "pi-builtin",
      toolName: "bash",
      toolCallId: "call_x",
      input: {},
    });
    const result = parsePiGateEnvelope(asRequest(message, "some-other-title"));
    assert.deepEqual(result, { matched: false });
  });

  it("a plain Claude ACP gate (no dialog title) is not matched", () => {
    const result = parsePiGateEnvelope({
      id: "perm-1",
      toolCall: { toolCallId: "tc-1", title: "commit", rawInput: { a: 1 } },
    });
    assert.deepEqual(result, { matched: false });
  });

  it("matched title with unparseable JSON fails closed (matched, no envelope)", () => {
    const result = parsePiGateEnvelope(asRequest("{not json"));
    assert.equal(result.matched, true);
    assert.equal((result as { envelope?: unknown }).envelope, undefined);
  });

  it("matched title with wrong kind fails closed", () => {
    const bad = JSON.stringify({
      v: 1,
      kind: "something.else",
      gate: "pi-builtin",
      toolName: "bash",
      toolCallId: "c",
      input: {},
    });
    const result = parsePiGateEnvelope(asRequest(bad));
    assert.equal(result.matched, true);
    assert.equal((result as { envelope?: unknown }).envelope, undefined);
  });

  it("matched title with wrong version fails closed", () => {
    const bad = JSON.stringify({
      v: 2,
      kind: "agenta.gate",
      gate: "pi-builtin",
      toolName: "bash",
      toolCallId: "c",
      input: {},
    });
    const result = parsePiGateEnvelope(asRequest(bad));
    assert.equal(result.matched, true);
    assert.equal((result as { envelope?: unknown }).envelope, undefined);
  });

  it("matched title with unknown gate kind fails closed", () => {
    const bad = JSON.stringify({
      v: 1,
      kind: "agenta.gate",
      gate: "pi-something",
      toolName: "bash",
      toolCallId: "c",
      input: {},
    });
    const result = parsePiGateEnvelope(asRequest(bad));
    assert.equal(result.matched, true);
    assert.equal((result as { envelope?: unknown }).envelope, undefined);
  });

  it("matched title missing identity (no toolName / no toolCallId) fails closed", () => {
    for (const bad of [
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-builtin",
        toolCallId: "c",
        input: {},
      },
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-builtin",
        toolName: "bash",
        input: {},
      },
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-builtin",
        toolName: "bash",
        toolCallId: "c",
      },
    ]) {
      const result = parsePiGateEnvelope(asRequest(JSON.stringify(bad)));
      assert.equal(result.matched, true);
      assert.equal((result as { envelope?: unknown }).envelope, undefined);
    }
  });
});

describe("buildPiGateDescriptor (runner-side metadata recovery)", () => {
  it("pi-builtin -> harness executor with the builtin's rule name and read-only hint", () => {
    const readGate = buildPiGateDescriptor(
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-builtin",
        toolName: "read",
        toolCallId: "c",
        input: { path: "a" },
      },
      undefined,
    );
    assert.equal(readGate!.executor, "harness");
    assert.equal(readGate!.toolName, "Read");
    assert.equal(readGate!.readOnlyHint, true);

    const bashGate = buildPiGateDescriptor(
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-builtin",
        toolName: "bash",
        toolCallId: "c",
        input: { command: "ls" },
      },
      undefined,
    );
    assert.equal(bashGate!.toolName, "Bash");
    assert.equal(bashGate!.readOnlyHint, false);
  });

  it("pi-custom-tool -> relay executor with author permission + readOnly recovered by name", () => {
    const specs = new Map([
      ["author_allow", { permission: "allow" as const, readOnly: false }],
      ["author_deny", { permission: "deny" as const, readOnly: false }],
      ["reader", { readOnly: true }],
    ]);
    const allow = buildPiGateDescriptor(
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-custom-tool",
        toolName: "author_allow",
        toolCallId: "c",
        input: {},
      },
      specs,
    );
    assert.equal(allow!.executor, "relay");
    assert.equal(allow!.specPermission, "allow");

    const deny = buildPiGateDescriptor(
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-custom-tool",
        toolName: "author_deny",
        toolCallId: "c",
        input: {},
      },
      specs,
    );
    assert.equal(deny!.specPermission, "deny");

    const reader = buildPiGateDescriptor(
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-custom-tool",
        toolName: "reader",
        toolCallId: "c",
        input: {},
      },
      specs,
    );
    assert.equal(reader!.specPermission, undefined);
    assert.equal(reader!.readOnlyHint, true);
  });

  it("the envelope input is the gate args (stored-decision key parity with the relay)", () => {
    const g = buildPiGateDescriptor(
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-custom-tool",
        toolName: "t",
        toolCallId: "c",
        input: { a: 1, b: 2 },
      },
      new Map(),
    );
    assert.deepEqual(g!.args, { a: 1, b: 2 });
  });

  it("an unknown builtin name yields NO descriptor (the caller must reject it)", () => {
    // Relay parity: the relay denies unknown builtins outright, and the sandbox-origin envelope
    // must not put a fabricated name on the approval card.
    const g = buildPiGateDescriptor(
      {
        v: 1,
        kind: "agenta.gate",
        gate: "pi-builtin",
        toolName: "fabricated_tool",
        toolCallId: "c",
        input: {},
      },
      undefined,
    );
    assert.equal(g, undefined);
  });
});
