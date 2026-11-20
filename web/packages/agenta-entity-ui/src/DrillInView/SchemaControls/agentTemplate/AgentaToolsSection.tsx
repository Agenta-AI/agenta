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
        "entityUi.buildKit.presetDeactivate",
        "entityUi.buildKit.presetDeactivateAgentaHelp",
    ),
    preset("custom", "entityUi.buildKit.presetCustom", "entityUi.buildKit.presetCustomHelp", {
        disabled: true,
        separatorBefore: true,
    }),
]

/** Copy for the Agenta tools the build kit table does not name. */
const AGENTA_TOOL_COPY: Record<string, {name: BuildKitKey; description: BuildKitKey}> = {
    get_current_session: {
        name: "entityUi.buildKit.getCurrentSessionName",
        description: "entityUi.buildKit.getCurrentSessionDescription",
    },
    list_subscriptions: {
        name: "entityUi.buildKit.listSubscriptionsName",
        description: "entityUi.buildKit.listSubscriptionsDescription",
    },
    check_skill_updates: {
        name: "entityUi.buildKit.checkSkillUpdatesName",
        description: "entityUi.buildKit.checkSkillUpdatesDescription",
    },
    apply_skill_update: {
        name: "entityUi.buildKit.applySkillUpdateName",
        description: "entityUi.buildKit.applySkillUpdateDescription",
    },
}

/** What each preset sets a tool to. Deactivate leaves an empty map, never removes the entry. */
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
    /** The tools the playground build kit adds to runs right now. */
    buildKitOps: Set<string>
    /** A read-only view (a phone): the permissions show as text. */
    readOnly?: boolean
}

export function AgentaToolsSection({
    tools,
    onChange,
    access,
    buildKitOps,
    readOnly,
}: AgentaToolsSectionProps) {
    const t = useT(buildKitCatalog)
    const rows = Object.entries(access).map(([op, kind]) => {
        const copy = AGENTA_TOOL_COPY[op]
        const {name, description} = copy
            ? {name: t(copy.name), description: t(copy.description)}
            : describeBuildKitPlatformTool(op)
        return {
            key: op,
            name,
            description: buildKitOps.has(op)
                ? t("entityUi.buildKit.buildKitSettingApplies", {description: description ?? ""})
                : description,
            readOnly: kind === "read",
        }
    })
    const preset = agentaToolsPreset(tools, access)
    return (
        <div className="flex min-h-0 flex-col">
            {/* The view's breadcrumb names the part, so the body starts at its description (F04 f10). */}
            <span className="text-[13px] leading-5 text-colorTextSecondary">
                {t("entityUi.buildKit.agentaToolsHint")}
            </span>
            <PermissionDrawerBody
                flush
                catalogKey="agenta-tools"
                // "Deactivate" turns a tool off; it is not a refusal, so it is not red (L8-22).
                plainDeny
                catalog={{status: "ready", complete: true, tools: rows}}
                emptyLabel={t("entityUi.buildKit.noAgentaTools")}
                permissions={{
                    default: "deny",
                    tools: Object.fromEntries(
                        rows.map((row) => [row.key, tools[row.key] ?? "deny"]),
                    ),
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
        </div>
    )
}

/**
 * The Agenta tools of the agent in `config`: which tools exist (`access`), the agent's entry
 * (`tools`), and the ones the playground build kit overrides. `status` is "none" when the
 * deployment offers no Agenta tool.
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
    const status: "error" | "none" | "ready" = accessQuery.isError
        ? "error"
        : !access || Object.keys(access).length === 0
          ? "none"
          : "ready"
    const tools = useMemo(
        () => readAgentaTools(Array.isArray(config.tools) ? config.tools : []) ?? {},
        [config.tools],
    )
    return {status, access: access ?? {}, tools, buildKitOps}
}

/** The agent's `agenta_tools` entry with `next` written into its tool list. */
export const withAgentaTools = (
    config: Record<string, unknown>,
    next: AgentaToolsMap,
): Record<string, unknown> => ({
    ...config,
    tools: writeAgentaTools(Array.isArray(config.tools) ? config.tools : [], next),
})
