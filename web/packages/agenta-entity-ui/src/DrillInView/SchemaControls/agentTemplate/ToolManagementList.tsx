/**
 * ToolManagementList
 *
 * The Tools section body. Connected apps are listed as INTEGRATIONS: one row per integration,
 * whatever format its entries are saved in. Adding an integration adds all of its tools, so the row
 * summarizes the integration's permission policy and opens the permission drawer; there is no
 * per-row expansion and no per-row plus any more. The other kinds — workflow references, tool
 * definitions, and built-ins — stay flat row lists.
 *
 * A row is built from BOTH saved formats. An integration still on the legacy per-action entries
 * carries an "old format" tag until its drawer is opened, which is what migrates it.
 *
 * Provider details (for app names and logos) only load when integrations exist — each row's detail
 * hook mounts only when that row exists. Dark-safe (`--ag-color*` tokens only).
 */
import {type ReactNode, useMemo} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {humanizeActionKey} from "@agenta/shared/utils"

import type {ConfigItemView} from "../ConfigItemDrawer"
import {integrationPermissionSummary} from "../integrationPolicy"
import {ProviderLogo, SubSectionHeader} from "../sectionGroups"
import {integrationRowIndices, isHarnessBuiltinTool, type IntegrationRow} from "../toolUtils"

import {describeTool, isFunctionTool} from "./itemDescriptors"
import {ITEM_KINDS} from "./itemKinds"
import {ItemRow, type ItemRowStatus, type ItemRowStatusTone} from "./ItemRow"
import {PolicyGlyph} from "./PermissionGlyph"
import {SectionAddButton} from "./SectionAddButton"

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
    /** The integration rows, derived from the same `tools` by the owning hook. Passed in rather
     *  than rebuilt here, so the rows this list renders ARE the ones the drawers act on. */
    integrationRows: IntegrationRow[]
    openEdit: (kind: "tool", index: number, item: unknown, view: ConfigItemView) => void
    removeItem: (kind: "tool", index: number) => void
    closeEditor: () => void
    disabled?: boolean
    /** Opens the add-integration drawer (the integrations header plus). */
    onAddIntegration?: () => void
    /** Opens one integration's permission drawer. Migrates its legacy entries first. */
    onOpenIntegration?: (row: IntegrationRow) => void
    /** Drops every entry an integration owns, in one write. */
    onRemoveIntegration?: (row: IntegrationRow) => void
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
 * The integration rows. Isolated in its own component so the (paginated) catalog detail queries
 * only run when integrations actually exist.
 */
function IntegrationSection({
    rows,
    tools,
    disabled,
    onAddIntegration,
    onOpenIntegration,
    onRemoveIntegration,
    statusFor,
}: {
    rows: IntegrationRow[]
    tools: unknown[]
    disabled?: boolean
    onAddIntegration?: () => void
    onOpenIntegration?: (row: IntegrationRow) => void
    onRemoveIntegration?: (row: IntegrationRow) => void
    statusFor?: ToolStatusFor
}) {
    return (
        <div className="flex flex-col gap-2">
            <SubSectionHeader
                label="Integrations"
                count={rows.length}
                action={
                    !disabled && onAddIntegration ? (
                        <SectionAddButton label="Add integration" onClick={onAddIntegration} />
                    ) : undefined
                }
            />
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

export function ToolManagementList({
    tools,
    integrationRows,
    openEdit,
    removeItem,
    closeEditor,
    disabled,
    onAddIntegration,
    onOpenIntegration,
    onRemoveIntegration,
    emptyAdd,
    statusFor,
}: ToolManagementListProps) {
    // Partition the rest by kind, preserving each tool's original index (edit and remove address
    // the flat array). The integration rows already claim their own positions.
    const {references, definitions, builtins, visibleCount} = useMemo(() => {
        const references: IndexedTool[] = []
        const definitions: IndexedTool[] = []
        const builtins: IndexedTool[] = []
        const claimed = new Set(integrationRows.flatMap(integrationRowIndices))
        tools.forEach((item, index) => {
            // Legacy harness built-ins are inert: they render nowhere.
            if (isHarnessBuiltinTool(item) || claimed.has(index)) return
            const t = (item ?? {}) as Record<string, unknown>
            if (t.type === "reference") {
                references.push({item, index})
                return
            }
            if (!isFunctionTool(item)) {
                builtins.push({item, index})
                return
            }
            definitions.push({item, index})
        })
        const visibleCount = claimed.size + references.length + definitions.length + builtins.length
        return {references, definitions, builtins, visibleCount}
    }, [tools, integrationRows])

    // A config carrying only legacy built-in entries renders as empty, so it gets the empty state.
    if (visibleCount === 0) {
        if (disabled) return null
        return (
            <span className="text-xs text-[var(--ag-zinc-5)]">
                {ITEM_KINDS.tool.emptyLabel} — {emptyAdd}
            </span>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {integrationRows.length > 0 && (
                <IntegrationSection
                    rows={integrationRows}
                    tools={tools}
                    disabled={disabled}
                    onAddIntegration={onAddIntegration}
                    onOpenIntegration={onOpenIntegration}
                    onRemoveIntegration={onRemoveIntegration}
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
