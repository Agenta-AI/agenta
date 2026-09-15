/**
 * Unit tests for MCP permission intake and per-tool resolution.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/mcp-permission-intake.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest, McpServerConfig } from "../../src/protocol.ts";
import {
  mcpPermissionsFromRequest,
  mcpToolPermission,
} from "../../src/engines/sandbox_agent/runtime-policy.ts";

function request(...servers: unknown[]): AgentRunRequest {
  return { mcpServers: servers as McpServerConfig[] } as AgentRunRequest;
}

function server(policy: unknown, name = "acme"): unknown {
  return { name, connection: { type: "http", url: "https://x/mcp" }, policy };
}

describe("mcpPermissionsFromRequest", () => {
  it("keeps a whole-server permission and declares no per-tool intent", () => {
    const table = mcpPermissionsFromRequest(
      request(server({ tools: { mode: "all" }, permission: "ask" })),
    );
    const entry = table.get("acme");
    assert.equal(entry?.server, "ask");
    assert.equal(entry?.newTool, undefined);
    assert.equal(entry?.tools.size, 0);
  });

  it("reads a per-tool table and its new-tool floor", () => {
    const table = mcpPermissionsFromRequest(
      request(
        server({
          tools: { mode: "all" },
          permission: "ask",
          toolPermissions: { search: "allow", purge: "deny" },
          newToolPermission: "ask",
        }),
      ),
    );
    const entry = table.get("acme");
    assert.equal(entry?.tools.get("search"), "allow");
    assert.equal(entry?.tools.get("purge"), "deny");
    assert.equal(entry?.newTool, "ask");
  });

  it("drops a malformed whole-server permission rather than trusting it", () => {
    // Dropping is never MORE permissive than the absent case, which already falls to the ladder.
    for (const permission of ["Deny", null, 1, ["deny"], undefined]) {
      const table = mcpPermissionsFromRequest(
        request(server({ tools: { mode: "all" }, permission })),
      );
      assert.equal(table.get("acme")?.server, undefined);
    }
  });

  it("drops a malformed per-tool entry so it falls to the new-tool floor", () => {
    const table = mcpPermissionsFromRequest(
      request(
        server({
          tools: { mode: "all" },
          toolPermissions: { search: "Allow", purge: "deny" },
          newToolPermission: "ask",
        }),
      ),
    );
    const entry = table.get("acme");
    assert.equal(entry?.tools.has("search"), false);
    assert.equal(mcpToolPermission(entry, "search"), "ask");
    assert.equal(mcpToolPermission(entry, "purge"), "deny");
  });

  it("denies when the sender declared a new-tool floor that is not a verdict", () => {
    // The wire is misdescribing its own shape. Do not guess a floor for someone who asked for a
    // restriction; an omitted floor is a different case and is covered below.
    const table = mcpPermissionsFromRequest(
      request(
        server({
          tools: { mode: "all" },
          toolPermissions: { search: "allow" },
          newToolPermission: "sometimes",
        }),
      ),
    );
    assert.equal(table.get("acme")?.newTool, "deny");
    assert.equal(mcpToolPermission(table.get("acme"), "search"), "allow");
  });

  it("asks when a readable table omits its new-tool floor entirely", () => {
    const table = mcpPermissionsFromRequest(
      request(
        server({
          tools: { mode: "all" },
          toolPermissions: { search: "allow" },
        }),
      ),
    );
    assert.equal(table.get("acme")?.newTool, "ask");
  });

  it("ignores an inherited key rather than reading it as configured", () => {
    const table = mcpPermissionsFromRequest(
      request(server({ tools: { mode: "all" }, toolPermissions: {} })),
    );
    const entry = table.get("acme");
    assert.equal(entry?.tools.has("toString"), false);
    // Opted in with an empty table: every tool is new, so every tool asks.
    assert.equal(mcpToolPermission(entry, "toString"), "ask");
  });

  it("skips a server with no usable name", () => {
    const table = mcpPermissionsFromRequest(
      request(server({ tools: { mode: "all" }, permission: "deny" }, "")),
    );
    assert.equal(table.size, 0);
  });
});

describe("mcpToolPermission", () => {
  const withTable = mcpPermissionsFromRequest(
    request(
      server({
        tools: { mode: "all" },
        permission: "allow",
        toolPermissions: { search: "allow", purge: "deny" },
        newToolPermission: "ask",
      }),
    ),
  ).get("acme");

  const serverOnly = mcpPermissionsFromRequest(
    request(server({ tools: { mode: "all" }, permission: "deny" })),
  ).get("acme");

  it("prefers the tool's own decision", () => {
    assert.equal(mcpToolPermission(withTable, "purge"), "deny");
  });

  it("gives a tool the table does not name the new-tool floor, not the server permission", () => {
    // The pin for the rule that makes a per-tool table worth writing: the server here says
    // `allow`, and a tool nobody listed still asks.
    assert.equal(mcpToolPermission(withTable, "exfiltrate"), "ask");
  });

  it("does not consult the run default for a server that has a table", () => {
    // `undefined` is the value that sends the caller to the rules/run-default ladder. A server
    // with a table must never return it, whatever tool is asked for.
    assert.notEqual(mcpToolPermission(withTable, "exfiltrate"), undefined);
    assert.notEqual(mcpToolPermission(withTable, undefined), undefined);
  });

  it("falls back to the whole-server permission when there is no table", () => {
    assert.equal(mcpToolPermission(serverOnly, "anything"), "deny");
  });

  it("returns undefined for an unconfigured server, so the existing ladder decides", () => {
    assert.equal(mcpToolPermission(undefined, "search"), undefined);
  });
});
