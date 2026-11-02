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
import type {
  AgentRunRequest,
  PermissionMode,
  ToolPermission,
} from "./protocol.ts";

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

export const PI_BUILTIN_TOOL_IDENTITY = {
  read: { ruleName: "Read", readOnly: true },
  bash: { ruleName: "Bash", readOnly: false },
  edit: { ruleName: "Edit", readOnly: false },
  write: { ruleName: "Write", readOnly: false },
  grep: { ruleName: "Grep", readOnly: true },
  find: { ruleName: "Find", readOnly: true },
  ls: { ruleName: "Ls", readOnly: true },
} as const satisfies Record<string, { ruleName: string; readOnly: boolean }>;

export type PiBuiltinToolName = keyof typeof PI_BUILTIN_TOOL_IDENTITY;
export type PiBuiltinRuleName =
  (typeof PI_BUILTIN_TOOL_IDENTITY)[PiBuiltinToolName]["ruleName"];

export interface PiBuiltinIdentity {
  toolName: PiBuiltinToolName;
  ruleName: PiBuiltinRuleName;
  readOnly: boolean;
}

export interface StoredPermissionDecision {
  decision: "allow" | "deny";
  interactionToken?: string;
}

export type Verdict =
  | { kind: "allow" | "deny"; interactionToken?: string }
  | { kind: "pendingApproval" };

export interface StoredPermissionDecisions {
  take(
    gate: GateDescriptor,
  ): "allow" | "deny" | StoredPermissionDecision | undefined;
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
const PI_BUILTIN_CANONICAL_NAMES = new Map<string, PiBuiltinIdentity>(
  (
    Object.entries(PI_BUILTIN_TOOL_IDENTITY) as Array<
      [PiBuiltinToolName, (typeof PI_BUILTIN_TOOL_IDENTITY)[PiBuiltinToolName]]
    >
  ).flatMap(([toolName, identity]) => {
    const builtin: PiBuiltinIdentity = {
      toolName,
      ruleName: identity.ruleName,
      readOnly: identity.readOnly,
    };
    return [
      [toolName.toLowerCase(), builtin],
      [identity.ruleName.toLowerCase(), builtin],
    ];
  }),
);

/**
 * The operator kill-switch for incident response, read LIVE at decision time.
 *
 * Read live, and not from the plan, for two reasons. The plan is built once at run start, so an
 * operator who flips the switch mid-incident does not reach a run already in flight. And the
 * plan's `default` is only consulted after an explicit specification permission has been ruled
 * out, so a switch that only replaces the default is beaten by any authored `allow`. Both were
 * live holes: see `effectivePermission`, which now checks this FIRST.
 */
export function operatorDenyActive(): boolean {
  return process.env.SANDBOX_AGENT_DENY_PERMISSIONS === "true";
}

export function permissionsFromRequest(
  request: AgentRunRequest,
): PermissionPlan {
  // Belt and braces: the switch also collapses the plan, so a reader that never reaches
  // `effectivePermission` (a settings renderer, a log line) sees the incident state too.
  if (operatorDenyActive()) {
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
  // First-class, top priority, and above the authored specification permission. An operator
  // turning this on during an incident must stop a tool the author explicitly allowed; reading
  // it here rather than from the plan also reaches a run that started before the flip.
  if (operatorDenyActive()) return "deny";
  if (gate.specPermission !== undefined) return gate.specPermission;
  if (gate.serverPermission !== undefined) return gate.serverPermission;

  const rulePermission = matchingRulePermission(gate, plan.rules);
  if (rulePermission !== undefined) return rulePermission;

  return defaultPermission(plan.default, gate);
}

/**
 * The permission ladder for a BROWSER-FULFILLED client tool.
 *
 * Deliberately not `effectivePermission`: this ladder treats `allow` and `ask` alike (both mean
 * "forward to the browser") and collapses every non-`deny` default to `allow`, because a client
 * tool's own pause IS its approval. It lives here anyway, beside the ladder it differs from, so
 * that a rule which must hold for EVERY tool family — the operator kill-switch is the one that
 * exists today — has one place to be written rather than two modules to remember.
 */
export function clientToolPermission(
  gate: GateDescriptor,
  plan: PermissionPlan,
): ToolPermission {
  if (operatorDenyActive()) return "deny";
  return gate.specPermission ?? (plan.default === "deny" ? "deny" : "allow");
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
  const decision =
    typeof storedDecision === "string"
      ? storedDecision
      : storedDecision?.decision;
  if (decision === "allow" || decision === "deny") {
    return {
      kind: decision,
      ...(typeof storedDecision === "object" && storedDecision.interactionToken
        ? { interactionToken: storedDecision.interactionToken }
        : {}),
    };
  }
  return { kind: "pendingApproval" };
}

export function piBuiltinIdentity(
  toolName: string,
): PiBuiltinIdentity | undefined {
  // Built-in names are matched case-insensitively so an authored rule `bash` governs `Bash`.
  return PI_BUILTIN_CANONICAL_NAMES.get(toolName.trim().toLowerCase());
}

export function storedDecisionKeyShape(
  toolName: string | undefined,
  args: unknown,
): { toolName: string | undefined; args: unknown } {
  // Normalize Codex's MCP rawInput wrapper first, symmetrically on both sides of the match: the
  // runner-side gate keys on the bare `tools/call` arguments, while the traced `tool_call` event
  // (and thus the resumed `{approved}` decision) carries codex-acp's `{server,tool,arguments}`
  // envelope. Unwrapping to `arguments` makes the two keys agree so a cross-turn approval resumes.
  const normalizedArgs = unwrapCodexMcpArgs(args);
  if (!toolName) return { toolName, args: normalizedArgs };
  const identity = piBuiltinIdentity(toolName);
  if (!identity) return { toolName, args: normalizedArgs };
  return {
    toolName: identity.ruleName,
    args:
      identity.toolName === "bash"
        ? projectBashStoredDecisionArgs(normalizedArgs)
        : normalizedArgs,
  };
}

/**
 * Codex-acp reports an MCP tool call's rawInput as `{server, tool, arguments}` (the wrapper), but
 * the actual `tools/call` arguments the runner-side gate sees are the inner `arguments`. When the
 * input is EXACTLY that wrapper (a string `server`, a string `tool`, and an object `arguments`),
 * return the inner `arguments` so the stored-decision key matches the gate's key. Any other shape
 * is returned unchanged, so a real tool whose args merely include some of these keys is untouched.
 */
function unwrapCodexMcpArgs(args: unknown): unknown {
  if (!isRecord(args)) return args;
  const keys = Object.keys(args);
  if (keys.length !== 3) return args;
  if (
    typeof args.server === "string" &&
    typeof args.tool === "string" &&
    isRecord(args.arguments)
  ) {
    return args.arguments;
  }
  return args;
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
  const ruleToolName = prefixPattern?.toolName ?? pattern;
  if (!toolNamesMatch(ruleToolName, gate.toolName)) return false;
  if (prefixPattern === undefined) return true;

  const firstArg = firstStringArgument(gate.args);
  // Prefix rules with uninspectable args fail toward the default instead of guessing.
  return firstArg !== undefined && firstArg.startsWith(prefixPattern.prefix);
}

/**
 * Names inside the seven built-ins fold to one identity, so case never matters for them; every
 * other name is author-chosen and stays case-significant.
 */
function toolNamesMatch(ruleToolName: string, gateToolName: string): boolean {
  const ruleIdentity = piBuiltinIdentity(ruleToolName);
  const gateIdentity = piBuiltinIdentity(gateToolName);
  if (ruleIdentity !== undefined && gateIdentity !== undefined) {
    return ruleIdentity.toolName === gateIdentity.toolName;
  }
  return ruleToolName === gateToolName;
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

function projectBashStoredDecisionArgs(args: unknown): unknown {
  if (!isRecord(args) || !("command" in args)) return args;
  return { command: args.command };
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return (PERMISSION_MODES as readonly unknown[]).includes(value);
}

export function isToolPermission(value: unknown): value is ToolPermission {
  return (TOOL_PERMISSIONS as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
