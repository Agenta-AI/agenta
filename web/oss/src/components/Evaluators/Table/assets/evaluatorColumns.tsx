import {memo, useSyncExternalStore} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {evaluatorTemplatesDataAtom, getEvaluatorColor} from "@agenta/entities/workflow"
import {SkeletonLine, createStandardColumns} from "@agenta/ui/table"
import {Eye, GearSix, MinusCircle, PencilSimple, PlusCircle, Trash} from "@phosphor-icons/react"
import {Tag, Typography} from "antd"
import type {Atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import type {EvaluatorCategory} from "../../assets/types"
import type {EvaluatorTableRow} from "../../store/evaluatorsPaginatedStore"

// ============================================================================
// HELPERS
// ============================================================================

/** Matches the date format used by IVT's built-in date columns. */
const formatDateDisplay = (value: string): string => {
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
        }).format(new Date(value))
    } catch {
        return value
    }
}

// ============================================================================
// DEFAULT STORE HOOK
// ============================================================================

/**
 * Reads an atom from Jotai's default store, bypassing any Provider scope.
 * IVT cell renderers run inside an isolated Jotai Provider,
 * but entity atoms live in the default store.
 */
function useDefaultStoreAtomValue<T>(atom: Atom<T>): T {
    const store = getDefaultStore()
    return useSyncExternalStore(
        (cb) => store.sub(atom, cb),
        () => store.get(atom),
        () => store.get(atom),
    )
}

// ============================================================================
// CELL RENDERERS
// ============================================================================

/**
 * Type badge cell for automatic evaluators.
 * Reads evaluatorKey directly from the revision row data.
 */
const EvaluatorTypeCell = memo(({evaluatorKey}: {evaluatorKey: string | null}) => {
    const templates = useDefaultStoreAtomValue(evaluatorTemplatesDataAtom)

    if (!evaluatorKey) return null

    const template = templates.find((t) => t.key === evaluatorKey)
    const label = template?.name ?? evaluatorKey
    const color = getEvaluatorColor(evaluatorKey)

    return (
        <Tag
            bordered
            style={
                color
                    ? {
                          backgroundColor: color.bg,
                          color: color.text,
                          borderColor: color.border,
                      }
                    : undefined
            }
            className="!m-0 capitalize"
        >
            {label}
        </Tag>
    )
})

/**
 * Tags cell for automatic evaluators.
 * Resolves template tags from evaluatorKey.
 */
const AutomaticTagsCell = memo(({evaluatorKey}: {evaluatorKey: string | null}) => {
    const templates = useDefaultStoreAtomValue(evaluatorTemplatesDataAtom)

    const template = evaluatorKey ? templates.find((t) => t.key === evaluatorKey) : null
    const tags = template?.tags ?? []

    if (!tags.length) return null

    return (
        <div className="flex items-center gap-1 h-full flex-wrap overflow-hidden">
            {tags.slice(0, 3).map((tag) => (
                <Tag
                    key={tag}
                    variant="filled"
                    className="!m-0 capitalize truncate max-w-[120px] bg-[#0517290F]"
                >
                    {tag}
                </Tag>
            ))}
            {tags.length > 3 && (
                <Typography.Text type="secondary" className="text-xs">
                    +{tags.length - 3}
                </Typography.Text>
            )}
        </div>
    )
})

/**
 * Feedback cell for human evaluators.
 * Reads output schema properties directly from the revision row data.
 */
const FeedbackCell = memo(
    ({outputProperties}: {outputProperties: Record<string, unknown> | null}) => {
        const metricNames = outputProperties ? Object.keys(outputProperties) : []

        if (!metricNames.length) return null

        return (
            <div className="flex items-center gap-1 h-full flex-wrap overflow-hidden">
                {metricNames.slice(0, 3).map((name) => (
                    <Tag
                        key={name}
                        variant="filled"
                        className="!m-0 truncate max-w-[120px] bg-[#0517290F]"
                    >
                        {name}
                    </Tag>
                ))}
                {metricNames.length > 3 && (
                    <Typography.Text type="secondary" className="text-xs">
                        +{metricNames.length - 3}
                    </Typography.Text>
                )}
            </div>
        )
    },
)

// ============================================================================
// COLUMN FACTORY
// ============================================================================

export interface EvaluatorColumnActions {
    handleConfigure?: (record: EvaluatorTableRow) => void
    handleEdit?: (record: EvaluatorTableRow) => void
    handleDelete?: (record: EvaluatorTableRow) => void
}

export interface EvaluatorExpandState {
    expandedRowKeys: string[]
    handleExpand: (expanded: boolean, record: EvaluatorTableRow) => void
}

export function createEvaluatorColumns(
    actions: EvaluatorColumnActions,
    category: EvaluatorCategory,
    expandState?: EvaluatorExpandState,
) {
    const columns = createStandardColumns<EvaluatorTableRow>([
        {
            type: "text",
            key: "name",
            title: "Name",
            width: 240,
            fixed: "left",
            columnVisibilityLocked: true,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="70%" />

                const isGroupParent = !!record.__isEvaluatorGroup
                const isGroupChild = !!record.__isGroupChild
                const displayName = record.name || "—"

                const revisionTag =
                    record.version != null ? (
                        <Tag className="bg-[rgba(5,23,41,0.06)] !m-0 shrink-0" variant="filled">
                            v{record.version}
                        </Tag>
                    ) : null

                // Grouped parent row — expand icon + name + revision tag
                if (isGroupParent && expandState) {
                    const isExpanded = expandState.expandedRowKeys.includes(String(record.key))
                    return (
                        <div className="flex items-center gap-2 h-full min-w-0">
                            <span
                                className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors shrink-0 leading-[1]"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    expandState.handleExpand(!isExpanded, record)
                                }}
                            >
                                {isExpanded ? <MinusCircle size={16} /> : <PlusCircle size={16} />}
                            </span>
                            <span className="truncate">{displayName}</span>
                            {(record.__revisionCount ?? 0) > 1 && revisionTag}
                        </div>
                    )
                }

                // Child row — indent to align with parent content
                if (isGroupChild) {
                    return (
                        <div className="flex items-center gap-2 h-full min-w-0 pl-6">
                            <span className="truncate">{displayName}</span>
                            {revisionTag}
                        </div>
                    )
                }

                // Flat mode
                return (
                    <div className="flex items-center gap-2 h-full min-w-0">
                        <span className="truncate">{displayName}</span>
                        {revisionTag}
                    </div>
                )
            },
        },
        ...(category !== "human"
            ? [
                  {
                      type: "text" as const,
                      key: "typeBadge",
                      title: "Type",
                      width: 180,
                      render: (_value: unknown, record: EvaluatorTableRow) => {
                          if (record.__isSkeleton) return <SkeletonLine width="50%" />
                          return <EvaluatorTypeCell evaluatorKey={record.evaluatorKey} />
                      },
                  },
              ]
            : []),
        {
            type: "text",
            key: "tags",
            title: category === "human" ? "Feedback" : "Tags",
            width: 260,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="40%" />
                if (category === "human") {
                    return <FeedbackCell outputProperties={record.outputProperties} />
                }
                return <AutomaticTagsCell evaluatorKey={record.evaluatorKey} />
            },
        },
        {
            type: "date",
            key: "createdAt",
            title: "Date Created",
            // For child rows in grouped view, show the revision's own created_at
            render: (_value: unknown, record: EvaluatorTableRow) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                const dateStr = record.__isGroupChild ? record.revisionCreatedAt : record.createdAt
                if (!dateStr) return null
                return (
                    <div className="h-full flex items-center">
                        <Typography.Text type="secondary" className="text-xs">
                            {formatDateDisplay(dateStr)}
                        </Typography.Text>
                    </div>
                )
            },
        },
        {
            type: "date",
            key: "updatedAt",
            title: "Last modified",
        },
        {
            type: "text",
            key: "modifiedBy",
            title: "Modified by",
            width: 200,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                if (!record.updatedById && !record.createdById) return null
                return (
                    <div className="h-full flex items-center">
                        <Typography.Text type="secondary" className="text-xs truncate block">
                            <UserAuthorLabel
                                userId={record.updatedById ?? record.createdById ?? ""}
                                showPrefix={false}
                                showAvatar
                                showYouLabel
                            />
                        </Typography.Text>
                    </div>
                )
            },
        },
        {
            type: "text",
            key: "commitMessage",
            title: "Commit message",
            width: 200,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="60%" />
                if (!record.commitMessage) return null
                return (
                    <div className="h-full flex items-center">
                        <Typography.Text type="secondary" className="text-xs truncate block">
                            {record.commitMessage}
                        </Typography.Text>
                    </div>
                )
            },
        },
        {
            type: "actions",
            width: 48,
            maxWidth: 48,
            items:
                category === "human"
                    ? [
                          {
                              key: "edit",
                              label: "Edit",
                              icon: <PencilSimple size={16} />,
                              onClick: (record: EvaluatorTableRow) => actions.handleEdit?.(record),
                          },
                          {type: "divider" as const},
                          {
                              key: "delete",
                              label: "Delete",
                              icon: <Trash size={16} />,
                              danger: true,
                              onClick: (record: EvaluatorTableRow) =>
                                  actions.handleDelete?.(record),
                          },
                      ]
                    : [
                          {
                              key: "configure",
                              label: "Configure",
                              icon: <GearSix size={16} />,
                              onClick: (record: EvaluatorTableRow) =>
                                  actions.handleConfigure?.(record),
                          },
                          {
                              key: "details",
                              label: "View details",
                              icon: <Eye size={16} />,
                              onClick: (record: EvaluatorTableRow) =>
                                  actions.handleConfigure?.(record),
                          },
                          {type: "divider" as const},
                          {
                              key: "delete",
                              label: "Delete",
                              icon: <Trash size={16} />,
                              danger: true,
                              onClick: (record: EvaluatorTableRow) =>
                                  actions.handleDelete?.(record),
                          },
                      ],
            getRecordId: (record: EvaluatorTableRow) => record.revisionId,
        },
    ])

    return columns
}
