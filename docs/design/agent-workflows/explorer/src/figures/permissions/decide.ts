/**
 * Pure, faithful re-implementation of the runner's permission decision for the
 * browser. Ported line-by-line in spirit from services/runner/src/permission-plan.ts
 * (read-only reference; not imported, since that package is a standalone Node
 * pnpm project outside this Vite app's dependency graph). Every testVector in
 * ../../model/permissions.json must pass through `decide()` below unchanged;
 * see decide.test.ts.
 *
 * Kept deliberately close to the source shape (permissionsFromRequest ->
 * effectivePermission -> decide) so a future diff against permission-plan.ts
 * stays easy to eyeball. The only additions are `rung`/`detail` fields the
 * simulator UI needs to explain *why* a verdict came out the way it did.
 */
import type { PolicyDefault } from "../../model/types";

export type ToolPermission = "allow" | "ask" | "deny";

export interface PermissionRule {
  pattern: string;
  permission: ToolPermission;
}

export interface PermissionPlan {
  default: PolicyDefault;
  rules: PermissionRule[];
}

/** How the plan itself was constructed, before any single gate is considered. */
export type PlanRung = "normal" | "killSwitch" | "malformed";

export interface RawPermissionsConfig {
  /** Mirrors the wire request.permissions field; `unknown` on purpose (may be malformed). */
  permissions: unknown;
  /** Mirrors process.env for the kill-switch check. */
  env?: Record<string, string>;
}

/** Everything one gated call needs to know, normalized upstream (mirrors GateDescriptor). */
export interface GateDescriptor {
  toolName: string;
  /** true = read-only hinted; false/undefined counts as a write under allow_reads. */
  readOnlyHint?: boolean | null;
  /** The resolved tool spec's own explicit permission, if the author set one. */
  specPermission?: ToolPermission;
  /** The owning MCP server's explicit permission, if this tool belongs to a user MCP server. */
  serverPermission?: ToolPermission;
  /** Canonicalizable call arguments; used for rule prefix matching and stored-decision anchoring. */
  args?: unknown;
}

/** Which rung of the four-step precedence ladder produced the effective permission. */
export type DecidingRung = "specPermission" | "serverPermission" | "ruleMatch" | "policyDefault";

export interface EffectivePermissionResult {
  permission: ToolPermission;
  rung: DecidingRung;
  detail: string;
}

export type VerdictKind = "allow" | "deny" | "pendingApproval";

export interface Verdict {
  kind: VerdictKind;
  /** "storedDecision" only when a previously-recorded HITL decision resolved an ask. */
  rung: DecidingRung | "storedDecision";
  effectivePermission: ToolPermission;
  detail: string;
}

export interface StoredPermissionDecisions {
  take(gate: GateDescriptor): "allow" | "deny" | undefined;
}

const POLICY_DEFAULTS: readonly PolicyDefault[] = ["allow", "ask", "deny", "allow_reads"];
const TOOL_PERMISSIONS: readonly ToolPermission[] = ["allow", "ask", "deny"];
const RULE_RANK: Record<ToolPermission, number> = { allow: 0, ask: 1, deny: 2 };

export const KILL_SWITCH_ENV_VAR = "SANDBOX_AGENT_DENY_PERMISSIONS";

/**
 * Pi builtin tool identity table, copied from permission-plan.ts's
 * PI_BUILTIN_TOOL_IDENTITY. Small and stable enough to inline here rather than
 * import cross-package; used for two things: (1) mapping a lowercase tool
 * name to the Claude-settings-style rule name rules match against ("bash" ->
 * "Bash"), and (2) canonicalizing bash args down to {command} for stored-
 * decision anchoring, exactly as storedDecisionKeyShape() does.
 */
export const PI_BUILTIN_TOOL_IDENTITY = {
  read: { ruleName: "Read", readOnly: true },
  bash: { ruleName: "Bash", readOnly: false },
  edit: { ruleName: "Edit", readOnly: false },
  write: { ruleName: "Write", readOnly: false },
  grep: { ruleName: "Grep", readOnly: true },
  find: { ruleName: "Find", readOnly: true },
  ls: { ruleName: "Ls", readOnly: true },
} as const satisfies Record<string, { ruleName: string; readOnly: boolean }>;

type PiBuiltinToolName = keyof typeof PI_BUILTIN_TOOL_IDENTITY;

interface PiBuiltinIdentity {
  toolName: PiBuiltinToolName;
  ruleName: string;
  readOnly: boolean;
}

const PI_BUILTIN_BY_NAME = new Map<string, PiBuiltinIdentity>(
  (Object.entries(PI_BUILTIN_TOOL_IDENTITY) as Array<
    [PiBuiltinToolName, (typeof PI_BUILTIN_TOOL_IDENTITY)[PiBuiltinToolName]]
  >).flatMap(([toolName, identity]) => {
    const builtin: PiBuiltinIdentity = { toolName, ruleName: identity.ruleName, readOnly: identity.readOnly };
    return [
      [toolName, builtin],
      [identity.ruleName, builtin],
    ];
  }),
);

/** Looks up the Pi builtin identity by either its lowercase name or its rule name. */
export function piBuiltinIdentity(toolName: string): PiBuiltinIdentity | undefined {
  return PI_BUILTIN_BY_NAME.get(toolName);
}

/**
 * Builds a PermissionPlan from a raw wire-shaped config, mirroring
 * permissionsFromRequest() exactly, including the kill-switch short-circuit
 * and the two malformed-input fallbacks (both land on {default:"ask"}).
 */
export function planFromConfig(config: RawPermissionsConfig): { plan: PermissionPlan; rung: PlanRung } {
  if (config.env?.[KILL_SWITCH_ENV_VAR] === "true") {
    // Kill switch short-circuits before the wire permissions block is even read.
    return { plan: { default: "deny", rules: [] }, rung: "killSwitch" };
  }

  const raw = config.permissions;
  if (raw === undefined) {
    // Absent permissions is NOT malformed; it is the ordinary default policy.
    return { plan: { default: "allow_reads", rules: [] }, rung: "normal" };
  }
  if (!isRecord(raw)) {
    return { plan: { default: "ask", rules: [] }, rung: "malformed" };
  }

  const defaultMode = raw.default ?? "allow_reads";
  if (!isPolicyDefault(defaultMode)) {
    return { plan: { default: "ask", rules: [] }, rung: "malformed" };
  }
  return { plan: { default: defaultMode, rules: normalizeRules(raw.rules) }, rung: "normal" };
}

/** Mirrors effectivePermission(): steps 1-4 of the precedence ladder, no stored-decision lookup. */
export function effectivePermission(gate: GateDescriptor, plan: PermissionPlan): EffectivePermissionResult {
  if (gate.specPermission !== undefined) {
    return {
      permission: gate.specPermission,
      rung: "specPermission",
      detail: `specPermission=${gate.specPermission}: the tool's own explicit permission always wins (step 1, both directions).`,
    };
  }
  if (gate.serverPermission !== undefined) {
    return {
      permission: gate.serverPermission,
      rung: "serverPermission",
      detail: `serverPermission=${gate.serverPermission}: the owning MCP server's explicit permission, checked before rules/default (step 2).`,
    };
  }

  const rule = matchingRule(gate, plan.rules);
  if (rule !== undefined) {
    return {
      permission: rule.permission,
      rung: "ruleMatch",
      detail: `ruleMatch: "${rule.pattern}" -> ${rule.permission} (step 3; highest-severity match wins when several rules match).`,
    };
  }

  const permission = defaultPermission(plan.default, gate);
  if (plan.default === "allow_reads") {
    return {
      permission,
      rung: "policyDefault",
      detail:
        gate.readOnlyHint === true
          ? "policyDefault(allow_reads): read-only hint is true -> allow (step 4)."
          : "policyDefault(allow_reads): not read-only -> ask (step 4).",
    };
  }
  return {
    permission,
    rung: "policyDefault",
    detail: `policyDefault(${plan.default}): mode applies directly, read-only hint ignored (step 4).`,
  };
}

/** Mirrors decide(): effectivePermission(), then the ask-branch stored-decision lookup. */
export function decide(gate: GateDescriptor, plan: PermissionPlan, stored: StoredPermissionDecisions): Verdict {
  const { permission, rung, detail } = effectivePermission(gate, plan);
  if (permission === "deny") return { kind: "deny", rung, effectivePermission: permission, detail };
  if (permission === "allow") return { kind: "allow", rung, effectivePermission: permission, detail };

  const storedDecision = stored.take(gate);
  if (storedDecision === "allow") {
    return {
      kind: "allow",
      rung: "storedDecision",
      effectivePermission: permission,
      detail: "storedDecision=allow: a decision recorded earlier in this conversation, consumed once.",
    };
  }
  if (storedDecision === "deny") {
    return {
      kind: "deny",
      rung: "storedDecision",
      effectivePermission: permission,
      detail: "storedDecision=deny: a decision recorded earlier in this conversation, consumed once.",
    };
  }
  return {
    kind: "pendingApproval",
    rung,
    effectivePermission: permission,
    detail: `${detail} No stored decision found; pause the turn and emit interaction_request(user_approval).`,
  };
}

/**
 * The stable resume anchor: approvedCallKey(toolName, canonicalizedArgs), with
 * the same canonicalization storedDecisionKeyShape() applies (rule-name
 * normalization, bash args projected down to {command}).
 */
export function canonicalDecisionKey(toolName: string, args: unknown): string {
  const identity = piBuiltinIdentity(toolName);
  if (!identity) return JSON.stringify({ toolName, args: args ?? null });
  const canonicalArgs = identity.toolName === "bash" ? projectBashArgs(args) : args;
  return JSON.stringify({ toolName: identity.ruleName, args: canonicalArgs ?? null });
}

/**
 * In-memory store for one simulated conversation's HITL decisions. A decision
 * is consumed exactly once: `take()` deletes the entry it returns, so an
 * identical follow-up call finds nothing and asks again. This is the
 * behavior the UI's HITL flow demonstrates statefully.
 */
export class StoredDecisionStore implements StoredPermissionDecisions {
  private readonly decisions = new Map<string, "allow" | "deny">();

  record(toolName: string, args: unknown, decision: "allow" | "deny"): void {
    this.decisions.set(canonicalDecisionKey(toolName, args), decision);
  }

  take(gate: GateDescriptor): "allow" | "deny" | undefined {
    const key = canonicalDecisionKey(gate.toolName, gate.args);
    const decision = this.decisions.get(key);
    if (decision !== undefined) this.decisions.delete(key);
    return decision;
  }

  clear(): void {
    this.decisions.clear();
  }
}

/**
 * The client-tool ladder (gates.client-tool-ladder in the model): a carve-out
 * from the policy/rule ladder above, not an alternate path through it. Ported
 * from ApprovalResponder.onClientTool() in services/runner/src/responder.ts:
 *
 *   const permission = request.gate.specPermission ?? (this.plan.default === "deny" ? "deny" : "allow");
 *   if (permission === "deny") return { kind: "deny" };
 *   if (permission === "ask") {
 *     const storedDecision = this.decisions.take(request.gate);
 *     if (storedDecision === "deny") return { kind: "deny" };
 *   }
 *   return { kind: "pendingApproval" };
 *
 * The load-bearing difference from the policy/rule ladder: there is NO local
 * "allow" outcome here. A client tool's only job is to reach the browser, so
 * every non-denied call pauses as pendingApproval and waits for the browser
 * to fulfill it on a later turn (see onClientTool's separate stored-output
 * lookup, not modeled here since no testVector exercises it). A stored
 * "deny" decision can still deny an "ask"-derived permission; `stored` is
 * optional so callers that only care about the deny/pendingApproval split
 * (the common case in this simulator) can omit it.
 */
export function decideClientTool(
  gate: GateDescriptor,
  plan: PermissionPlan,
  stored?: StoredPermissionDecisions,
): Verdict {
  const permission: ToolPermission = gate.specPermission ?? (plan.default === "deny" ? "deny" : "allow");
  const rung: DecidingRung = gate.specPermission !== undefined ? "specPermission" : "policyDefault";

  if (permission === "deny") {
    return {
      kind: "deny",
      rung,
      effectivePermission: "deny",
      detail:
        gate.specPermission !== undefined
          ? "specPermission=deny: an explicit permission on a client tool always wins, both directions."
          : "client-tool ladder: policy default is deny, so the call is blocked before it ever reaches the browser.",
    };
  }

  if (permission === "ask" && stored !== undefined) {
    const storedDecision = stored.take(gate);
    if (storedDecision === "deny") {
      return {
        kind: "deny",
        rung: "storedDecision",
        effectivePermission: permission,
        detail: "storedDecision=deny: a decision recorded earlier in this conversation also denies a client tool's ask.",
      };
    }
  }

  return {
    kind: "pendingApproval",
    rung,
    effectivePermission: permission,
    detail:
      gate.specPermission !== undefined
        ? `specPermission=${permission}: forwarded to the browser to fulfill. Client tools have no local "allow"; only an explicit or derived deny short-circuits.`
        : "client-tool ladder: no explicit permission and the policy isn't deny, so the call is forwarded to the browser to fulfill.",
  };
}

function matchingRule(gate: GateDescriptor, rules: PermissionRule[]): PermissionRule | undefined {
  let best: PermissionRule | undefined;
  for (const rule of rules) {
    if (!ruleMatches(gate, rule.pattern)) continue;
    if (best === undefined || RULE_RANK[rule.permission] > RULE_RANK[best.permission]) {
      best = rule;
    }
  }
  return best;
}

function ruleMatches(gate: GateDescriptor, pattern: string): boolean {
  const prefixPattern = parsePrefixPattern(pattern);
  if (prefixPattern === undefined) return pattern === gate.toolName;
  if (prefixPattern.toolName !== gate.toolName) return false;

  const firstArg = firstStringArgument(gate.args);
  // A prefix rule whose args can't be inspected falls through to the default, never guesses.
  return firstArg !== undefined && firstArg.startsWith(prefixPattern.prefix);
}

/** "Bash(rm:*)" -> { toolName: "Bash", prefix: "rm" } (the trailing ":*)" is wildcard syntax, not part of the prefix). */
function parsePrefixPattern(pattern: string): { toolName: string; prefix: string } | undefined {
  const open = pattern.indexOf("(");
  if (open <= 0 || !pattern.endsWith(":*)")) return undefined;
  return { toolName: pattern.slice(0, open), prefix: pattern.slice(open + 1, -3) };
}

function firstStringArgument(args: unknown): string | undefined {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) {
    return args.find((value): value is string => typeof value === "string");
  }
  if (!isRecord(args)) return undefined;
  return Object.values(args).find((value): value is string => typeof value === "string");
}

function defaultPermission(mode: PolicyDefault, gate: GateDescriptor): ToolPermission {
  if (mode === "allow_reads") {
    return gate.readOnlyHint === true ? "allow" : "ask";
  }
  return mode;
}

function projectBashArgs(args: unknown): unknown {
  if (!isRecord(args) || !("command" in args)) return args;
  return { command: args.command };
}

function normalizeRules(rawRules: unknown): PermissionRule[] {
  if (!Array.isArray(rawRules)) return [];
  const rules: PermissionRule[] = [];
  for (const rawRule of rawRules) {
    if (!isRecord(rawRule)) continue;
    const { pattern, permission } = rawRule;
    if (typeof pattern === "string" && isToolPermission(permission)) {
      rules.push({ pattern, permission });
    }
  }
  return rules;
}

function isPolicyDefault(value: unknown): value is PolicyDefault {
  return (POLICY_DEFAULTS as readonly unknown[]).includes(value);
}

function isToolPermission(value: unknown): value is ToolPermission {
  return (TOOL_PERMISSIONS as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
