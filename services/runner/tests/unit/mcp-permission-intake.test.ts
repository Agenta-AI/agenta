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
import { resolveMcpToolName } from "../../src/engines/sandbox_agent/acp-interactions.ts";

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

describe("a declared but unreadable toolPermissions container (D9)", () => {
  for (const corrupt of ["", "echo", 42, ["echo"], null, true]) {
    it(`denies rather than silently dropping the table for ${JSON.stringify(corrupt)}`, () => {
      // The asymmetry this closes: `optedIn` used to be computed from what PARSED, so a
      // container that arrived as anything but an object made the whole per-tool table vanish
      // into the run's default permission — the opposite of what the sibling field does.
      const table = mcpPermissionsFromRequest(
        request(
          server({ tools: { mode: "all" }, permission: "allow", toolPermissions: corrupt }),
        ),
      );
      const entry = table.get("acme");
      assert.equal(entry?.newTool, "deny");
      assert.equal(mcpToolPermission(entry, "anything"), "deny");
    });
  }

  it("still asks when the container is readable and no floor is declared", () => {
    // The distinction that makes the rule above safe: omission is not corruption.
    const table = mcpPermissionsFromRequest(
      request(server({ tools: { mode: "all" }, toolPermissions: { search: "allow" } })),
    );
    assert.equal(table.get("acme")?.newTool, "ask");
    assert.equal(mcpToolPermission(table.get("acme"), "search"), "allow");
  });

  it("leaves a server that declared neither field on the run's own ladder", () => {
    // Unchanged, and deliberately: per-tool policy is an opt-in.
    const table = mcpPermissionsFromRequest(
      request(server({ tools: { mode: "all" }, permission: "ask" })),
    );
    assert.equal(table.get("acme")?.newTool, undefined);
    assert.equal(mcpToolPermission(table.get("acme"), "anything"), "ask");
  });
});

describe("two configured servers under one wire name (D10)", () => {
  it("refuses every call under the name instead of letting the later one answer", () => {
    const table = mcpPermissionsFromRequest(
      request(
        server({ tools: { mode: "all" }, permission: "deny" }, "Acme"),
        server({ tools: { mode: "all" }, permission: "allow" }, "Acme"),
      ),
    );

    // The map key used to be overwritten, so this resolved to `allow`: one connection's
    // policy authorizing a call that may well have belonged to the other.
    assert.equal(mcpToolPermission(table.get("Acme"), "delete"), "deny");
    assert.equal(mcpToolPermission(table.get("Acme"), "read"), "deny");
  });

  it("refuses whichever order the two were declared in", () => {
    const table = mcpPermissionsFromRequest(
      request(
        server({ tools: { mode: "all" }, permission: "allow" }, "Acme"),
        server({ tools: { mode: "all" }, permission: "deny" }, "Acme"),
      ),
    );

    assert.equal(mcpToolPermission(table.get("Acme"), "delete"), "deny");
  });

  it("refuses even when neither named a permission at all", () => {
    // Deferring would hand the call to the run's default, which is `allow_reads` out of the
    // box. Two connections and no way to tell them apart is not a case for a default.
    const table = mcpPermissionsFromRequest(
      request(
        server({ tools: { mode: "all" } }, "Acme"),
        server({ tools: { mode: "all" } }, "Acme"),
      ),
    );

    assert.equal(mcpToolPermission(table.get("Acme"), "delete"), "deny");
  });

  it("refuses a per-tool verdict one of them declared", () => {
    // The tool name a call arrives with belongs to whichever server the model meant, which
    // is exactly what nobody can determine, so a per-tool allow cannot be honoured here.
    const table = mcpPermissionsFromRequest(
      request(
        server(
          { tools: { mode: "all" }, toolPermissions: { read: "allow" } },
          "Acme",
        ),
        server({ tools: { mode: "all" }, permission: "ask" }, "Acme"),
      ),
    );

    assert.equal(mcpToolPermission(table.get("Acme"), "read"), "deny");
  });

  it("leaves distinctly named servers entirely alone", () => {
    const table = mcpPermissionsFromRequest(
      request(
        server({ tools: { mode: "all" }, permission: "deny" }, "Acme_work"),
        server({ tools: { mode: "all" }, permission: "allow" }, "Acme_personal"),
      ),
    );

    assert.equal(mcpToolPermission(table.get("Acme_work"), "delete"), "deny");
    assert.equal(
      mcpToolPermission(table.get("Acme_personal"), "delete"),
      "allow",
    );
  });

  it("says which name to fix, once, at intake", () => {
    const lines: string[] = [];
    mcpPermissionsFromRequest(
      request(
        server({ tools: { mode: "all" }, permission: "deny" }, "Acme"),
        server({ tools: { mode: "all" }, permission: "allow" }, "Acme"),
        server({ tools: { mode: "all" }, permission: "allow" }, "Acme"),
        server({ tools: { mode: "all" }, permission: "allow" }, "Other"),
      ),
      (message) => lines.push(message),
    );

    // D2's refusal is per call and says nothing about why two servers share a name.
    assert.equal(lines.length, 1);
    assert.match(lines[0], /more than one configured server is named 'Acme'/);
  });
});

describe("why intake marks the name rather than leaving it to the gate", () => {
  it("D2's ambiguity check cannot see two servers that share a name", () => {
    // D2 enumerates the candidates from the permission table's KEYS, and two servers named
    // `Acme` are one key. So the split is unambiguous — one candidate, `kind: "resolved"` —
    // and the collision has already been decided by the map before that code runs. It is a
    // different ambiguity: D2's is in parsing the rendered name, this one is in which
    // connection the name denotes.
    const table = mcpPermissionsFromRequest(
      request(
        server({ tools: { mode: "all" }, permission: "deny" }, "Acme"),
        server({ tools: { mode: "all" }, permission: "allow" }, "Acme"),
      ),
    );

    const resolution = resolveMcpToolName("mcp__Acme__delete", table);

    assert.equal(resolution.kind, "resolved");
    // And yet the verdict is D2's, because intake marked the entry and the one rule that
    // reads that mark lives where every consumer looks.
    assert.equal(
      resolution.kind === "resolved" ? resolution.permission : undefined,
      "deny",
    );
  });

  it("the two names D2 is about still reach D2's own refusal", () => {
    const table = mcpPermissionsFromRequest(
      request(
        server({ tools: { mode: "all" }, permission: "deny" }, "acme"),
        server({ tools: { mode: "all" }, permission: "allow" }, "acme__prod"),
      ),
    );

    const resolution = resolveMcpToolName("mcp__acme__prod__delete", table);

    assert.equal(resolution.kind, "ambiguous");
  });
});
