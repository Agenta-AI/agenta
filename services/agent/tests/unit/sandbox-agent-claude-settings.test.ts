/**
 * Unit tests for the pure Claude `settings.json` builder (Layer 1 + Layer-2 reinforcement).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-claude-settings.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { buildClaudeSettings } from "../../src/engines/sandbox_agent/claude-settings.ts";
import type { RunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";

type PlanInput = Pick<
  RunPlan,
  "acpAgent" | "claudeSettings" | "sandboxPermission" | "mcpServers"
>;

function plan(overrides: Partial<PlanInput>): PlanInput {
  return { acpAgent: "claude", ...overrides };
}

describe("buildClaudeSettings", () => {
  it("renders the author's mode and merged rules for a Claude run", () => {
    const settings = buildClaudeSettings(
      plan({
        claudeSettings: {
          defaultMode: "acceptEdits",
          allow: ["Read", "Bash(npm run:*)"],
          deny: ["Write"],
          ask: ["mcp__github__create_issue"],
        },
      }),
    );

    assert.deepEqual(settings, {
      permissions: {
        defaultMode: "acceptEdits",
        allow: ["Read", "Bash(npm run:*)"],
        deny: ["Write"],
        ask: ["mcp__github__create_issue"],
      },
    });
  });

  it("derives WebFetch/WebSearch deny rules when network is off", () => {
    const settings = buildClaudeSettings(
      plan({ sandboxPermission: { network: { mode: "off" } } }),
    );

    assert.ok(settings);
    assert.deepEqual(settings.permissions.deny, ["WebFetch", "WebSearch"]);
    // No mode and no other lists were authored, so only the derived deny survives.
    assert.equal(settings.permissions.defaultMode, undefined);
    assert.equal(settings.permissions.allow, undefined);
    assert.equal(settings.permissions.ask, undefined);
  });

  it("derives Write/Edit deny rules when the filesystem is readonly", () => {
    const settings = buildClaudeSettings(
      plan({ sandboxPermission: { filesystem: "readonly" } }),
    );

    assert.ok(settings);
    assert.deepEqual(settings.permissions.deny, ["Write", "Edit"]);
  });

  it("derives Write/Edit deny rules when the filesystem is off", () => {
    const settings = buildClaudeSettings(
      plan({ sandboxPermission: { filesystem: "off" } }),
    );

    assert.ok(settings);
    assert.deepEqual(settings.permissions.deny, ["Write", "Edit"]);
  });

  it("merges author rules with derived rules and dedupes", () => {
    const settings = buildClaudeSettings(
      plan({
        claudeSettings: { defaultMode: "plan", deny: ["WebFetch"] },
        sandboxPermission: {
          network: { mode: "allowlist", allowlist: ["10.0.0.0/8"] },
          filesystem: "readonly",
        },
      }),
    );

    assert.ok(settings);
    // Author `WebFetch` keeps its position; the network-derived `WebFetch` is deduped, and the
    // filesystem-derived `Write`/`Edit` append.
    assert.deepEqual(settings.permissions.deny, [
      "WebFetch",
      "WebSearch",
      "Write",
      "Edit",
    ]);
    assert.equal(settings.permissions.defaultMode, "plan");
  });

  it("renders an mcp__<server> deny rule for an MCP server with disposition deny (S3b)", () => {
    const settings = buildClaudeSettings(
      plan({ mcpServers: [{ name: "github", disposition: "deny" }] }),
    );

    assert.ok(settings);
    assert.deepEqual(settings.permissions.deny, ["mcp__github"]);
    assert.equal(settings.permissions.allow, undefined);
    assert.equal(settings.permissions.ask, undefined);
  });

  it("renders an mcp__<server> allow rule for an MCP server with disposition allow (S3b)", () => {
    const settings = buildClaudeSettings(
      plan({ mcpServers: [{ name: "github", disposition: "allow" }] }),
    );

    assert.ok(settings);
    assert.deepEqual(settings.permissions.allow, ["mcp__github"]);
  });

  it("routes allow/ask/deny MCP dispositions to their lists and skips an unset one (S3b)", () => {
    const settings = buildClaudeSettings(
      plan({
        mcpServers: [
          { name: "filesystem", disposition: "allow" },
          { name: "github", disposition: "ask" },
          { name: "shell", disposition: "deny" },
          { name: "unset" }, // no disposition -> contributes nothing
        ],
      }),
    );

    assert.ok(settings);
    assert.deepEqual(settings.permissions.allow, ["mcp__filesystem"]);
    assert.deepEqual(settings.permissions.ask, ["mcp__github"]);
    assert.deepEqual(settings.permissions.deny, ["mcp__shell"]);
  });

  it("emits no MCP rules for a non-Claude (Pi) harness even with dispositions (S3b)", () => {
    const settings = buildClaudeSettings({
      acpAgent: "pi",
      mcpServers: [{ name: "github", disposition: "deny" }],
    });

    assert.equal(settings, undefined);
  });

  it("returns undefined for a Claude run when no MCP server carries a disposition (S3b)", () => {
    assert.equal(
      buildClaudeSettings(plan({ mcpServers: [{ name: "github" }] })),
      undefined,
    );
  });

  it("returns undefined for a non-Claude (Pi) harness even with options", () => {
    const settings = buildClaudeSettings({
      acpAgent: "pi",
      claudeSettings: { defaultMode: "plan", deny: ["Write"] },
      sandboxPermission: { network: { mode: "off" } },
    });

    assert.equal(settings, undefined);
  });

  it("returns undefined for a Claude run with no options and no derived rules", () => {
    assert.equal(buildClaudeSettings(plan({})), undefined);
    // network `on` and filesystem `on` derive nothing, so still no file.
    assert.equal(
      buildClaudeSettings(
        plan({ sandboxPermission: { network: { mode: "on" }, filesystem: "on" } }),
      ),
      undefined,
    );
  });
});
