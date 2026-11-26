import {useMemo} from "react"

import {
    agentaToolsAccessAtom,
    readAgentaTools,
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitUiStateAtomFamily,
    writeAgentaTools,
    type AgentaToolsMap,
} from "@agenta/entities/workflow"
import {createT, useT, type CatalogKey} from "@agenta/i18n"
import buildKitCatalog from "@agenta/i18n/catalogs/entityUi.buildKit"
import {useAtomValue} from "jotai"

import {describeBuildKitPlatformTool} from "./buildKitDescriptors"
import {buildKitToolOptions} from "./BuildKitSection"
import {PermissionDrawerBody, type PermissionPresetOption} from "./IntegrationPermissionList"

const tNow = createT(buildKitCatalog)

type Preset = "allow_all" | "always_ask" | "ask_writes" | "deny_all" | "custom"

type BuildKitKey = CatalogKey<typeof buildKitCatalog>

/** A preset whose texts read the active language each time they are read. */
const preset = (
    value: PermissionPresetOption["value"],
    label: BuildKitKey,
    help: BuildKitKey,
    extra: Partial<PermissionPresetOption> = {},
): PermissionPresetOption => ({
    value,
    get label() {
        return tNow(label)
    },
    get help() {
        return tNow(help)
    },
    ...extra,
})

const presets: PermissionPresetOption[] = [
    preset("allow_all", "entityUi.buildKit.presetAllowAll", "entityUi.buildKit.presetAllowAllHelp"),
    preset("always_ask", "entityUi.buildKit.presetAskAll", "entityUi.buildKit.presetAskAllHelp"),
    preset(
        "ask_writes",
        "entityUi.buildKit.presetAllowReads",
        "entityUi.buildKit.presetAllowReadsHelp",
    ),
    preset(
        "deny_all",
        "entityUi.buildKit.presetOff",
        "entityUi.buildKit.presetOffAgentaHelp",
    ),
    preset("custom", "entityUi.buildKit.presetCustom", "entityUi.buildKit.presetCustomHelp", {
        disabled: true,
        separatorBefore: true,
    }),
]

/** What each preset sets a tool to. Off leaves an empty map, never removes the entry. */
function presetValue(preset: Preset, readOnly: boolean): "allow" | "ask" | undefined {
    if (preset === "allow_all") return "allow"
    if (preset === "always_ask") return "ask"
    if (preset === "ask_writes") return readOnly ? "allow" : "ask"
    return undefined
}

/** The preset the tools' permissions match, or "custom". */
export function agentaToolsPreset(
    tools: AgentaToolsMap,
    access: Record<string, "read" | "write">,
): Preset {
    const entries = Object.entries(access)
    return (
        (["deny_all", "allow_all", "always_ask", "ask_writes"] as const).find((value) =>
            entries.every(([op, kind]) => tools[op] === presetValue(value, kind === "read")),
        ) ?? "custom"
    )
}

/** The name of a preset, as the "Default permission" select shows it. */
export const agentaToolsPresetLabel = (value: Preset): string =>
    presets.find((option) => option.value === value)?.label ?? value

export interface AgentaToolsSectionProps {
    tools: AgentaToolsMap
    onChange: (next: AgentaToolsMap) => void
    /** Every Agenta tool, marked "read" or "write". */
    access: Record<string, "read" | "write">
    /** A read-only view (a phone): the permissions show as text. */
    readOnly?: boolean
}

export function AgentaToolsSection({tools, onChange, access, readOnly}: AgentaToolsSectionProps) {
    const t = useT(buildKitCatalog)
    const rows = Object.entries(access).map(([op, kind]) => {
        const {name, description} = describeBuildKitPlatformTool(op)
        // Every row keeps its own description, so every row is two lines (ROW-01).
        return {key: op, name, description, readOnly: kind === "read"}
    })
    const preset = agentaToolsPreset(tools, access)
    return (
        <PermissionDrawerBody
            catalogKey="agenta-tools"
            // "Off" turns a tool off; it is not a refusal, so it is not red (L8-22).
            plainDeny
            catalog={{status: "ready", complete: true, tools: rows}}
            emptyLabel={t("entityUi.buildKit.noAgentaTools")}
            permissions={{
                default: "deny",
                tools: Object.fromEntries(rows.map((row) => [row.key, tools[row.key] ?? "deny"])),
            }}
            onChangePermissions={() => undefined}
            onChangeToolPermission={(op, permission) => {
                if (permission === "inherit" || permission === "allow_reads") return
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
            valuesAsText={readOnly}
            toolOptions={buildKitToolOptions}
            writeLabel={t("entityUi.buildKit.writeGroup")}
            readOnlyLabel={t("entityUi.buildKit.readOnlyGroup")}
        />
    )
}

/**
 * The Agenta tools of the agent in `config`: which tools exist (`access`), the agent's entry
 * (`tools`), and the ones the playground build kit overrides. `status` is "none" when the
 * deployment offers no Agenta tool, "loading" while the list is on its way.
 */
export function useAgentaToolsData(config: Record<string, unknown>, revisionId: string | null) {
    const accessQuery = useAtomValue(agentaToolsAccessAtom)
    const overlay = useAtomValue(
        useMemo(() => workflowAgentTemplateOverlayAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const buildKit = useAtomValue(
        useMemo(() => workflowBuildKitUiStateAtomFamily(revisionId ?? ""), [revisionId]),
    )
    // Only a tool the build kit actually adds overrides the entry in the playground.
    const buildKitOps = useMemo(
        () =>
            new Set(
                buildKit.enabled
                    ? Object.keys((overlay?.op_access as Record<string, unknown>) ?? {}).filter(
                          (op) => !buildKit.disabledOps.includes(op),
                      )
                    : [],
            ),
        [overlay, buildKit],
    )
    const access = accessQuery.data
    const status: "loading" | "error" | "none" | "ready" = accessQuery.isError
        ? "error"
        : accessQuery.isPending && accessQuery.fetchStatus === "fetching"
          ? "loading"
          : !access || Object.keys(access).length === 0
            ? "none"
            : "ready"
    const tools = useMemo(
        () => readAgentaTools(Array.isArray(config.tools) ? config.tools : []) ?? {},
        [config.tools],
    )
    return {status, access: access ?? {}, tools, buildKitOps, retry: accessQuery.refetch}
}

/** The agent's `agenta_tools` entry with `next` written into its tool list. */
export const withAgentaTools = (
    config: Record<string, unknown>,
    next: AgentaToolsMap,
): Record<string, unknown> => ({
    ...config,
    tools: writeAgentaTools(Array.isArray(config.tools) ? config.tools : [], next),
})
