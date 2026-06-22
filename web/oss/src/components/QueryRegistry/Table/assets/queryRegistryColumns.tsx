import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {SkeletonLine, createStandardColumns, formatDateCell} from "@agenta/ui/table"
import {
    ArchiveIcon,
    ArrowCounterClockwise,
    ChartDonutIcon,
    CopySimple,
    Eye,
    MinusCircle,
    PencilSimple,
    PlusCircle,
} from "@phosphor-icons/react"
import {Popover, Tag, Typography} from "antd"

import type {QueryRegistryRow} from "../../store/queryRegistryStore"

/** Controlled expand state for the version-history rows (mirrors the registry table). */
export interface QueryExpandState {
    expandedRowKeys: string[]
    handleExpand: (expanded: boolean, record: QueryRegistryRow) => void
}

const {Text} = Typography

interface FilterLeaf {
    field: string
    key?: string
    operator?: string
    value?: unknown
}

/**
 * Flatten a (possibly nested AND/OR) filtering tree into its leaf conditions.
 * Drives the filter-summary cell (design D1): the first chips render inline, the
 * full set in a popover.
 */
export function flattenConditions(filtering: unknown): FilterLeaf[] {
    if (!filtering || typeof filtering !== "object") return []
    const node = filtering as {
        conditions?: unknown[]
        field?: unknown
        key?: unknown
        operator?: unknown
        value?: unknown
    }
    if (!Array.isArray(node.conditions)) {
        if (typeof node.field !== "string") return []
        return [
            {
                field: node.field,
                key: typeof node.key === "string" ? node.key : undefined,
                operator: typeof node.operator === "string" ? node.operator : undefined,
                value: node.value,
            },
        ]
    }
    return node.conditions.flatMap(flattenConditions)
}

/** field → friendly label + value-option labels, derived from the Filters config. */
export type FieldLabelMap = Map<string, {label: string; values: Map<string, string>}>

interface FilterColumnNode {
    kind?: string
    label?: string
    displayLabel?: string
    field?: string
    value?: string
    children?: FilterColumnNode[]
    valueInput?: {options?: {label: string; value: unknown}[]}
}

/**
 * Walk the Filters menu tree and build a field → label map so the chips read
 * "Trace Type is Invocation" instead of the raw "trace_type is invocation"
 * (design D1: reuse the Filters component's labels).
 */
export function buildFieldLabelMap(nodes: readonly unknown[]): FieldLabelMap {
    const map: FieldLabelMap = new Map()
    const walk = (items?: readonly unknown[]) => {
        for (const raw of items ?? []) {
            const node = raw as FilterColumnNode
            if (node.children?.length) {
                walk(node.children)
                continue
            }
            const field = node.field ?? node.value
            if (!field) continue
            const values = new Map<string, string>()
            for (const option of node.valueInput?.options ?? []) {
                values.set(String(option.value), option.label)
            }
            map.set(field, {label: node.displayLabel ?? node.label ?? field, values})
        }
    }
    walk(nodes)
    return map
}

/** Compact, human label for one condition (e.g. `Trace Type is Invocation`). */
function conditionLabel({field, key, operator, value}: FilterLeaf, labels?: FieldLabelMap): string {
    const info = labels?.get(field)
    const fieldLabel = info?.label ?? field
    const lhs = key ? `${fieldLabel}.${key}` : fieldLabel
    const op = operator ? ` ${operator}` : ""
    let rhs = ""
    if (value !== undefined && value !== null) {
        const toLabel = (v: unknown) => info?.values.get(String(v)) ?? String(v)
        rhs = Array.isArray(value) ? ` ${value.map(toLabel).join(", ")}` : ` ${toLabel(value)}`
    }
    return `${lhs}${op}${rhs}`.trim()
}

export interface QueryColumnActions {
    handleOpen?: (record: QueryRegistryRow) => void
    handleEdit?: (record: QueryRegistryRow) => void
    handleDuplicate?: (record: QueryRegistryRow) => void
    handleRunAutoEval?: (record: QueryRegistryRow) => void
    handleArchive?: (record: QueryRegistryRow) => void
    handleRestore?: (record: QueryRegistryRow) => void
}

/**
 * Row actions differ by tab: the Active tab edits/duplicates/archives; the
 * Archived tab only restores (editing an archived query is meaningless — it would
 * commit a revision on a soft-deleted artifact).
 */
/** Active expand child rows carry no parent-level actions (Open/Edit/Duplicate). */
const isRevisionRow = (record: QueryRegistryRow) => Boolean(record.__isRevisionChild)

function buildActionItems(actions: QueryColumnActions, isArchived: boolean) {
    if (isArchived) {
        return [
            {
                key: "restore",
                label: "Restore",
                icon: <ArrowCounterClockwise size={16} />,
                hidden: isRevisionRow,
                onClick: (record: QueryRegistryRow) => actions.handleRestore?.(record),
            },
        ]
    }
    return [
        {
            key: "open",
            label: "Open details",
            icon: <Eye size={16} />,
            hidden: isRevisionRow,
            onClick: (record: QueryRegistryRow) => actions.handleOpen?.(record),
        },
        {
            key: "run-auto-eval",
            label: "Run auto evaluation",
            icon: <ChartDonutIcon size={14} />,
            hidden: isRevisionRow,
            onClick: (record: QueryRegistryRow) => actions.handleRunAutoEval?.(record),
        },
        {
            key: "edit",
            label: "Edit",
            icon: <PencilSimple size={16} />,
            hidden: isRevisionRow,
            onClick: (record: QueryRegistryRow) => actions.handleEdit?.(record),
        },
        {
            key: "duplicate",
            label: "Duplicate",
            icon: <CopySimple size={16} />,
            hidden: isRevisionRow,
            onClick: (record: QueryRegistryRow) => actions.handleDuplicate?.(record),
        },
        {type: "divider" as const, hidden: isRevisionRow},
        {
            // Visible on revision rows too: the parent archives the whole query, a
            // revision row archives just that version (which moves it to Archived).
            key: "archive",
            label: "Archive",
            icon: <ArchiveIcon size={14} />,
            danger: true,
            onClick: (record: QueryRegistryRow) => actions.handleArchive?.(record),
        },
    ]
}

export function createQueryRegistryColumns(
    actions: QueryColumnActions,
    labels?: FieldLabelMap,
    isArchived = false,
    expandState?: QueryExpandState,
) {
    return createStandardColumns<QueryRegistryRow>([
        {
            type: "text",
            key: "name",
            title: "Name",
            width: 280,
            fixed: "left",
            columnVisibilityLocked: true,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="70%" />
                // Revision (child) row in the active expand: indent + version badge.
                if (record.__isRevisionChild) {
                    return (
                        <div className="flex h-full items-center gap-2 pl-7">
                            <Text className="text-xs">{record.name}</Text>
                            {record.version ? (
                                <Tag className="m-0 text-xs">v{record.version}</Tag>
                            ) : null}
                        </div>
                    )
                }
                // Archived-revision row (archived tab, top-level): name + version +
                // an Archived tag, aligned with the non-toggle rows.
                if (record.__isArchivedRevision) {
                    return (
                        <div className="flex h-full min-w-0 items-center gap-2">
                            <span className="w-4 shrink-0" />
                            <Text type="secondary" className="text-xs">
                                {record.name}
                            </Text>
                            {record.version ? (
                                <Tag className="m-0 text-xs">v{record.version}</Tag>
                            ) : null}
                            <Tag className="m-0 text-xs">Archived</Tag>
                        </div>
                    )
                }
                // Head (parent) row: it IS the latest revision — show its version
                // badge, plus the expand toggle when there are earlier versions.
                // A <span> (not <button>) avoids the default button chrome/focus box;
                // a spacer keeps names aligned when a query has no history.
                const hasHistory = Array.isArray(record.children) && record.children.length > 0
                const isExpanded = expandState?.expandedRowKeys.includes(record.key) ?? false
                return (
                    <div className="flex h-full min-w-0 items-center gap-2">
                        {expandState && hasHistory ? (
                            <span
                                aria-label={isExpanded ? "Hide versions" : "Show versions"}
                                className="shrink-0 cursor-pointer leading-[1] text-gray-400 transition-colors hover:text-gray-600"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    expandState.handleExpand(!isExpanded, record)
                                }}
                            >
                                {isExpanded ? <MinusCircle size={16} /> : <PlusCircle size={16} />}
                            </span>
                        ) : (
                            <span className="w-4 shrink-0" />
                        )}
                        <Text className="text-xs font-medium">{record.name}</Text>
                        {record.version ? (
                            <Tag className="m-0 text-xs">v{record.version}</Tag>
                        ) : null}
                        {/* Parent row is the head revision — flag it as the latest. */}
                        {record.version ? (
                            <span className="flex items-center gap-1.5">
                                <Tag color="blue" className="m-0 text-xs">
                                    Last modified
                                </Tag>
                                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#9254de]" />
                            </span>
                        ) : null}
                    </div>
                )
            },
        },
        {
            type: "text",
            key: "filter",
            title: "Filter",
            width: 260,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="40%" />
                const conditions = flattenConditions(record.filtering)
                if (conditions.length === 0) {
                    return (
                        <div className="flex h-full items-center">
                            <Text type="secondary" className="text-xs">
                                No filter
                            </Text>
                        </div>
                    )
                }
                const shown = conditions.slice(0, 2)
                const rest = conditions.length - shown.length
                return (
                    // Hover + focus + click so keyboard and touch users reach the
                    // full filter, not just mouse hover (design Pass 6 a11y).
                    <Popover
                        trigger={["hover", "focus", "click"]}
                        content={
                            <div className="flex max-w-[320px] flex-col items-start gap-1">
                                {conditions.map((condition, index) => (
                                    <Tag key={index} className="m-0 text-xs">
                                        {conditionLabel(condition, labels)}
                                    </Tag>
                                ))}
                            </div>
                        }
                    >
                        <span tabIndex={0} className="flex h-full flex-wrap items-center gap-1">
                            {shown.map((condition, index) => (
                                <Tag key={index} className="m-0 text-xs">
                                    {conditionLabel(condition, labels)}
                                </Tag>
                            ))}
                            {rest > 0 ? (
                                <Text type="secondary" className="text-xs">
                                    +{rest} more
                                </Text>
                            ) : null}
                        </span>
                    </Popover>
                )
            },
        },
        {
            type: "text",
            key: "createdAt",
            title: "Created on",
            width: 160,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                return (
                    <div className="flex h-full items-center">
                        <Text className="text-xs">{formatDateCell(record.createdAt)}</Text>
                    </div>
                )
            },
        },
        {
            type: "text",
            key: "createdBy",
            title: "Created by",
            width: 180,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                if (!record.createdById) {
                    return (
                        <div className="flex h-full items-center">
                            <Text type="secondary" className="text-xs">
                                —
                            </Text>
                        </div>
                    )
                }
                return (
                    <div className="flex h-full items-center">
                        <UserAuthorLabel
                            userId={record.createdById}
                            showPrefix={false}
                            showAvatar
                            showYouLabel
                        />
                    </div>
                )
            },
        },
        {
            type: "text",
            key: "message",
            title: "Commit message",
            width: 220,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                if (!record.message) {
                    return (
                        <div className="flex h-full items-center">
                            <Text type="secondary" className="text-xs">
                                —
                            </Text>
                        </div>
                    )
                }
                return (
                    <div className="flex h-full items-center">
                        <Text className="text-xs" ellipsis={{tooltip: record.message}}>
                            {record.message}
                        </Text>
                    </div>
                )
            },
        },
        {
            type: "actions",
            width: 48,
            maxWidth: 48,
            items: buildActionItems(actions, isArchived),
            getRecordId: (record: QueryRegistryRow) => record.queryId,
        },
    ])
}
