import {useMemo} from "react"

import {
    agentaToolsAccessAtom,
    readAgentaTools,
    workflowAgentTemplateOverlayAtomFamily,
    writeAgentaTools,
    type AgentaToolsMap,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {describeBuildKitPlatformTool} from "./buildKitDescriptors"
import {buildKitToolOptions} from "./BuildKitSection"
import {PermissionDrawerBody, type PermissionPresetOption} from "./IntegrationPermissionDrawer"

type Preset = "allow_all" | "always_ask" | "ask_writes" | "deny_all" | "custom"

const presets: PermissionPresetOption[] = [
    {value: "allow_all", label: "Allow all", help: "Tools run without asking."},
    {value: "always_ask", label: "Ask all", help: "Ask before each tool runs."},
    {value: "ask_writes", label: "Allow reads", help: "Read-only tools run; write tools ask."},
    {value: "deny_all", label: "Deactivate", help: "Turn every Agenta tool off."},
    {
        value: "custom",
        label: "Custom",
        help: "Per-tool choices below.",
        disabled: true,
        separatorBefore: true,
    },
]

/** Copy for the Agenta tools the build kit table does not name. */
const AGENTA_TOOL_COPY: Record<string, {name: string; description: string}> = {
    get_current_session: {
        name: "Get the link to this chat",
        description: "Gets this chat's name and a link to open it in Agenta.",
    },
    check_skill_updates: {
        name: "Check skill updates",
        description: "Checks whether this agent's skills have newer versions.",
    },
    apply_skill_update: {
        name: "Apply a skill update",
        description: "Updates one of this agent's skills to its newer version.",
    },
}

/** What each preset sets a tool to. Deactivate leaves an empty map, never removes the entry. */
function presetValue(preset: Preset, readOnly: boolean): "allow" | "ask" | undefined {
    if (preset === "allow_all") return "allow"
    if (preset === "always_ask") return "ask"
    if (preset === "ask_writes") return readOnly ? "allow" : "ask"
    return undefined
}

export interface AgentaToolsSectionProps {
    tools: AgentaToolsMap
    onChange: (next: AgentaToolsMap) => void
    /** Every Agenta tool, marked "read" or "write". */
    access: Record<string, "read" | "write">
    /** The tools the playground build kit also carries. */
    buildKitOps: Set<string>
    disabled?: boolean
}

export function AgentaToolsSection({
    tools,
    onChange,
    access,
    buildKitOps,
    disabled,
}: AgentaToolsSectionProps) {
    const rows = Object.entries(access).map(([op, kind]) => {
        const {name, description} = AGENTA_TOOL_COPY[op] ?? describeBuildKitPlatformTool(op)
        return {
            key: op,
            name,
            description: buildKitOps.has(op)
                ? `${description} In the playground, the Build kit setting applies.`
                : description,
            readOnly: kind === "read",
        }
    })
    const preset =
        (["deny_all", "allow_all", "always_ask", "ask_writes"] as const).find((value) =>
            rows.every((row) => tools[row.key] === presetValue(value, row.readOnly)),
        ) ?? "custom"
    return (
        <div className="flex min-h-0 flex-col">
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Agenta tools</span>
                <span className="text-xs text-colorTextDescription">
                    Tools your agent can use wherever it runs: the playground, the API, Slack,
                    Telegram, WhatsApp and automations. Saved with the agent.
                </span>
            </div>
            <PermissionDrawerBody
                catalogKey="agenta-tools"
                catalog={{status: "ready", complete: true, tools: rows}}
                emptyLabel="No Agenta tools available."
                permissions={{
                    default: "deny",
                    tools: Object.fromEntries(
                        rows.map((row) => [row.key, tools[row.key] ?? "deny"]),
                    ),
                }}
                onChangePermissions={() => undefined}
                onChangeToolPermission={(op, permission) => {
                    if (permission === "inherit") return
                    const next = {...tools}
                    delete next[op]
                    if (permission !== "deny") next[op] = permission
                    onChange(next)
                }}
                presets={{
                    options: presets,
                    value: preset,
                    overrideCount: 0,
                    onPick: (value) => {
                        if (value === "custom" || value === "follow_agent") return
                        const next: AgentaToolsMap = {}
                        for (const row of rows) {
                            const permission = presetValue(value as Preset, row.readOnly)
                            if (permission) next[row.key] = permission
                        }
                        onChange(next)
                    },
                }}
                disabled={disabled}
                toolOptions={buildKitToolOptions}
                writeLabel="Write"
                readOnlyLabel="Read-only"
            />
        </div>
    )
}

/** The section for the agent in `config`, editing its `agenta_tools` entry in the draft. */
export function useAgentaTools({
    config,
    onChange,
    revisionId,
    disabled,
}: {
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    revisionId: string | null
    disabled?: boolean
}) {
    const access = useAtomValue(agentaToolsAccessAtom).data
    const overlay = useAtomValue(
        useMemo(() => workflowAgentTemplateOverlayAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const buildKitOps = useMemo(
        () => new Set(Object.keys((overlay?.op_access as Record<string, unknown>) ?? {})),
        [overlay],
    )
    if (!access || Object.keys(access).length === 0) return null
    const tools = Array.isArray(config.tools) ? config.tools : []
    return (
        <AgentaToolsSection
            tools={readAgentaTools(tools) ?? {}}
            onChange={(next) => onChange({...config, tools: writeAgentaTools(tools, next)})}
            access={access}
            buildKitOps={buildKitOps}
            disabled={disabled}
        />
    )
}
