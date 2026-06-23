/**
 * Unit tests for sandbox-agent capability mapping.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-capabilities.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  mapCapabilities,
  probeCapabilities,
} from "../../src/engines/sandbox_agent/capabilities.ts";

describe("mapCapabilities", () => {
  it("maps probed sandbox-agent capabilities and always enables usage", () => {
    assert.deepEqual(
      mapCapabilities("claude", {
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
      }),
      {
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
      },
    );
  });

  it("falls back to no MCP for Pi and MCP for non-Pi harnesses", () => {
    assert.equal(mapCapabilities("pi", undefined).mcpTools, false);
    assert.equal(mapCapabilities("claude", undefined).mcpTools, true);
  });
});

describe("probeCapabilities", () => {
  it("uses the daemon probe when available", async () => {
    const sandbox = {
      getAgent: async () => ({ capabilities: { mcpTools: true, permissions: true } }),
    };

    const out = await probeCapabilities(sandbox, "claude");
    assert.equal(out.mcpTools, true);
    assert.equal(out.permissions, true);
  });

  it("uses static fallback when probing fails", async () => {
    const sandbox = {
      getAgent: async () => {
        throw new Error("daemon unavailable");
      },
    };

    assert.equal((await probeCapabilities(sandbox, "pi")).mcpTools, false);
  });
});
