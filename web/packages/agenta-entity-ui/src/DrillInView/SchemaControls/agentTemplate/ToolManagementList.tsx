/**
 * ToolManagementList
 *
 * The Tools section body, structured to match the triggers section: tools are partitioned into
 * sub-sections — Connected apps (third-party/gateway tools **grouped by provider**, each an
 * expandable app card), Workflow references, Tool definitions, and Built-in — each with a labelled
 * count header. Connected-app grouping mirrors the trigger section's provider groups (shared
 * {@link CollapsibleProviderGroup} / {@link SubSectionHeader}); the other kinds are flat row lists.
 *
 * The provider catalog (for app names/logos) only loads when there are gateway tools — the parent
 * partitions with the tool function-name alone, and the catalog hook lives in {@link GatewayGroups},
 * mounted only when a group exists. Dark-safe (`--ag-color*` tokens only).
 */
import {type ReactNode, useCallback, useMemo} from "react"

import {useToolCatalogIntegrations} from "@agenta/entities/gatewayTool"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {ConfigItemView} from "../ConfigItemDrawer"
import {CollapsibleProviderGroup, SubSectionHeader} from "../sectionGroups"
import {parseGatewayFunctionName} from "../toolUtils"

import {describeTool, isFunctionTool, toolName} from "./itemDescriptors"
import {ITEM_KINDS} from "./itemKinds"
import {ItemChildRow, ItemRow} from "./ItemRow"

// Persisted per-agent expand state for connected-app groups (key = `${entityId}:${integrationKey}`).
const toolGroupsExpandedAtom = atomWithStorage<Record<string, boolean>>(
    "agenta:tools:groups-expanded",
    {},
)

interface IndexedTool {
    item: unknown
    index: number
}
interface ToolProviderGroup {
    key: string
    items: IndexedTool[]
}

function prettifyProvider(key: string): string {
    if (!key) return "Other"
    return key.charAt(0).toUpperCase() + key.slice(1)
}

export interface ToolManagementListProps {
    tools: unknown[]
    /** The open agent's revision id — scopes persisted group-expand state. */
    entityId: string | null
    openEdit: (kind: "tool", index: number, item: unknown, view: ConfigItemView) => void
    removeItem: (kind: "tool", index: number) => void
    closeEditor: () => void
    disabled?: boolean
    /**
     * Opens the agent integration drawer. An `integrationKey` preselects that app (a provider group's
     * "Add {app} tool" jumps straight to its actions); omit it to open on the app grid (header +).
     */
    onOpenIntegration?: (integrationKey?: string) => void
    /** Add trigger shown in the empty state (the tool selector popover). */
    emptyAdd: ReactNode
}

/** A flat, headed sub-section of bordered item rows (references / definitions / built-in). */
function FlatToolSection({
    label,
    entries,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
}: {
    label: string
    entries: IndexedTool[]
    openEdit: ToolManagementListProps["openEdit"]
    removeItem: ToolManagementListProps["removeItem"]
    closeEditor: () => void
    disabled?: boolean
}) {
    if (entries.length === 0) return null
    return (
        <div className="flex flex-col gap-2">
            <SubSectionHeader label={label} count={entries.length} />
            <div className="flex flex-col gap-2">
                {entries.map(({item, index}) => (
                    <ItemRow
                        key={`tool-${index}`}
                        descriptor={describeTool(item)}
                        onEdit={() => openEdit("tool", index, item, ITEM_KINDS.tool.editView(item))}
                        onRemove={() => {
                            removeItem("tool", index)
                            closeEditor()
                        }}
                        disabled={disabled || ITEM_KINDS.tool.isReadOnly(item)}
                    />
                ))}
            </div>
        </div>
    )
}

/**
 * Connected-app tools grouped by provider. Isolated in its own component so the (paginated) tool
 * catalog only loads when gateway tools actually exist.
 */
function GatewayGroups({
    groups,
    totalCount,
    entityId,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    onOpenIntegration,
}: {
    groups: ToolProviderGroup[]
    totalCount: number
    entityId: string | null
    openEdit: ToolManagementListProps["openEdit"]
    removeItem: ToolManagementListProps["removeItem"]
    closeEditor: () => void
    disabled?: boolean
    onOpenIntegration?: (integrationKey?: string) => void
}) {
    const {integrations} = useToolCatalogIntegrations()
    const [expanded, setExpanded] = useAtom(toolGroupsExpandedAtom)

    const intgByKey = useMemo(
        () => new Map(integrations.map((i) => [i.key, i] as const)),
        [integrations],
    )

    const resolved = useMemo(
        () =>
            groups
                .map((g) => {
                    const intg = intgByKey.get(g.key)
                    return {
                        ...g,
                        name: intg?.name || prettifyProvider(g.key),
                        logo: intg?.logo ?? null,
                    }
                })
                .sort((a, b) => a.name.localeCompare(b.name)),
        [groups, intgByKey],
    )

    const isGroupOpen = useCallback(
        (key: string, size: number) => expanded[`${entityId}:${key}`] ?? size === 1,
        [expanded, entityId],
    )
    const toggleGroup = useCallback(
        (key: string, size: number) => {
            const k = `${entityId}:${key}`
            setExpanded((prev) => ({...prev, [k]: !(prev[k] ?? size === 1)}))
        },
        [entityId, setExpanded],
    )

    return (
        <div className="flex flex-col gap-2">
            <SubSectionHeader label="Connected apps" count={totalCount} />
            {resolved.map((group) => {
                const open = isGroupOpen(group.key, group.items.length)
                return (
                    <CollapsibleProviderGroup
                        key={group.key}
                        logo={group.logo}
                        name={group.name}
                        countText={`${group.items.length} ${
                            group.items.length === 1 ? "tool" : "tools"
                        }`}
                        open={open}
                        onToggle={() => toggleGroup(group.key, group.items.length)}
                        onAdd={
                            !disabled && onOpenIntegration
                                ? () => onOpenIntegration(group.key)
                                : undefined
                        }
                        addLabel={`Add ${group.name} tool`}
                    >
                        {group.items.map(({item, index}) => (
                            <ItemChildRow
                                key={`tool-${index}`}
                                descriptor={describeTool(item)}
                                onEdit={() =>
                                    openEdit("tool", index, item, ITEM_KINDS.tool.editView(item))
                                }
                                onRemove={() => {
                                    removeItem("tool", index)
                                    closeEditor()
                                }}
                                disabled={disabled}
                            />
                        ))}
                    </CollapsibleProviderGroup>
                )
            })}
        </div>
    )
}

export function ToolManagementList({
    tools,
    entityId,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    onOpenIntegration,
    emptyAdd,
}: ToolManagementListProps) {
    // Partition by kind, preserving each tool's original index (edit/remove address the flat array).
    // Uses only the tool object — no catalog needed here.
    const {gatewayGroups, gatewayCount, references, definitions, builtins} = useMemo(() => {
        const references: IndexedTool[] = []
        const definitions: IndexedTool[] = []
        const builtins: IndexedTool[] = []
        const groups = new Map<string, ToolProviderGroup>()
        tools.forEach((item, index) => {
            const t = (item ?? {}) as Record<string, unknown>
            if (t.type === "reference") {
                references.push({item, index})
                return
            }
            const gw = parseGatewayFunctionName(toolName(item))
            if (gw) {
                let group = groups.get(gw.integration)
                if (!group) {
                    group = {key: gw.integration, items: []}
                    groups.set(gw.integration, group)
                }
                group.items.push({item, index})
                return
            }
            if (!isFunctionTool(item)) {
                builtins.push({item, index})
                return
            }
            definitions.push({item, index})
        })
        const gatewayGroups = [...groups.values()]
        const gatewayCount = gatewayGroups.reduce((n, g) => n + g.items.length, 0)
        return {gatewayGroups, gatewayCount, references, definitions, builtins}
    }, [tools])

    if (tools.length === 0) {
        if (disabled) return null
        return (
            <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                {ITEM_KINDS.tool.emptyLabel} — {emptyAdd}
            </span>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {gatewayGroups.length > 0 && (
                <GatewayGroups
                    groups={gatewayGroups}
                    totalCount={gatewayCount}
                    entityId={entityId}
                    openEdit={openEdit}
                    removeItem={removeItem}
                    closeEditor={closeEditor}
                    disabled={disabled}
                    onOpenIntegration={onOpenIntegration}
                />
            )}
            <FlatToolSection
                label="Workflow references"
                entries={references}
                openEdit={openEdit}
                removeItem={removeItem}
                closeEditor={closeEditor}
                disabled={disabled}
            />
            <FlatToolSection
                label="Tool definitions"
                entries={definitions}
                openEdit={openEdit}
                removeItem={removeItem}
                closeEditor={closeEditor}
                disabled={disabled}
            />
            <FlatToolSection
                label="Built-in"
                entries={builtins}
                openEdit={openEdit}
                removeItem={removeItem}
                closeEditor={closeEditor}
                disabled={disabled}
            />
        </div>
    )
}
