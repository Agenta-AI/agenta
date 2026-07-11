/**
 * ToolManagementList
 *
 * The Tools section body, structured to match the triggers section: tools are partitioned into
 * sub-sections — Connected apps (third-party/gateway tools **grouped by provider**, each an
 * expandable app card), Workflow references, Tool definitions, and Built-in — each with a labelled
 * count header. Connected-app grouping mirrors the trigger section's provider groups (shared
 * {@link CollapsibleProviderGroup} / {@link SubSectionHeader}); the other kinds are flat row lists.
 *
 * Provider details (for app names/logos) only load when there are gateway tools — the parent
 * partitions with the tool function-name alone, and each group's detail hook mounts only when that
 * group exists. Dark-safe (`--ag-color*` tokens only).
 */
import {type ReactNode, useMemo} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {ConfigItemView} from "../ConfigItemDrawer"
import {CollapsibleProviderGroup, SubSectionHeader} from "../sectionGroups"
import {parseGatewayTool} from "../toolUtils"

import {describeTool, isFunctionTool} from "./itemDescriptors"
import {ITEM_KINDS} from "./itemKinds"
import {
    ItemChildRow,
    ItemRow,
    StatusTag,
    type ItemRowStatus,
    type ItemRowStatusTone,
} from "./ItemRow"

/** Per-tool draft/validation status, keyed by the tool's index in the flat `tools` array. */
type ToolStatusFor = (item: unknown, index: number) => ItemRowStatus | undefined

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

interface GatewayProviderGroupProps {
    group: ToolProviderGroup
    entityId: string | null
    openEdit: ToolManagementListProps["openEdit"]
    removeItem: ToolManagementListProps["removeItem"]
    closeEditor: () => void
    disabled?: boolean
    onOpenIntegration?: (integrationKey?: string) => void
    statusFor?: ToolStatusFor
}

function prettifyProvider(key: string): string {
    if (!key) return "Other"
    return key.charAt(0).toUpperCase() + key.slice(1)
}

// Blocking problems outrank draft markers, mirroring the section-header rollup.
const STATUS_TONE_PRIORITY: Record<ItemRowStatusTone, number> = {
    invalid: 0,
    incomplete: 1,
    edited: 2,
    new: 3,
}

/** The group's worst child status, so a collapsed provider card still points at the problem. */
function rollupGroupStatus(
    items: IndexedTool[],
    statusFor?: ToolStatusFor,
): ItemRowStatus | undefined {
    if (!statusFor) return undefined
    let worst: ItemRowStatus | undefined
    let count = 0
    for (const {item, index} of items) {
        const status = statusFor(item, index)
        if (!status) continue
        if (!worst || STATUS_TONE_PRIORITY[status.tone] < STATUS_TONE_PRIORITY[worst.tone]) {
            worst = status
            count = 1
        } else if (status.tone === worst.tone) {
            count += 1
        }
    }
    if (!worst) return undefined
    return count > 1 ? {...worst, tooltip: `${count} tools — expand for details.`} : worst
}

function GatewayProviderGroup({
    group,
    entityId,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    onOpenIntegration,
    statusFor,
}: GatewayProviderGroupProps) {
    const [expanded, setExpanded] = useAtom(toolGroupsExpandedAtom)
    // Selected-tool metadata must not come from the searchable browse query: typing in the open
    // catalog changes that query's pages and would otherwise make existing groups lose their logos.
    const {integration} = useToolIntegrationDetail(group.key)
    const name = integration?.name || prettifyProvider(group.key)
    const open =
        (entityId ? expanded[`${entityId}:${group.key}`] : undefined) ?? group.items.length === 1
    // Collapsed only: expanded groups already show the tag on the offending row itself.
    const groupStatus = useMemo(
        () => (open ? undefined : rollupGroupStatus(group.items, statusFor)),
        [open, group.items, statusFor],
    )

    const toggle = () => {
        if (!entityId) return
        const key = `${entityId}:${group.key}`
        setExpanded((prev) => ({
            ...prev,
            [key]: !(prev[key] ?? group.items.length === 1),
        }))
    }

    return (
        <CollapsibleProviderGroup
            logo={integration?.logo ?? null}
            name={name}
            countText={`${group.items.length} ${group.items.length === 1 ? "tool" : "tools"}`}
            open={open}
            onToggle={toggle}
            onAdd={!disabled && onOpenIntegration ? () => onOpenIntegration(group.key) : undefined}
            addLabel={`Add ${name} tool`}
            statusTag={groupStatus ? <StatusTag status={groupStatus} /> : undefined}
        >
            {group.items.map(({item, index}) => (
                <ItemChildRow
                    key={`tool-${index}`}
                    descriptor={describeTool(item)}
                    onEdit={() => openEdit("tool", index, item, ITEM_KINDS.tool.editView(item))}
                    onRemove={() => {
                        removeItem("tool", index)
                        closeEditor()
                    }}
                    disabled={disabled}
                    status={statusFor?.(item, index)}
                />
            ))}
        </CollapsibleProviderGroup>
    )
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
    /** Per-tool draft/validation status (unsaved edits, missing fields). */
    statusFor?: ToolStatusFor
}

/** A flat, headed sub-section of bordered item rows (references / definitions / built-in). */
function FlatToolSection({
    label,
    entries,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    statusFor,
}: {
    label: string
    entries: IndexedTool[]
    openEdit: ToolManagementListProps["openEdit"]
    removeItem: ToolManagementListProps["removeItem"]
    closeEditor: () => void
    disabled?: boolean
    statusFor?: ToolStatusFor
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
                        status={statusFor?.(item, index)}
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
    statusFor,
}: {
    groups: ToolProviderGroup[]
    totalCount: number
    entityId: string | null
    openEdit: ToolManagementListProps["openEdit"]
    removeItem: ToolManagementListProps["removeItem"]
    closeEditor: () => void
    disabled?: boolean
    onOpenIntegration?: (integrationKey?: string) => void
    statusFor?: ToolStatusFor
}) {
    const orderedGroups = useMemo(
        () =>
            [...groups].sort((a, b) =>
                prettifyProvider(a.key).localeCompare(prettifyProvider(b.key)),
            ),
        [groups],
    )

    return (
        <div className="flex flex-col gap-2">
            <SubSectionHeader label="Connected apps" count={totalCount} />
            {orderedGroups.map((group) => (
                <GatewayProviderGroup
                    key={group.key}
                    group={group}
                    entityId={entityId}
                    openEdit={openEdit}
                    removeItem={removeItem}
                    closeEditor={closeEditor}
                    disabled={disabled}
                    onOpenIntegration={onOpenIntegration}
                    statusFor={statusFor}
                />
            ))}
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
    statusFor,
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
            const gw = parseGatewayTool(item)
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
                    statusFor={statusFor}
                />
            )}
            <FlatToolSection
                label="Workflow references"
                entries={references}
                openEdit={openEdit}
                removeItem={removeItem}
                closeEditor={closeEditor}
                disabled={disabled}
                statusFor={statusFor}
            />
            <FlatToolSection
                label="Tool definitions"
                entries={definitions}
                openEdit={openEdit}
                removeItem={removeItem}
                closeEditor={closeEditor}
                disabled={disabled}
                statusFor={statusFor}
            />
            <FlatToolSection
                label="Built-in"
                entries={builtins}
                openEdit={openEdit}
                removeItem={removeItem}
                closeEditor={closeEditor}
                disabled={disabled}
                statusFor={statusFor}
            />
        </div>
    )
}
