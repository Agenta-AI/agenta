/**
 * Unit tests for buildToolMcpServers — the stdio tool MCP bridge, now DISABLED in the sidecar.
 *
 * The bridge used to launch a stdio MCP child process on the runner host to expose resolved
 * tools to non-Pi harnesses. That process ran outside the sandbox boundary (the same
 * runner-host execution bypass that had code execution removed), so the implementation is
 * disabled until its security is fixed. The interface/types remain, but delivering any
 * executable spec now throws `MCP_UNSUPPORTED_MESSAGE`. The no-tools path (empty or
 * client-only specs) stays a no-op so non-tool runs are untouched.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-bridge.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildToolMcpServers,
  MCP_UNSUPPORTED_MESSAGE,
} from "../../src/tools/mcp-bridge.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

const relayDir = "/tmp/agenta-tools";

describe("buildToolMcpServers (disabled)", () => {
  it("throws the unsupported error for a code-only run", () => {
    const specs: ResolvedToolSpec[] = [
      {
        name: "adder",
        description: "Add numbers",
        kind: "code",
        runtime: "python",
        code: "def main(**k): return 1",
        env: { PRIVATE: "secret" },
      },
    ];
    assert.throws(
      () => buildToolMcpServers(specs, relayDir),
      new RegExp(MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("throws the unsupported error for a callback run", () => {
    const specs: ResolvedToolSpec[] = [
      { name: "search", kind: "callback", callRef: "composio.search" },
    ];
    assert.throws(
      () =>
        buildToolMcpServers(
          specs,
          {
            endpoint: "https://agenta.example/tools/call",
            authorization: "Bearer tok",
          },
          relayDir,
        ),
      new RegExp(MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("throws for an absent-kind (back-compat callback) run", () => {
    const specs: ResolvedToolSpec[] = [
      { name: "legacy", callRef: "composio.legacy" },
    ];
    assert.throws(
      () =>
        buildToolMcpServers(
          specs,
          { endpoint: "https://agenta.example/tools/call" },
          relayDir,
        ),
      new RegExp(MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("throws for a mixed code+callback run", () => {
    const specs: ResolvedToolSpec[] = [
      {
        name: "adder",
        kind: "code",
        runtime: "python",
        code: "def main(**k): return 1",
      },
      { name: "search", kind: "callback", callRef: "composio.search" },
    ];
    assert.throws(
      () => buildToolMcpServers(specs, relayDir),
      new RegExp(MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("returns [] for empty specs (no-tools path untouched)", () => {
    assert.deepEqual(
      buildToolMcpServers([], undefined),
      [],
      "empty specs -> []",
    );
  });

  it("returns [] for client-only specs (nothing executable, never goes through the bridge)", () => {
    const specs: ResolvedToolSpec[] = [{ name: "confirm", kind: "client" }];
    assert.deepEqual(
      buildToolMcpServers(specs, undefined),
      [],
      "client-only -> [] (nothing executable here)",
    );
    assert.deepEqual(
      buildToolMcpServers(
        specs,
        { endpoint: "https://agenta.example/tools/call" },
        relayDir,
      ),
      [],
      "client-only -> [] even with an endpoint",
    );
  });

  it("throws when an executable spec sits beside a client spec", () => {
    const specs: ResolvedToolSpec[] = [
      { name: "confirm", kind: "client" },
      {
        name: "adder",
        kind: "code",
        runtime: "python",
        code: "def main(**k): return 1",
      },
    ];
    assert.throws(
      () => buildToolMcpServers(specs, relayDir),
      new RegExp(MCP_UNSUPPORTED_MESSAGE),
    );
  });
});
