import {useCallback, useMemo, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {
    findGrantableHarnessTool,
    findGrantableTool,
    gateRulePattern,
    withHarnessToolAllow,
    withToolPermission,
} from "@agenta/entity-ui/tool-permission"
import {draftConfigChangeSignalAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"

import {resolveToolDisplay} from "../skin/registry"

export interface ToolGrantInfo {
    /** The gate maps to a per-tool-config tool (gateway or custom function) whose permission we can set. */
    eligible: boolean
    /** The matched tool is already `allow` — the affordance would be a no-op, so hide it. */
    alreadyAllowed: boolean
}

const INELIGIBLE: ToolGrantInfo = {eligible: false, alreadyAllowed: false}

interface AppliedPermission {
    toolName: string
    /** Landed on a `tools[]` entry rather than a harness allow-rule — decides which section pulses. */
    viaToolsEntry: boolean
}

/**
 * Apply one permission flip per tool onto a SINGLE evolving `parameters`, so a batch lands as one
 * write. Each `with*` helper returns a whole new object, so applying them against the same base
 * would keep only the last tool. Ineligible names (platform ops, client tools, MCP) are skipped.
 */
export function foldPermissions(
    parameters: Record<string, unknown> | null,
    toolNames: string[],
    allowed: boolean,
): {next: Record<string, unknown> | null; applied: AppliedPermission[]} {
    let next = parameters
    const applied: AppliedPermission[] = []
    for (const toolName of [...new Set(toolNames)]) {
        // Route to the field that matches the gate's tool class (see infoFor). `tools[]` first:
        // its per-tool permission outranks a rule, and a verbatim pattern would match its slug.
        const tool = findGrantableTool(next, toolName)
        const pattern = tool ? null : gateRulePattern(toolName)
        const step = tool
            ? withToolPermission(next, toolName, allowed ? "allow" : "ask")
            : pattern
              ? withHarnessToolAllow(next, pattern, allowed)
              : null
        if (!step) continue
        next = step
        applied.push({toolName, viaToolsEntry: Boolean(tool)})
    }
    return {next, applied}
}

/**
 * "Always allow this tool" for the approval card.
 *
 * Config write-through into the draft agent config; `buildAgentRequest` reads the draft, so a grant
 * takes effect on the paused run's resume and every future run, and a commit carries it to triggers.
 * Two fields, routed by tool class:
 *   - a gateway / custom-function tool has a `tools[]` entry → per-tool `permission: "allow"`
 *     (`specPermission`, the highest-precedence gate). Checked FIRST — it outranks any rule, and a
 *     verbatim rule pattern would otherwise also match its slug.
 *   - any other harness tool (`bash`, `Terminal`, `Write`, …) has no enforceable per-tool permission
 *     → an allow-rule in `harness.permissions.allow`, keyed by the gate name VERBATIM: the runner
 *     matches `pattern === gate.toolName`, and that string is exactly what the card shows (the
 *     runner stamps it as `resolvedName`, which the egress prefers). Never canonicalize it, except
 *     the seven Pi built-ins, which the runner matches case-insensitively (see `gateRulePattern`).
 * Platform ops (`commit_revision`, schedules), client tools, and MCP tools return `eligible: false`
 * and always stay gated (see `gateRulePattern`).
 *
 * On grant we raise a single draft-change signal that desktop's config pane consumes two ways: the
 * section it landed in pulses for attention, and a contained banner offers Undo. Hosts without a
 * config pane (mobile) simply have no consumer — the write itself is the behavior. `revoke` is the
 * exact inverse (`"ask"` for tools, `allowed:false` for harness rules).
 */
export function useAlwaysAllowTool(entityId?: string) {
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId ?? ""), [entityId]),
    )
    // Latest config for the deferred Undo click, so it never reverts against a stale snapshot.
    const configRef = useRef(config)
    configRef.current = config
    const setConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    // Marks the config section this grant lands in so it can pulse for attention — the user
    // acted here in the dock, but the write shows up over in the (maybe off-screen) config pane.
    const raiseDraftSignal = useSetAtom(draftConfigChangeSignalAtom)

    const infoFor = useCallback(
        (toolName: string): ToolGrantInfo => {
            if (!entityId) return INELIGIBLE
            // Gateway / custom-function tools carry a per-tool `permission` in `tools[]`. First:
            // it outranks a rule, and a verbatim rule pattern would also match its slug.
            const tool = findGrantableTool(config, toolName)
            if (tool) return {eligible: true, alreadyAllowed: tool.permission === "allow"}
            // Any other harness tool (bash, Terminal, Write, …) → `harness.permissions.allow`.
            const harnessTool = findGrantableHarnessTool(config, toolName)
            if (harnessTool) return {eligible: true, alreadyAllowed: harnessTool.allowed}
            // Platform ops (commit_revision, schedules), client tools, MCP → never grantable.
            return INELIGIBLE
        },
        [entityId, config],
    )

    // Inverse of grant: put the tools back to gated. Reads the LATEST config (ref), since Undo fires
    // seconds after the grant and the draft may have moved on.
    const revokeMany = useCallback(
        (toolNames: string[]): string[] => {
            if (!entityId) return []
            // One folded write: each `with*` returns a whole new `parameters`, so N separate
            // `setConfiguration` calls in a tick would each build on the same stale base.
            const {next, applied} = foldPermissions(configRef.current, toolNames, false)
            if (!applied.length || !next) return []
            setConfiguration(entityId, next)
            return applied.map((entry) => entry.toolName)
        },
        [entityId, setConfiguration],
    )
    const revoke = useCallback(
        (toolName: string): boolean => revokeMany([toolName]).length > 0,
        [revokeMany],
    )

    const grantMany = useCallback(
        (toolNames: string[]): string[] => {
            if (!entityId) return []
            const {next, applied} = foldPermissions(config, toolNames, true)
            if (!applied.length || !next) return []
            setConfiguration(entityId, next)
            const granted = applied.map((entry) => entry.toolName)
            // A harness allow-rule writes `harness.permissions`, which surfaces in the Advanced →
            // Permissions group (and classifies as an "advanced" draft change); gateway/custom-function
            // tools write `tools[]`, surfaced in the Tools section. Pulse the section the change lands in.
            const sectionKeys = [
                ...new Set(applied.map((entry) => (entry.viaToolsEntry ? "tools" : "advanced"))),
            ]
            raiseDraftSignal({
                revisionId: entityId,
                sectionKeys,
                origin: "approval-dock",
                summary:
                    granted.length > 1
                        ? `Always allow ${granted.length} tools`
                        : `Always allow ${granted[0]}`,
                // Friendly display (matches the approval card) — a gateway tool's raw name is a slug.
                label:
                    granted.length > 1
                        ? `${granted.length} tools`
                        : resolveToolDisplay(granted[0]).activity.running,
                toolNames: granted,
                at: Date.now(),
            })
            return granted
        },
        [entityId, config, setConfiguration, raiseDraftSignal],
    )
    const grant = useCallback(
        (toolName: string): boolean => grantMany([toolName]).length > 0,
        [grantMany],
    )
    return {infoFor, grant, grantMany, revoke, revokeMany}
}
