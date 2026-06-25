/**
 * Unit tests for the user-declared MCP server conversion — stdio delivery now DISABLED.
 *
 * `resolve_mcp_servers` (Python) still emits the McpServerConfig wire shape and the wire shape
 * is unchanged. The sidecar, however, no longer delivers stdio MCP servers: a stdio server runs
 * an arbitrary process on the RUNNER HOST, outside the sandbox boundary, so the implementation
 * is disabled (parity with the removed code execution) until its security is fixed. Converting a
 * stdio server now throws `MCP_UNSUPPORTED_MESSAGE`; remote (`http`) and command-less stdio
 * servers were never delivered over ACP and are still skipped, so an all-remote request stays a
 * no-op.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/mcp-servers.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { toAcpMcpServers } from "../../src/engines/sandbox_agent.ts";
import { MCP_UNSUPPORTED_MESSAGE } from "../../src/tools/mcp-bridge.ts";
import type { McpServerConfig } from "../../src/protocol.ts";

describe("toAcpMcpServers (stdio disabled)", () => {
  it("maps empty input to []", () => {
    assert.deepEqual(toAcpMcpServers(undefined), [], "undefined -> []");
    assert.deepEqual(toAcpMcpServers([]), [], "[] -> []");
  });

  it("throws the unsupported error for a stdio server", () => {
    const servers: McpServerConfig[] = [
      {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x", LOG_LEVEL: "info" },
      },
    ];
    assert.throws(
      () => toAcpMcpServers(servers),
      new RegExp(MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("skips remote/http and command-less stdio servers without throwing", () => {
    const out = toAcpMcpServers([
      { name: "remote", transport: "http", url: "https://example.com/mcp" },
      { name: "broken", transport: "stdio" }, // no command -> never launched, skipped
    ]);
    assert.deepEqual(
      out,
      [],
      "http + command-less stdio both skipped, no throw",
    );
  });
});
