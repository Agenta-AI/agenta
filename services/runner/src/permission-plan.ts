/**
 * Permission map; check all four sites when changing behavior:
 *  - SDK settings renderer: `sdks/python/agenta/sdk/agents/adapters/claude_settings.py`
 *    pre-answers Claude permission gates from authored and derived rules.
 *  - ACP responder: `services/runner/src/engines/sandbox_agent/acp-interactions.ts` answers
 *    gates the harness raises over ACP, or pauses when a human decision is required.
 *  - Relay enforcement: `services/runner/src/tools/relay.ts` enforces the same decisions for Pi.
 *  - Client-tool ladder: `services/runner/src/responder.ts` handles browser-fulfilled tools
 *    across the pause/resume boundary.
 */
import type { AgentRunRequest, PermissionMode, ToolPermission } from "./protocol.ts";

/** Which component executes the gated tool; decides how resume matching anchors names. */
export type GateExecutor = "harness" | "relay" | "client";

/** Everything the decision needs to know about one gated call, normalized upstream. */
export interface GateDescriptor {
  executor: GateExecutor;
  /** Stable tool name: spec name for relay/client tools; recorded tool_call name for harness gates. */
  toolName?: string;
  /** The resolved spec's explicit author permission, if the gate is for a resolved tool. */
  specPermission?: ToolPermission;
  /** The owning MCP server's explicit permission, if the tool belongs to a user MCP server. */
  serverPermission?: ToolPermission;
  /** The catalog read-only hint (true = read). Absent counts as a write under allow_reads. */
  readOnlyHint?: boolean;
  /** Canonicalizable call arguments (used by stored-decision matching, not by effectivePermission). */
  args?: unknown;
}

export interface PermissionPlan {
  default: PermissionMode;
  rules: { pattern: string; permission: ToolPermission }[];
}

export type Verdict =
  | { kind: "allow" }
  | { kind: "deny" }
  | { kind: "pendingApproval" };

export interface StoredPermissionDecisions {
  take(gate: GateDescriptor): "allow" | "deny" | undefined;
}

const PERMISSION_MODES: readonly PermissionMode[] = [
  "allow",
  "ask",
  "deny",
  "allow_reads",
];
const TOOL_PERMISSIONS: readonly ToolPermission[] = ["allow", "ask", "deny"];
const RULE_RANK: Record<ToolPermission, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

export function permissionsFromRequest(
  request: AgentRunRequest,
): PermissionPlan {
  // Operator kill-switch for incident response: deny wins over every authored request.
  if (process.env.SANDBOX_AGENT_DENY_PERMISSIONS === "true") {
    return { default: "deny", rules: [] };
  }

  if (request.permissions !== undefined) {
    const raw = request.permissions as unknown;
    if (!isRecord(raw)) {
      return { default: "ask", rules: [] };
    }

    const defaultMode = raw.default ?? "allow_reads";
    if (!isPermissionMode(defaultMode)) {
      // An unparseable policy must fail toward asking a human, not toward running tools.
      return { default: "ask", rules: [] };
    }
    return {
      default: defaultMode,
      rules: normalizeRules(raw.rules),
    };
  }

  return { default: "allow_reads", rules: [] };
}

export function effectivePermission(
  gate: GateDescriptor,
  plan: PermissionPlan,
): ToolPermission {
  if (gate.specPermission !== undefined) return gate.specPermission;
  if (gate.serverPermission !== undefined) return gate.serverPermission;

  const rulePermission = matchingRulePermission(gate, plan.rules);
  if (rulePermission !== undefined) return rulePermission;

  return defaultPermission(plan.default, gate);
}

export function decide(
  gate: GateDescriptor,
  plan: PermissionPlan,
  stored: StoredPermissionDecisions,
): Verdict {
  const permission = effectivePermission(gate, plan);
  if (permission === "deny") return { kind: "deny" };
  if (permission === "allow") return { kind: "allow" };

  const storedDecision = stored.take(gate);
  if (storedDecision === "allow") return { kind: "allow" };
  if (storedDecision === "deny") return { kind: "deny" };
  return { kind: "pendingApproval" };
}

export class PendingApprovalLatch {
  private acquired = false;

  tryAcquire(): boolean {
    if (this.acquired) return false;
    this.acquired = true;
    return true;
  }

  get held(): boolean {
    return this.acquired;
  }
}

function normalizeRules(rawRules: unknown): PermissionPlan["rules"] {
  if (!Array.isArray(rawRules)) return [];
  const rules: PermissionPlan["rules"] = [];
  for (const rawRule of rawRules) {
    if (!isRecord(rawRule)) continue;
    const { pattern, permission } = rawRule;
    if (typeof pattern === "string" && isToolPermission(permission)) {
      rules.push({ pattern, permission });
    }
  }
  return rules;
}

function matchingRulePermission(
  gate: GateDescriptor,
  rules: PermissionPlan["rules"],
): ToolPermission | undefined {
  let best: ToolPermission | undefined;
  for (const rule of rules) {
    if (!ruleMatches(gate, rule.pattern)) continue;
    if (best === undefined || RULE_RANK[rule.permission] > RULE_RANK[best]) {
      best = rule.permission;
    }
  }
  return best;
}

function ruleMatches(gate: GateDescriptor, pattern: string): boolean {
  if (gate.toolName === undefined) return false;

  const prefixPattern = parsePrefixPattern(pattern);
  if (prefixPattern === undefined) return pattern === gate.toolName;
  if (prefixPattern.toolName !== gate.toolName) return false;

  const firstArg = firstStringArgument(gate.args);
  // Prefix rules with uninspectable args fail toward the default instead of guessing.
  return firstArg !== undefined && firstArg.startsWith(prefixPattern.prefix);
}

function parsePrefixPattern(
  pattern: string,
): { toolName: string; prefix: string } | undefined {
  const open = pattern.indexOf("(");
  if (open <= 0 || !pattern.endsWith(":*)")) return undefined;
  return {
    toolName: pattern.slice(0, open),
    prefix: pattern.slice(open + 1, -3),
  };
}

function firstStringArgument(args: unknown): string | undefined {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) {
    return args.find((value): value is string => typeof value === "string");
  }
  if (!isRecord(args)) return undefined;
  return Object.values(args).find(
    (value): value is string => typeof value === "string",
  );
}

function defaultPermission(
  mode: PermissionMode,
  gate: GateDescriptor,
): ToolPermission {
  if (mode === "allow_reads") {
    return gate.readOnlyHint === true ? "allow" : "ask";
  }
  return mode;
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return (PERMISSION_MODES as readonly unknown[]).includes(value);
}

function isToolPermission(value: unknown): value is ToolPermission {
  return (TOOL_PERMISSIONS as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
