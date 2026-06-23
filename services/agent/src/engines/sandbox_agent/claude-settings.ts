/**
 * Layer 1 for Claude: render the Claude harness's permission settings into a
 * `<cwd>/.claude/settings.json` file the runner writes before the session starts. The Claude
 * ACP adapter reads it because it builds its SDK query with
 * `settingSources: ["user", "project", "local"]` (and applies `permissions.defaultMode`). This
 * file is the only clean Claude-config path because the sandbox-agent daemon strips ACP `_meta`.
 *
 * Three rule sources merge here:
 *  - the AUTHOR's `claudeSettings` (Layer 1): `defaultMode` + per-tool allow/deny/ask strings;
 *  - rules DERIVED from `sandboxPermission` (Layer 2): baseline reinforcement of the sandbox
 *    boundary as Claude-tool rules (block web tools when egress is off, block edits when the
 *    filesystem is read-only/off). These are a safety floor, not the primary enforcement.
 *  - rules DERIVED from per-MCP-server `disposition` (Layer 3, S3b): each user MCP server with a
 *    set disposition becomes a whole-server `mcp__<server>` allow/ask/deny rule.
 *
 * Layer 3 enforcement is split by tool source: resolved tools (code / gateway-callback) run
 * runner-side and are enforced at the relay (`tools/relay.ts`), NOT here — we deliberately do
 * NOT render per-resolved-tool `mcp__<server>__<tool>` rules to avoid double-enforcing them via
 * a fragile MCP-name derivation. Only the per-MCP-server disposition lands in this file.
 */
import type { McpServerConfig } from "../../protocol.ts";
import type { RunPlan } from "./run-plan.ts";

/** Claude Code's four permission modes (its `permissions.defaultMode`). */
export type ClaudePermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

/** The `permissions` block of a Claude Code `settings.json`. */
export interface ClaudePermissionsFile {
  defaultMode?: ClaudePermissionMode;
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

/** A Claude Code `settings.json` (only the `permissions` block, which is all we render). */
export interface ClaudeSettingsFile {
  permissions: ClaudePermissionsFile;
}

/** One batch of allow/deny/ask rules to merge into the settings (author or derived). */
interface RuleSet {
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

/** Dedupe in first-seen order, dropping falsy entries. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Derive baseline Claude-tool rules from the Layer-2 sandbox boundary. These reinforce the
 * declared boundary at the harness level (the sandbox provider is the real enforcement):
 *  - network not fully `on` (off / allowlist) -> deny the web tools (`WebFetch`, `WebSearch`);
 *  - filesystem `readonly` or `off` -> deny the mutating file tools (`Write`, `Edit`).
 */
function rulesFromSandboxPermission(plan: RunPlan): RuleSet {
  const deny: string[] = [];
  const network = plan.sandboxPermission?.network;
  if (network && (network.mode ?? "on") !== "on") {
    deny.push("WebFetch", "WebSearch");
  }
  const filesystem = plan.sandboxPermission?.filesystem;
  if (filesystem === "readonly" || filesystem === "off") {
    deny.push("Write", "Edit");
  }
  return { deny };
}

/**
 * Derive whole-server Claude rules from each user MCP server's Layer-3 `disposition` (S3b).
 * Claude addresses a whole MCP server as `mcp__<serverName>` (a per-tool rule is
 * `mcp__<server>__<tool>`); the server name is the `name`/key carried over ACP in `mcp.ts`
 * (`toAcpMcpServers` uses `s.name` verbatim). `allow`/`ask`/`deny` route to the matching list;
 * a server with no disposition contributes nothing (falls back to the global policy).
 */
function rulesFromMcpDispositions(servers: McpServerConfig[] | undefined): RuleSet {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];
  for (const server of servers ?? []) {
    if (!server.disposition || !server.name) continue;
    const rule = `mcp__${server.name}`;
    if (server.disposition === "allow") allow.push(rule);
    else if (server.disposition === "ask") ask.push(rule);
    else if (server.disposition === "deny") deny.push(rule);
  }
  return { allow, ask, deny };
}

/**
 * Build the Claude `settings.json` for a run, or `undefined` when none is needed.
 *
 * Returns `undefined` for any non-Claude harness (Pi gets no file). For Claude, merges the
 * author's `claudeSettings` with the Layer-2-derived rules and emits the smallest valid file:
 * `permissions.defaultMode` is set only when authored, and each allow/deny/ask list appears
 * only when it is non-empty. When there is nothing to write at all (no author options AND no
 * derived rules) it returns `undefined` so the runner writes no file.
 *
 * S3b adds the per-MCP-server disposition `RuleSet` to the merge below, the additive change the
 * separate merge step was structured for.
 */
export function buildClaudeSettings(
  plan: Pick<
    RunPlan,
    "acpAgent" | "claudeSettings" | "sandboxPermission" | "mcpServers"
  >,
): ClaudeSettingsFile | undefined {
  if (plan.acpAgent !== "claude") return undefined;

  const author = plan.claudeSettings ?? {};
  // Merge order: author rules first, then derived rules (Layer 2, then Layer 3). `dedupe`
  // keeps first-seen order, so an author rule wins its position and derived rules append.
  const ruleSets: RuleSet[] = [
    { allow: author.allow, deny: author.deny, ask: author.ask },
    rulesFromSandboxPermission(plan as RunPlan),
    rulesFromMcpDispositions(plan.mcpServers),
  ];

  const allow = dedupe(ruleSets.flatMap((r) => r.allow ?? []));
  const deny = dedupe(ruleSets.flatMap((r) => r.deny ?? []));
  const ask = dedupe(ruleSets.flatMap((r) => r.ask ?? []));

  const permissions: ClaudePermissionsFile = {};
  if (author.defaultMode) permissions.defaultMode = author.defaultMode;
  if (allow.length > 0) permissions.allow = allow;
  if (deny.length > 0) permissions.deny = deny;
  if (ask.length > 0) permissions.ask = ask;

  // Nothing authored and nothing derived -> no file (the boundary-free Claude run is unchanged).
  if (Object.keys(permissions).length === 0) return undefined;

  return { permissions };
}
