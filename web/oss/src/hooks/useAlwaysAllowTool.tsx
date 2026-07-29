import {useCallback, useMemo, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {
    findGrantableHarnessTool,
    findGrantableTool,
    gateRulePattern,
    withHarnessToolAllow,
    withToolPermission,
} from "@agenta/entity-ui/drill-in"
import {draftConfigChangeSignalAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"

import {resolveToolDisplay} from "@/oss/components/AgentChatSlice/assets/toolDisplay"

export interface ToolGrantInfo {
    /** The gate maps to a per-tool-config tool (gateway or custom function) whose permission we can set. */
    eligible: boolean
    /** The matched tool is already `allow` — the affordance would be a no-op, so hide it. */
    alreadyAllowed: boolean
}

const INELIGIBLE: ToolGrantInfo = {eligible: false, alreadyAllowed: false}

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
 *     runner stamps it as `resolvedName`, which the egress prefers). Never canonicalize it.
 * Platform ops (`commit_revision`, schedules), client tools, and MCP tools return `eligible: false`
 * and always stay gated (see `gateRulePattern`).
 *
 * On grant we raise a single draft-change signal that the config pane consumes two ways: the section
 * it landed in pulses for attention, and a contained banner (`AlwaysAllowedNotice`) offers Undo —
 * both kept inside the config panel where the change is, rather than a floating toast. `revoke` is
 * the exact inverse (`"ask"` for tools, `allowed:false` for harness rules).
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

    // Inverse of grant: put the tool back to gated. Reads the LATEST config (ref), since Undo fires
    // seconds after the grant and the draft may have moved on.
    const revoke = useCallback(
        (toolName: string): boolean => {
            if (!entityId) return false
            const cfg = configRef.current
            // Same routing as `grant` — `tools[]` first, then the harness allow-rule.
            const tool = findGrantableTool(cfg, toolName)
            const pattern = tool ? null : gateRulePattern(toolName)
            const next = tool
                ? withToolPermission(cfg, toolName, "ask")
                : pattern
                  ? withHarnessToolAllow(cfg, pattern, false)
                  : null
            if (!next) return false
            setConfiguration(entityId, next)
            return true
        },
        [entityId, setConfiguration],
    )

    const grant = useCallback(
        (toolName: string): boolean => {
            if (!entityId) return false
            // Route to the field that matches the gate's tool class (see infoFor). `tools[]` first:
            // its per-tool permission outranks a rule, and a verbatim pattern would match its slug.
            const tool = findGrantableTool(config, toolName)
            const pattern = tool ? null : gateRulePattern(toolName)
            const next = tool
                ? withToolPermission(config, toolName, "allow")
                : pattern
                  ? withHarnessToolAllow(config, pattern, true)
                  : null
            if (!next) return false
            setConfiguration(entityId, next)
            // A harness allow-rule writes `harness.permissions`, which surfaces in the Advanced →
            // Permissions group (and classifies as an "advanced" draft change); gateway/custom-function
            // tools write `tools[]`, surfaced in the Tools section. Pulse the section the change lands in.
            raiseDraftSignal({
                revisionId: entityId,
                sectionKeys: [tool ? "tools" : "advanced"],
                origin: "approval-dock",
                summary: `Always allow ${toolName}`,
                // Friendly display (matches the approval card) — a gateway tool's raw name is a slug.
                label: resolveToolDisplay(toolName).label,
                toolName,
                at: Date.now(),
            })
            return true
        },
        [entityId, config, setConfiguration, raiseDraftSignal],
    )

    return {infoFor, grant, revoke}
}
