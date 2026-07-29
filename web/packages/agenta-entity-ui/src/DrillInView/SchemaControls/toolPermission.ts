/**
 * toolPermission — locate a runtime tool gate's config entry and set its per-tool permission.
 *
 * The approval card's "always allow this tool" writes a per-tool `permission` onto the matching
 * entry in the agent template's `tools[]` (config write-through: the run reads the draft config, so
 * the change takes effect on the in-flight resume and every future run; a commit carries it to
 * triggers). Only tools that live in the committed `tools[]` AND carry a per-tool `permission` slot
 * are grantable: gateway (Composio) tools and custom function tools. Platform ops (overlay-injected,
 * e.g. `commit_revision`), builtins, MCP servers (per-server permission, not per-tool), and workflow
 * references are deliberately NOT matched here, so they can never be auto-allowed from the card —
 * `commit_revision` and destructive ops stay gated by construction.
 *
 * The matcher mirrors the runtime wire name: a gateway gate arrives as the slug
 * `tools__{provider}__{integration}__{action}__{connection}` (see `parseGatewayToolName`), and a
 * custom function tool arrives as its bare `function.name`.
 */
import {parseGatewayToolSlug} from "@agenta/shared/utils"

import {parseGatewayTool} from "./toolUtils"

export type ToolPermission = "allow" | "ask" | "deny"

const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v))

const asPermission = (v: unknown): ToolPermission | undefined =>
    v === "allow" || v === "ask" || v === "deny" ? v : undefined

interface TemplateLocation {
    template: Record<string, unknown>
    /** Rebuild the full `parameters` object from an updated template. */
    wrap: (nextTemplate: Record<string, unknown>) => Record<string, unknown>
}

/**
 * The agent template lives at `parameters.agent` (the playground shape) or IS the parameters (a bare
 * template). Mirror `buildAgentRequest`'s `withAgentRunDefaults` so a write lands exactly where the
 * run reads from.
 */
function locateTemplate(parameters: Record<string, unknown>): TemplateLocation {
    if (isRecord(parameters.agent)) {
        const agent = parameters.agent
        return {template: agent, wrap: (next) => ({...parameters, agent: next})}
    }
    return {template: parameters, wrap: (next) => next}
}

/**
 * Index of the `tools[]` entry a runtime gate `toolName` refers to, or -1. A gateway tool (canonical
 * `{type:"gateway"}` or a legacy function-name slug) matches by its {provider, integration, action,
 * connection} identity; a custom function tool matches by `function.name`.
 */
function matchToolIndex(tools: unknown[], toolName: string): number {
    const slug = parseGatewayToolSlug(toolName)
    for (let i = 0; i < tools.length; i++) {
        const entry = tools[i]
        if (!isRecord(entry)) continue
        if (slug) {
            const g = parseGatewayTool(entry)
            if (
                g &&
                g.provider === slug.provider &&
                g.integration === slug.integration &&
                g.action === slug.action &&
                g.connection === slug.connection
            ) {
                return i
            }
            continue
        }
        const fn = isRecord(entry.function) ? entry.function : null
        if (fn && typeof fn.name === "string" && fn.name === toolName) return i
    }
    return -1
}

export interface GrantableTool {
    /** The current per-tool permission on the matched entry, if one is set. */
    permission?: ToolPermission
}

// ---------------------------------------------------------------------------
// Harness tools (bash / Terminal / Write / …): the `harness.permissions.allow` path
// ---------------------------------------------------------------------------
//
// A harness tool carries NO per-tool `permission` (a builtin's own permission is dropped as
// unenforceable). The only lever is an authored allow-rule: `harness.permissions.allow += [<gate
// name>]` flows through `wire_author_permission_rules` into a runner rule
// `{pattern, permission:"allow"}`, while `runner.permissions.default` stays as authored so platform
// ops (commit_revision, schedules) keep gating. Works on Pi AND Claude — `_parse_harness_slice`
// reads `harness.permissions` for any harness.
//
// THE PATTERN IS THE GATE NAME, VERBATIM. The runner matches rules with `pattern === gate.toolName`
// (permission-plan.ts `ruleMatches`), and `gate.toolName` is exactly what the approval card shows:
// the runner stamps it onto the gate as `resolvedName` (acp-interactions.ts) and the SDK's
// `_approval_tool_name` prefers that field for the part. Do NOT "canonicalize" the name — an ACP
// gate reports `bash`/`Terminal` verbatim (buildGateDescriptor: `spec?.name ?? displayName`), so a
// rule for `Bash` would silently never match.

/** Platform ops (overlay-injected). These must ALWAYS gate — never auto-allowable from the card. */
const PLATFORM_OPS = new Set([
    "discover_tools",
    "query_workflows",
    "query_spans",
    "test_run",
    "commit_revision",
    "annotate_trace",
    "discover_triggers",
    "create_schedule",
    "create_subscription",
    "list_schedules",
    "list_subscriptions",
    "list_deliveries",
    "list_connections",
    "test_subscription",
    "remove_schedule",
    "remove_subscription",
    "pause_schedule",
    "resume_schedule",
    "pause_subscription",
    "resume_subscription",
])

/** Browser-fulfilled client tools — they carry their own widget/decline UI; never auto-allowable. */
const CLIENT_TOOLS = new Set(["request_connection", "request_input"])

/**
 * The runner rule pattern for a gate, or `null` when the gate must never be auto-allowed:
 * a platform op, a client tool, or an MCP tool — `wire_author_permission_rules` DROPS `mcp__`
 * patterns from the runner plan, so such a rule would silently never take effect (MCP is governed
 * per-server instead).
 */
export function gateRulePattern(toolName: string): string | null {
    if (!toolName) return null
    if (PLATFORM_OPS.has(toolName) || CLIENT_TOOLS.has(toolName)) return null
    if (toolName.startsWith("mcp__")) return null
    return toolName
}

/** The authored `harness.permissions.allow` patterns. */
export function readHarnessAllowList(parameters: unknown): string[] {
    if (!isRecord(parameters)) return []
    const {template} = locateTemplate(parameters)
    const harness = isRecord(template.harness) ? template.harness : {}
    const permissions = isRecord(harness.permissions) ? harness.permissions : {}
    return Array.isArray(permissions.allow)
        ? (permissions.allow.filter((v) => typeof v === "string") as string[])
        : []
}

export interface GrantableHarnessTool {
    /** The runner rule pattern — the gate name, verbatim. */
    pattern: string
    /** Already present in `harness.permissions.allow`. */
    allowed: boolean
}

/**
 * Classify a gate as an allow-rule-able harness tool and report whether it's already allowed, or
 * `null` when it must stay gated. Callers must check `findGrantableTool` FIRST: a gateway/custom
 * tool has a `tools[]` entry whose per-tool `permission` outranks any rule.
 */
export function findGrantableHarnessTool(
    parameters: unknown,
    toolName: string,
): GrantableHarnessTool | null {
    const pattern = gateRulePattern(toolName)
    if (!pattern || !isRecord(parameters)) return null
    return {pattern, allowed: readHarnessAllowList(parameters).includes(pattern)}
}

/** Return a new `parameters` with `pattern` present (or absent, when `allowed` is false) in
 *  `harness.permissions.allow`. Preserves the rest of the harness/permissions object. */
export function withHarnessToolAllow(
    parameters: unknown,
    pattern: string,
    allowed: boolean,
): Record<string, unknown> | null {
    if (!isRecord(parameters) || !pattern) return null
    const {template, wrap} = locateTemplate(parameters)
    const harness = isRecord(template.harness) ? {...template.harness} : {}
    const permissions = isRecord(harness.permissions) ? {...harness.permissions} : {}
    const current = Array.isArray(permissions.allow)
        ? (permissions.allow.filter((v) => typeof v === "string") as string[])
        : []
    const has = current.includes(pattern)
    if (allowed === has) return wrap({...template, harness: {...harness, permissions}})
    const nextAllow = allowed ? [...current, pattern] : current.filter((name) => name !== pattern)
    return wrap({
        ...template,
        harness: {...harness, permissions: {...permissions, allow: nextAllow}},
    })
}

/**
 * Find the grantable `tools[]` entry for a gate, or `null` when the gate is not a per-tool-config
 * tool (platform op, builtin, MCP, reference, or an unknown name). A `null` result is the signal to
 * hide the "always allow" affordance.
 */
export function findGrantableTool(parameters: unknown, toolName: string): GrantableTool | null {
    if (!isRecord(parameters) || !toolName) return null
    const {template} = locateTemplate(parameters)
    const tools = Array.isArray(template.tools) ? (template.tools as unknown[]) : []
    const i = matchToolIndex(tools, toolName)
    if (i < 0) return null
    return {permission: asPermission((tools[i] as Record<string, unknown>).permission)}
}

/**
 * Return a new `parameters` with the gate's tool entry set to `permission` (or its `permission` key
 * removed when `undefined` = inherit). Returns `null` when the gate is not grantable, so the caller
 * leaves the config untouched.
 */
export function withToolPermission(
    parameters: unknown,
    toolName: string,
    permission: ToolPermission | undefined,
): Record<string, unknown> | null {
    if (!isRecord(parameters) || !toolName) return null
    const {template, wrap} = locateTemplate(parameters)
    const tools = Array.isArray(template.tools) ? (template.tools as unknown[]) : []
    const i = matchToolIndex(tools, toolName)
    if (i < 0) return null
    const entry = isRecord(tools[i]) ? {...(tools[i] as Record<string, unknown>)} : {}
    if (permission === undefined) delete entry.permission
    else entry.permission = permission
    const nextTools = tools.slice()
    nextTools[i] = entry
    return wrap({...template, tools: nextTools})
}
