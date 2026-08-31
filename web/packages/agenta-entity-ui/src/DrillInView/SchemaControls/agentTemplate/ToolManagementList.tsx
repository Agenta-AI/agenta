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

import {
    describeTool,
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
    /** Add trigger shown in the empty state. Omitted when there is no drawer to open. */
    emptyAdd?: ReactNode
    /** Per-tool draft/validation status (unsaved edits, missing fields). */
    statusFor?: ToolStatusFor
}

/** Shared empty-state line, so both bodies read the same. The add half is optional: a host with
 *  no drawer to open must not render a control that does nothing. */
function EmptyLine({label, add}: {label: string; add?: ReactNode}) {
    return (
        <span className="text-xs text-[var(--ag-zinc-5)]">
            {label}
            {add ? <> — {add}</> : null}
        </span>
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
        if (isReferenceTool(item)) entries.push({item, index})
    })
    return entries
}

export interface SubagentListProps {
    entries: IndexedTool[]
    /** Saved references whose workflow is NOT an agent (a prompt, an evaluator, a custom
     *  workflow). They stay listed and removable, marked, so a reference saved before Subagents
     *  meant agents only cannot become invisible. Nothing new can be added for these. */
    nonAgentSlugs?: Set<string>
    openEdit: (kind: "tool", index: number, item: unknown, view: ConfigItemView) => void
    removeItem: (kind: "tool", index: number) => void
    closeEditor: () => void
    disabled?: boolean
    /** Add trigger shown in the empty state. Omitted when there is no picker to open. */
    emptyAdd?: ReactNode
    statusFor?: ToolStatusFor
}

/**
 * The Subagents section body: a flat row list, no sub-header. The section header owns the add
 * button, which opens the workflow picker directly.
 */
/**
 * Tag a row whose workflow is not an agent. Subagents means agent workflows, but a reference saved
 * before that was true can point at a prompt or an evaluator. Marking it says why it looks out of
 * place, and keeps it removable, instead of hiding it.
 */
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

/** Stable per-entry key: the saved reference's own identity, never its array position. */
function subagentKey(item: unknown, index: number): string {
    const t = (item ?? {}) as Record<string, unknown>
    const name = typeof t.name === "string" ? t.name : ""
    const identity = [toolReferenceSlug(item) ?? "", name].filter(Boolean).join("|")
    // A reference with nothing to identify it falls back to its position, which is still better
    // than colliding with another blank row.
    return identity || `subagent-${index}`
}

export function SubagentList({
    entries,
    nonAgentSlugs,
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
                    key={subagentKey(item, index)}
                    descriptor={markNonAgent(describeTool(item), item, nonAgentSlugs)}
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
