/**
 * Unit tests for sandbox-agent capability mapping, the fail-loud capability gate, and the
 * debug assertions.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-capabilities.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { ResolvedToolSpec } from "../../src/protocol.ts";
import {
  assert as invariant,
  assertRequiredCapabilities,
  mapCapabilities,
  probeCapabilities,
  type ProbedCapabilities,
} from "../../src/engines/sandbox_agent/capabilities.ts";

describe("mapCapabilities", () => {
  it("maps probed sandbox-agent capabilities, always enables usage, marks the source probed", () => {
    const out = mapCapabilities("claude", {
      capabilities: {
        textMessages: false,
        images: true,
        fileAttachments: true,
        mcpTools: true,
        toolCalls: true,
        reasoning: true,
        planMode: true,
        permissions: true,
        streamingDeltas: true,
        sessionLifecycle: true,
      },
    });
    assert.equal(out.source, "probed");
    assert.deepEqual(out.capabilities, {
      textMessages: false,
      images: true,
      fileAttachments: true,
      mcpTools: true,
      toolCalls: true,
      reasoning: true,
      planMode: true,
      permissions: true,
      streamingDeltas: true,
      sessionLifecycle: true,
      usage: true,
    });
  });

  it("falls back to no MCP for Pi and MCP for non-Pi harnesses, marked static", () => {
    const pi = mapCapabilities("pi", undefined);
    assert.equal(pi.source, "static");
    assert.equal(pi.capabilities.mcpTools, false);

    const claude = mapCapabilities("claude", undefined);
    assert.equal(claude.source, "static");
    assert.equal(claude.capabilities.mcpTools, true);
  });

  it("opencode static fallback: mcpTools true, planMode false (daemon skips set_mode for it)", () => {
    const opencode = mapCapabilities("opencode", undefined);
    assert.equal(opencode.source, "static");
    assert.equal(opencode.capabilities.mcpTools, true);
    assert.equal(opencode.capabilities.planMode, false);
  });

  it("invariant: rejects an empty harness id", () => {
    assert.throws(() => mapCapabilities("", undefined), /non-empty harness id/);
  });

  it("invariant: rejects a non-object probed capabilities payload", () => {
    assert.throws(
      () => mapCapabilities("claude", { capabilities: "yes" }),
      /not an object/,
    );
  });
});

describe("probeCapabilities", () => {
  it("uses the daemon probe when available and reports the source", async () => {
    const sandbox = {
      getAgent: async () => ({
        capabilities: { mcpTools: true, permissions: true, toolCalls: true },
      }),
    };

    const out = await probeCapabilities(sandbox, "claude");
    assert.equal(out.source, "probed");
    assert.equal(out.capabilities.mcpTools, true);
    assert.equal(out.capabilities.permissions, true);
  });

  it("uses static fallback when probing fails", async () => {
    const sandbox = {
      getAgent: async () => {
        throw new Error("daemon unavailable");
      },
    };

    const out = await probeCapabilities(sandbox, "pi");
    assert.equal(out.source, "static");
    assert.equal(out.capabilities.mcpTools, false);
  });

  it("returns a complete boolean-valued flag set even when the probe omits flags", async () => {
    const sandbox = {
      // A partial probe payload: every absent flag must still come back a boolean.
      getAgent: async () => ({ capabilities: { mcpTools: true } }),
    };
    const out = await probeCapabilities(sandbox, "claude");
    for (const value of Object.values(out.capabilities)) {
      assert.equal(typeof value, "boolean");
    }
  });

  it("invariant: rejects a sandbox without getAgent", async () => {
    await assert.rejects(
      () => probeCapabilities({}, "claude"),
      /requires a sandbox with getAgent/,
    );
  });
});

function probed(
  flags: Record<string, boolean>,
  source: "probed" | "static" = "probed",
): ProbedCapabilities {
  return { source, capabilities: flags as any };
}

const tool: ResolvedToolSpec = { name: "server_tool", kind: "callback" };

describe("assertRequiredCapabilities (fail loud on tool delivery)", () => {
  it("passes a non-Pi harness that advertises mcpTools + toolCalls", () => {
    assert.doesNotThrow(() =>
      assertRequiredCapabilities({
        harness: "claude",
        isPi: false,
        probed: probed({ mcpTools: true, toolCalls: true }),
        toolSpecs: [tool],
      }),
    );
  });

  it("throws a specific error when the harness lacks mcpTools", () => {
    assert.throws(
      () =>
        assertRequiredCapabilities({
          harness: "claude",
          isPi: false,
          probed: probed({ mcpTools: false, toolCalls: true }),
          toolSpecs: [tool],
        }),
      /harness 'claude' cannot receive tools.*mcpTools:false.*1 tool/s,
    );
  });

  it("throws naming both missing flags when neither is advertised", () => {
    assert.throws(
      () =>
        assertRequiredCapabilities({
          harness: "codex",
          isPi: false,
          probed: probed({ mcpTools: false, toolCalls: false }),
          toolSpecs: [tool, { name: "second", kind: "callback" }],
        }),
      /mcpTools:false, toolCalls:false.*2 tool/s,
    );
  });

  it("exempts Pi (tools ride its native extension, not the probed MCP flags)", () => {
    assert.doesNotThrow(() =>
      assertRequiredCapabilities({
        harness: "pi_core",
        isPi: true,
        probed: probed({ mcpTools: false, toolCalls: false }),
        toolSpecs: [tool],
      }),
    );
  });

  it("is a no-op when the run carries no tools", () => {
    assert.doesNotThrow(() =>
      assertRequiredCapabilities({
        harness: "claude",
        isPi: false,
        probed: probed({ mcpTools: false, toolCalls: false }),
        toolSpecs: [],
      }),
    );
  });

  it("logs the source so a failed-probe static guess is debuggable", () => {
    const logs: string[] = [];
    assert.throws(() =>
      assertRequiredCapabilities({
        harness: "claude",
        isPi: false,
        probed: probed({ mcpTools: false, toolCalls: true }, "static"),
        toolSpecs: [tool],
        log: (m) => logs.push(m),
      }),
    );
    assert.ok(logs.some((m) => m.includes("(static)")));
  });
});

describe("assert (debug invariant)", () => {
  it("throws a prefixed message when the condition is false", () => {
    assert.throws(
      () => invariant(false, "boom"),
      /\[sandbox-agent invariant\] boom/,
    );
  });

  it("does nothing when the condition holds", () => {
    assert.doesNotThrow(() => invariant(true, "fine"));
  });
});
