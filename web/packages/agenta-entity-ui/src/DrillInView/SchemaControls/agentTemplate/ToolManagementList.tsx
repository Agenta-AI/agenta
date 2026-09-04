/** The Integrations and Subagents section bodies, both read off the flat `tools` array. Function
 *  tool definitions and provider built-ins are deliberately not rendered: they still run. */
import {type CSSProperties, type ReactNode, useMemo} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {humanizeActionKey} from "@agenta/shared/utils"

import type {ConfigItemView} from "../ConfigItemDrawer"
import {integrationPermissionSummary} from "../integrationPolicy"
import {ProviderLogo} from "../sectionGroups"
import {integrationRowIndices, isHarnessBuiltinTool, type IntegrationRow} from "../toolUtils"

import {
    describeSubagent,
    isReferenceTool,
    toolReferenceSlug,
    type ItemDescriptor,
} from "./itemDescriptors"
import {ITEM_KINDS} from "./itemKinds"
import {ItemRow, type ItemRowStatus, type ItemRowStatusTone} from "./ItemRow"
import {PolicyGlyph} from "./PermissionGlyph"

/** Per-tool draft/validation status, keyed by the tool's index in the flat `tools` array. */
type ToolStatusFor = (item: unknown, index: number) => ItemRowStatus | undefined

interface IndexedTool {
    item: unknown
    index: number
}

// Blocking problems outrank draft markers, mirroring the section-header rollup.
const STATUS_TONE_PRIORITY: Record<ItemRowStatusTone, number> = {
    invalid: 0,
    incomplete: 1,
    edited: 2,
    new: 3,
}

/** The worst status among an integration's entries, so one row still points at the problem. */
function rollupRowStatus(
    tools: unknown[],
    indices: number[],
    statusFor?: ToolStatusFor,
): ItemRowStatus | undefined {
    if (!statusFor) return undefined
    let worst: ItemRowStatus | undefined
    let count = 0
    for (const index of indices) {
        const status = statusFor(tools[index], index)
        if (!status) continue
        if (!worst || STATUS_TONE_PRIORITY[status.tone] < STATUS_TONE_PRIORITY[worst.tone]) {
            worst = status
            count = 1
        } else if (status.tone === worst.tone) {
            count += 1
        }
    }
    if (!worst) return undefined
    return count > 1 ? {...worst, tooltip: `${count} entries — open the integration.`} : worst
}

/** Glyph plus short label for a row's saved policy. Custom appends its override count. */
function PermissionSummary({row}: {row: IntegrationRow}) {
    if (!row.entry) return null
    const {preset, label} = integrationPermissionSummary(row.entry.permissions)
    return (
        <span
            className={`flex items-center gap-1.5 text-xs ${
                preset === "custom"
                    ? "text-[var(--ag-colorWarningText)]"
                    : "text-[var(--ag-colorTextSecondary)]"
            }`}
        >
            <PolicyGlyph value={preset} />
            {label}
        </span>
    )
}

function IntegrationListRow({
    row,
    tools,
    onOpen,
    onRemove,
    disabled,
    statusFor,
}: {
    row: IntegrationRow
    tools: unknown[]
    onOpen: () => void
    onRemove: () => void
    disabled?: boolean
    statusFor?: ToolStatusFor
}) {
    // Selected-integration metadata must not come from the searchable browse query: typing in the
    // open catalog changes that query's pages and would make existing rows lose their logos.
    const {integration} = useToolIntegrationDetail(row.integration)
    const name = integration?.name || humanizeActionKey(row.integration) || "Other"
    const indices = useMemo(() => integrationRowIndices(row), [row])
    const status = useMemo(
        () => rollupRowStatus(tools, indices, statusFor),
        [tools, indices, statusFor],
    )

    return (
        <ItemRow
            descriptor={{
                name,
                monoName: false,
                mono: "",
                // The logo carries the identity here, so the avatar square stays out of the way.
                color: "transparent",
                icon: <ProviderLogo logo={integration?.logo ?? null} size={20} />,
                tags: row.legacyIndices.length > 0 ? ["old format"] : [],
                typeLabel: "integration",
                subtitle: `Integration · ${row.integration}`,
            }}
            onEdit={onOpen}
            onRemove={onRemove}
            disabled={disabled}
            extra={<PermissionSummary row={row} />}
            status={status}
        />
    )
}

export interface ToolManagementListProps {
    tools: unknown[]
    /** The integration rows, passed in so the rows rendered ARE the ones the drawers act on. */
    integrationRows: IntegrationRow[]
    disabled?: boolean
    /** Opens one integration's permission drawer. Migrates its legacy entries first. */
    onOpenIntegration?: (row: IntegrationRow) => void
    /** Drops every entry an integration owns, in one write. */
    onRemoveIntegration?: (row: IntegrationRow) => void
    /** Add trigger shown in the empty state. Omitted when there is no drawer to open. */
    emptyAdd?: ReactNode
    /** Per-tool draft/validation status (unsaved edits, missing fields). */
    statusFor?: ToolStatusFor
}

/** Shared empty-state line. The add half is optional: a host with no drawer renders no control. */
function EmptyLine({label, add}: {label: string; add?: ReactNode}) {
    return (
        <span className="text-xs text-[var(--ag-zinc-5)]">
            {label}
            {add ? <> — {add}</> : null}
        </span>
    )
}

/** The Integrations section body: one row per connected app, no sub-header. */
export function ToolManagementList({
    tools,
    integrationRows,
    disabled,
    onOpenIntegration,
    onRemoveIntegration,
    emptyAdd,
    statusFor,
}: ToolManagementListProps) {
    if (integrationRows.length === 0) {
        if (disabled) return null
        return <EmptyLine label="No integrations yet" add={emptyAdd} />
    }

    return (
        <div className="flex flex-col gap-2">
            {integrationRows.map((row) => (
                <IntegrationListRow
                    key={`${row.provider}:${row.integration}`}
                    row={row}
                    tools={tools}
                    onOpen={() => onOpenIntegration?.(row)}
                    onRemove={() => onRemoveIntegration?.(row)}
                    disabled={disabled || !onOpenIntegration}
                    statusFor={statusFor}
                />
            ))}
        </div>
    )
}

/** The saved subagents. Stored as `{type: "reference"}` entries; each keeps its array index,
 *  because edit and remove address it by index. */
export function selectSubagentTools(
    tools: unknown[],
    integrationRows: IntegrationRow[],
): IndexedTool[] {
    const claimed = new Set(integrationRows.flatMap(integrationRowIndices))
    const entries: IndexedTool[] = []
    tools.forEach((item, index) => {
        // Legacy harness built-ins are inert: they render nowhere.
        if (isHarnessBuiltinTool(item) || claimed.has(index)) return
        if (isReferenceTool(item)) entries.push({item, index})
    })
    return entries
}

export interface SubagentListProps {
    entries: IndexedTool[]
    /** Saved references whose workflow is not an agent. Listed and removable, never addable. */
    nonAgentSlugs?: Set<string>
    /** Each subagent's icon chrome by slug. Only the caller can reach the icon record. */
    chromeBySlug?: Map<string, {glyph: ReactNode; className: string; style?: CSSProperties}>
    /** Each subagent's CURRENT agent name by slug. Only the caller can resolve the artifact. */
    nameBySlug?: Map<string, string>
    openEdit: (kind: "tool", index: number, item: unknown, view: ConfigItemView) => void
    removeItem: (kind: "tool", index: number) => void
    closeEditor: () => void
    disabled?: boolean
    /** Add trigger shown in the empty state. Omitted when there is no picker to open. */
    emptyAdd?: ReactNode
    statusFor?: ToolStatusFor
}

/** The Subagents section body: a flat row list, no sub-header. */
/** Tag a reference whose workflow is not an agent, so it stays visible and removable. */
function markNonAgent(
    descriptor: ItemDescriptor,
    item: unknown,
    nonAgentSlugs?: Set<string>,
): ItemDescriptor {
    if (!nonAgentSlugs?.size) return descriptor
    const slug = toolReferenceSlug(item)
    if (!slug || !nonAgentSlugs.has(slug)) return descriptor
    return {...descriptor, tags: [...(descriptor.tags ?? []), "not an agent"]}
}

/** Stable per-entry keys: the saved reference's own slug, never its array position. A config
 *  hand-authored to repeat a slug (or to omit one) falls back to position. The two are namespaced
 *  apart so a slug that reads like a position cannot collide with one. */
function subagentKeys(entries: IndexedTool[]): string[] {
    const seen = new Set<string>()
    return entries.map(({item, index}) => {
        const slug = toolReferenceSlug(item)
        if (!slug || seen.has(slug)) return `subagent-index-${index}`
        seen.add(slug)
        return `subagent-slug-${slug}`
    })
}

export function SubagentList({
    entries,
    nonAgentSlugs,
    chromeBySlug,
    nameBySlug,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    emptyAdd,
    statusFor,
}: SubagentListProps) {
    const keys = subagentKeys(entries)

    if (entries.length === 0) {
        if (disabled) return null
        return <EmptyLine label="No subagents yet" add={emptyAdd} />
    }

    return (
        <div className="flex flex-col gap-2">
            {entries.map(({item, index}, position) => (
                <ItemRow
                    key={keys[position]}
                    descriptor={markNonAgent(
                        describeSubagent(
                            item,
                            chromeBySlug?.get(toolReferenceSlug(item) ?? ""),
                            nameBySlug?.get(toolReferenceSlug(item) ?? ""),
                        ),
                        item,
                        nonAgentSlugs,
                    )}
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
    )
}
