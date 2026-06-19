/**
 * Unit tests for the user-declared MCP server conversion (Agent B's Slice 4, wired in rivet).
 *
 * Agent B's `resolve_mcp_servers` emits the McpServerConfig wire shape
 * ({name,transport,command,args,env,url?,tools?}, env as a Record), pinned in the Python
 * test_wire_contract. This covers the TS half: converting that to the ACP stdio entry the
 * session consumes (env as a {name,value} list), skipping remote/http, and not enforcing the
 * per-server tools allowlist over ACP in v1.
 *
 * Run: pnpm exec tsx test/mcp-servers.test.ts
 */
import assert from "node:assert/strict";

import { toAcpMcpServers } from "../src/engines/rivet.ts";
import type { McpServerConfig } from "../src/protocol.ts";

assert.deepEqual(toAcpMcpServers(undefined), [], "undefined -> []");
assert.deepEqual(toAcpMcpServers([]), [], "[] -> []");

// stdio server: env Record -> ACP {name,value} list; defaults applied.
{
  const servers: McpServerConfig[] = [
    {
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x", LOG_LEVEL: "info" },
      tools: ["create_issue"], // allowlist not enforced over ACP v1 (logged), server still delivered
    },
  ];
  const out = toAcpMcpServers(servers);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "github");
  assert.equal(out[0].command, "npx");
  assert.deepEqual(out[0].args, ["-y", "@modelcontextprotocol/server-github"]);
  assert.deepEqual(out[0].env, [
    { name: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "ghp_x" },
    { name: "LOG_LEVEL", value: "info" },
  ]);
}

// remote/http is skipped (no auth on the wire by design); stdio without command is skipped.
{
  const out = toAcpMcpServers([
    { name: "remote", transport: "http", url: "https://example.com/mcp" },
    { name: "broken", transport: "stdio" }, // no command
  ]);
  assert.deepEqual(out, [], "http + command-less stdio both skipped");
}

// missing env / args default to empty.
{
  const out = toAcpMcpServers([{ name: "fs", transport: "stdio", command: "mcp-fs" }]);
  assert.deepEqual(out, [{ name: "fs", command: "mcp-fs", args: [], env: [] }]);
}

console.log("mcp-servers.test.ts: all assertions passed");
