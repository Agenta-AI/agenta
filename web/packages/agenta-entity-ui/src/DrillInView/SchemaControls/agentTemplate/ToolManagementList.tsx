/**
 * ToolManagementList and SubagentList
 *
 * The two agent-config section bodies that read the flat `tools` array. ToolManagementList is the
 * INTEGRATIONS body: one row per connected app, whatever format its entries are saved in. Adding an
 * integration adds all of its tools, so the row summarizes the integration's permission policy and
 * opens the permission drawer; there is no per-row expansion and no per-row plus. SubagentList is
 * the SUBAGENTS body: the referenced workflows the agent can call, as a flat row list.
 *
 * Neither body draws a sub-header any more. Each is the whole content of its own accordion section,
 * and that section's header owns the title, the count, and the add button.
 *
 * Function tool definitions and provider built-ins are deliberately NOT rendered. Tool definitions
 * were removed as a feature. An older config may still carry either kind: those entries stay in the
 * saved config and still run, but this panel neither lists nor edits them.
 *
 * A row is built from BOTH saved formats. An integration still on the legacy per-action entries
 * carries an "old format" tag until its drawer is opened, which is what migrates it.
 *
 * Provider details (for app names and logos) only load when integrations exist — each row's detail
 * hook mounts only when that row exists. Dark-safe (`--ag-color*` tokens only).
 */
import {type ReactNode, useMemo} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"

import type {ConfigItemView} from "../ConfigItemDrawer"
import {integrationPermissionSummary} from "../integrationPolicy"
import {ProviderLogo} from "../sectionGroups"
import {integrationRowIndices, isHarnessBuiltinTool, type IntegrationRow} from "../toolUtils"

import {describeTool} from "./itemDescriptors"
import {ITEM_KINDS} from "./itemKinds"
import {ItemRow, type ItemRowStatus, type ItemRowStatusTone} from "./ItemRow"
import {PolicyGlyph} from "./PermissionGlyph"

/** Per-tool draft/validation status, keyed by the tool's index in the flat `tools` array. */
type ToolStatusFor = (item: unknown, index: number) => ItemRowStatus | undefined

interface IndexedTool {
    item: unknown
    index: number
}

function prettifyIntegration(key: string): string {
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
    const name = integration?.name || prettifyIntegration(row.integration)
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
    /** The integration rows, derived from the same `tools` by the owning hook. Passed in rather
     *  than rebuilt here, so the rows this list renders ARE the ones the drawers act on. */
    integrationRows: IntegrationRow[]
    disabled?: boolean
    /** Opens one integration's permission drawer. Migrates its legacy entries first. */
    onOpenIntegration?: (row: IntegrationRow) => void
    /** Drops every entry an integration owns, in one write. */
    onRemoveIntegration?: (row: IntegrationRow) => void
    /** Add trigger shown in the empty state. Opens the add-integration drawer directly. */
    emptyAdd: ReactNode
    /** Per-tool draft/validation status (unsaved edits, missing fields). */
    statusFor?: ToolStatusFor
}

/** Shared empty-state line, so both bodies read the same. */
function EmptyLine({label, add}: {label: string; add: ReactNode}) {
    return (
        <span className="text-xs text-[var(--ag-zinc-5)]">
            {label} — {add}
        </span>
    )
}

/**
 * The integration rows. Isolated in its own component so the (paginated) catalog detail queries
 * only run when integrations actually exist.
 */
function IntegrationSection({
    rows,
    tools,
    disabled,
    onOpenIntegration,
    onRemoveIntegration,
    statusFor,
}: {
    rows: IntegrationRow[]
    tools: unknown[]
    disabled?: boolean
    onOpenIntegration?: (row: IntegrationRow) => void
    onRemoveIntegration?: (row: IntegrationRow) => void
    statusFor?: ToolStatusFor
}) {
    return (
        <div className="flex flex-col gap-2">
            {rows.map((row) => (
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

/**
 * The Integrations section body: one row per connected app, no sub-header. The section header owns
 * the add button, so this list renders rows only.
 */
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
        <IntegrationSection
            rows={integrationRows}
            tools={tools}
            disabled={disabled}
            onOpenIntegration={onOpenIntegration}
            onRemoveIntegration={onRemoveIntegration}
            statusFor={statusFor}
        />
    )
}

/**
 * The referenced workflows the agent can call, which the product calls SUBAGENTS. They live in the
 * same flat `tools` array as everything else and are saved as `{type: "reference"}`, so the wire
 * format keeps the old name; only the surface says "subagent".
 *
 * Each entry keeps its index in that array, because edit and remove address it by index.
 */
export function selectSubagentTools(
    tools: unknown[],
    integrationRows: IntegrationRow[],
): IndexedTool[] {
    const claimed = new Set(integrationRows.flatMap(integrationRowIndices))
    const entries: IndexedTool[] = []
    tools.forEach((item, index) => {
        // Legacy harness built-ins are inert: they render nowhere.
        if (isHarnessBuiltinTool(item) || claimed.has(index)) return
        const t = (item ?? {}) as Record<string, unknown>
        if (t.type === "reference") entries.push({item, index})
    })
    return entries
}

export interface SubagentListProps {
    entries: IndexedTool[]
    openEdit: (kind: "tool", index: number, item: unknown, view: ConfigItemView) => void
    removeItem: (kind: "tool", index: number) => void
    closeEditor: () => void
    disabled?: boolean
    /** Add trigger shown in the empty state. Opens the workflow picker directly. */
    emptyAdd: ReactNode
    statusFor?: ToolStatusFor
}

/**
 * The Subagents section body: a flat row list, no sub-header. The section header owns the add
 * button, which opens the workflow picker directly.
 */
export function SubagentList({
    entries,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    emptyAdd,
    statusFor,
}: SubagentListProps) {
    if (entries.length === 0) {
        if (disabled) return null
        return <EmptyLine label="No subagents yet" add={emptyAdd} />
    }

    return (
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
    )
}
