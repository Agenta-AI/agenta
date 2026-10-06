/**
 * Capabilities: several platform tools behind one toggle.
 *
 * "List agents" and "Agent config" are each one thing to an author, but three of the four are
 * separate tools with their own Allow / Ask / Deactivate. The toggle turns the whole group on or
 * off; the tool rows below it keep their own choice. Shared by the Build kit and the Agenta tools
 * section, which store their choices differently, so each gets its own pair of pure helpers.
 */
import {useId} from "react"

import type {AgentaToolsMap, BuildKitUiState} from "@agenta/entities/workflow"
import {Switch} from "@agenta/ui/ui"

export interface AgentCapability {
    key: string
    name: string
    description: string
    ops: string[]
}

export const AGENT_CAPABILITIES: AgentCapability[] = [
    {
        key: "list_agents",
        name: "List agents",
        description: "Find the other agents in this project.",
        ops: ["list_agents"],
    },
    {
        key: "agent_config",
        name: "Agent config",
        description:
            "Read, create and change the other agents in this project. Each change is saved as a new version that names this agent.",
        ops: ["read_agent_config", "create_agent", "edit_agent_config"],
    },
]

/** The capabilities whose tools this section lists. */
export function availableCapabilities(ops: Iterable<string>): AgentCapability[] {
    const listed = new Set(ops)
    return AGENT_CAPABILITIES.filter((capability) => capability.ops.some((op) => listed.has(op)))
}

/** On while any of its tools is on. */
export function agentaToolsCapabilityOn(tools: AgentaToolsMap, capability: AgentCapability) {
    return capability.ops.some((op) => op in tools)
}

/**
 * On adds each missing tool with Allow, keeping a tool already set to Ask; off removes all. A
 * tool absent from the saved map is off, so off has to delete it, and its Ask goes with it.
 */
export function setAgentaToolsCapability(
    tools: AgentaToolsMap,
    capability: AgentCapability,
    on: boolean,
): AgentaToolsMap {
    const next = {...tools}
    for (const op of capability.ops) {
        if (!on) delete next[op]
        else next[op] ??= "allow"
    }
    return next
}

/** On while the kit is on and any of its tools is not deactivated. */
export function buildKitCapabilityOn(state: BuildKitUiState, capability: AgentCapability) {
    return state.enabled && capability.ops.some((op) => !state.disabledOps.includes(op))
}

/**
 * Off deactivates every tool of the capability; on reactivates them. Per-tool overrides are left
 * alone, so a tool set to Ask is Ask again when the capability comes back on. The kit can keep
 * them because off is its own list (`disabledOps`), apart from the overrides, unlike the Agenta
 * tools map, where absence is what off means.
 */
export function setBuildKitCapability(
    state: BuildKitUiState,
    capability: AgentCapability,
    on: boolean,
): BuildKitUiState {
    const rest = state.disabledOps.filter((op) => !capability.ops.includes(op))
    return {...state, disabledOps: on ? rest : [...rest, ...capability.ops]}
}

function CapabilityRow({
    capability,
    on,
    onChange,
    disabled,
}: {
    capability: AgentCapability
    on: boolean
    onChange: (on: boolean) => void
    disabled?: boolean
}) {
    const labelId = useId()
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
                <span id={labelId} className="text-xs font-medium">
                    {capability.name}
                </span>
                <span className="text-xs text-colorTextDescription">{capability.description}</span>
            </div>
            <Switch
                size="sm"
                checked={on}
                onCheckedChange={onChange}
                disabled={disabled}
                aria-labelledby={labelId}
                className="mt-0.5 flex-shrink-0"
            />
        </div>
    )
}

/** One toggle per capability, above the per-tool rows. Renders nothing when none applies. */
export function AgentCapabilityToggles({
    capabilities,
    isOn,
    onChange,
    disabled,
}: {
    capabilities: AgentCapability[]
    isOn: (capability: AgentCapability) => boolean
    onChange: (capability: AgentCapability, on: boolean) => void
    disabled?: boolean
}) {
    if (capabilities.length === 0) return null
    return (
        <div className="flex flex-col gap-2 rounded border border-solid border-colorBorderSecondary p-3">
            {capabilities.map((capability) => (
                <CapabilityRow
                    key={capability.key}
                    capability={capability}
                    on={isOn(capability)}
                    onChange={(on) => onChange(capability, on)}
                    disabled={disabled}
                />
            ))}
        </div>
    )
}
