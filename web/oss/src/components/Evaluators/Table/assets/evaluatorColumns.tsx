import {memo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {
    evaluatorTemplatesDataAtom,
    getEvaluatorColor,
    workflowMolecule,
    resolveOutputSchemaProperties,
} from "@agenta/entities/workflow"
import type {GroupExpandState} from "@agenta/ui/table"
import {
    SkeletonLine,
    createStandardColumns,
    useDefaultStoreAtomValue,
    formatDateCell,
} from "@agenta/ui/table"
import {Eye, GearSix, MinusCircle, PencilSimple, PlusCircle, Trash} from "@phosphor-icons/react"
import {Tag, Typography} from "antd"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {EvaluatorCategory} from "../../assets/types"
import type {EvaluatorTableRow} from "../../store/evaluatorsPaginatedStore"

// ============================================================================
// SCALAR ATOM FAMILIES
// Derive primitive values from molecule selectors so cells subscribe to
// stable scalar atoms rather than full Workflow objects or query state objects.
// Primitives never change identity when the value is the same, preventing
// unnecessary re-renders and avoiding max-update-depth from object churn.
// ============================================================================

/** Workflow name — string | null */
const workflowNameAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.name(id))),
)
/** Workflow slug — string | null */
const workflowSlugAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.slug(id))),
)
/** Workflow key parsed from URI (e.g. "auto_exact_match") — string | null */
const workflowKeyAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.workflowKey(id))),
)
/** updated_at — string | null */
const workflowUpdatedAtAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowMolecule.selectors.data(id))
        return entity?.updated_at ?? entity?.created_at ?? null
    }),
)
/** updated_by_id or created_by_id — string | null */
const workflowUpdatedByIdAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowMolecule.selectors.data(id))
        return entity?.updated_by_id ?? entity?.created_by_id ?? null
    }),
)
/** commit message — string | null */
const workflowMessageAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.data(id))?.message ?? null),
)
/** output schema properties keys — derived scalar to avoid object churn */
const workflowOutputSchemaKeysAtomFamily = atomFamily((id: string) =>
    atom<string[]>((get) => {
        const entity = get(workflowMolecule.selectors.data(id))
        const props = resolveOutputSchemaProperties(entity?.data)
        return props ? Object.keys(props) : []
    }),
)

// ============================================================================
// CELL RENDERERS
// ============================================================================

/**
 * Type badge cell for automatic evaluators.
 * Reads evaluatorKey via scalar atomFamily (stable primitive).
 */
const EvaluatorTypeCell = memo(({revisionId}: {revisionId: string}) => {
    const templates = useDefaultStoreAtomValue(evaluatorTemplatesDataAtom)
    const evaluatorKey = useDefaultStoreAtomValue(workflowKeyAtomFamily(revisionId))

    if (!evaluatorKey) return null

    const template = templates.find((t) => t.key === evaluatorKey)
    const label = template?.name ?? evaluatorKey
    const color = getEvaluatorColor(evaluatorKey)

    return (
        <div className="h-full flex items-center">
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
        </div>
    )
})

/**
 * Tags cell for automatic evaluators.
 * Reads evaluatorKey via scalar atomFamily (stable primitive).
 */
const AutomaticTagsCell = memo(({revisionId}: {revisionId: string}) => {
    const templates = useDefaultStoreAtomValue(evaluatorTemplatesDataAtom)
    const evaluatorKey = useDefaultStoreAtomValue(workflowKeyAtomFamily(revisionId))

    const template = evaluatorKey ? templates.find((t) => t.key === evaluatorKey) : null
    const tags = template?.categories ?? []

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
 * Reads output schema keys via scalar atomFamily (stable string[]).
 */
const FeedbackCell = memo(({revisionId}: {revisionId: string}) => {
    const metricNames = useDefaultStoreAtomValue(workflowOutputSchemaKeysAtomFamily(revisionId))

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
})

/** Name display for group parent rows — reads from seeded workflow entity via scalar atoms. */
const NameCellParent = memo(
    ({
        workflowId,
        version,
        revisionCount,
        rowKey,
        expandState,
    }: {
        workflowId: string
        version: number | null
        revisionCount: number
        rowKey: string
        expandState: EvaluatorExpandState
    }) => {
        const name = useDefaultStoreAtomValue(workflowNameAtomFamily(workflowId))
        const slug = useDefaultStoreAtomValue(workflowSlugAtomFamily(workflowId))
        const displayName = name ?? slug ?? "—"
        const isExpanded = expandState.expandedRowKeys.includes(rowKey)
        const revisionTag =
            version != null ? (
                <Tag className="bg-[rgba(5,23,41,0.06)] !m-0 shrink-0" variant="filled">
                    v{version}
                </Tag>
            ) : null
        return (
            <div className="flex items-center gap-2 h-full min-w-0">
                <span
                    className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors shrink-0 leading-[1]"
                    onClick={(e) => {
                        e.stopPropagation()
                        expandState.handleExpand(!isExpanded, rowKey)
                    }}
                >
                    {isExpanded ? <MinusCircle size={16} /> : <PlusCircle size={16} />}
                </span>
                <span className="truncate">{displayName}</span>
                {revisionCount > 1 && revisionTag}
            </div>
        )
    },
)

/** Name display for revision rows (child or flat) — reads via scalar atoms. */
const NameCellRevision = memo(
    ({
        revisionId,
        version,
        isGroupChild,
    }: {
        revisionId: string
        version: number | null
        isGroupChild: boolean
    }) => {
        const name = useDefaultStoreAtomValue(workflowNameAtomFamily(revisionId))
        const slug = useDefaultStoreAtomValue(workflowSlugAtomFamily(revisionId))
        const displayName = name ?? slug ?? "—"
        const revisionTag =
            version != null ? (
                <Tag className="bg-[rgba(5,23,41,0.06)] !m-0 shrink-0" variant="filled">
                    v{version}
                </Tag>
            ) : null
        if (isGroupChild) {
            return (
                <div className="flex items-center gap-2 h-full min-w-0 pl-6">
                    <span className="truncate">{displayName}</span>
                    {revisionTag}
                </div>
            )
        }
        return (
            <div className="flex items-center gap-2 h-full min-w-0">
                <span className="truncate">{displayName}</span>
                {revisionTag}
            </div>
        )
    },
)

/**
 * Name cell — routes to NameCellParent (workflowId, seeded) or NameCellRevision (revisionId, raw query).
 */
const NameCellContent = memo(
    ({
        entityId,
        isGroupParent,
        version,
        isGroupChild,
        revisionCount,
        rowKey,
        expandState,
    }: {
        entityId: string
        isGroupParent: boolean
        version: number | null
        isGroupChild: boolean
        revisionCount: number
        rowKey: string
        expandState?: EvaluatorExpandState
    }) => {
        if (isGroupParent && expandState) {
            return (
                <NameCellParent
                    workflowId={entityId}
                    version={version}
                    revisionCount={revisionCount}
                    rowKey={rowKey}
                    expandState={expandState}
                />
            )
        }
        return (
            <NameCellRevision revisionId={entityId} version={version} isGroupChild={isGroupChild} />
        )
    },
)

/**
 * Modified-by cell for group parent rows — reads via scalar atomFamily.
 */
const ModifiedByCell = memo(({workflowId}: {workflowId: string}) => {
    const userId = useDefaultStoreAtomValue(workflowUpdatedByIdAtomFamily(workflowId))
    if (!userId) return null
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs truncate block">
                <UserAuthorLabel userId={userId} showPrefix={false} showAvatar showYouLabel />
            </Typography.Text>
        </div>
    )
})

/**
 * Modified-by cell for child revision rows — reads via scalar atomFamily.
 */
const ModifiedByRevisionCell = memo(({revisionId}: {revisionId: string}) => {
    const userId = useDefaultStoreAtomValue(workflowUpdatedByIdAtomFamily(revisionId))
    if (!userId) return null
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs truncate block">
                <UserAuthorLabel userId={userId} showPrefix={false} showAvatar showYouLabel />
            </Typography.Text>
        </div>
    )
})

/**
 * Commit message cell — reads via scalar atomFamily.
 */
const CommitMessageCell = memo(({revisionId}: {revisionId: string}) => {
    const commitMessage = useDefaultStoreAtomValue(workflowMessageAtomFamily(revisionId))
    if (!commitMessage) return null
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs truncate block">
                {commitMessage}
            </Typography.Text>
        </div>
    )
})

/**
 * Date display cell — renders a pre-resolved date string from the row.
 * Used for "Date Created" on both parent and child rows.
 */
const DateCell = memo(({date}: {date: string | null}) => {
    if (!date) return null
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs">
                {formatDateCell(date)}
            </Typography.Text>
        </div>
    )
})

/**
 * Updated-at cell for group parent rows — reads via scalar atomFamily.
 */
const UpdatedAtCell = memo(({workflowId}: {workflowId: string}) => {
    const updatedAt = useDefaultStoreAtomValue(workflowUpdatedAtAtomFamily(workflowId))
    if (!updatedAt) return null
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs">
                {formatDateCell(updatedAt)}
            </Typography.Text>
        </div>
    )
})

/**
 * Updated-at cell for child revision rows — reads via scalar atomFamily.
 */
const UpdatedAtRevisionCell = memo(({revisionId}: {revisionId: string}) => {
    const updatedAt = useDefaultStoreAtomValue(workflowUpdatedAtAtomFamily(revisionId))
    if (!updatedAt) return null
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs">
                {formatDateCell(updatedAt)}
            </Typography.Text>
        </div>
    )
})
// ============================================================================
// COLUMN FACTORY
// ============================================================================

export interface EvaluatorColumnActions {
    handleConfigure?: (record: EvaluatorTableRow) => void
    handleEdit?: (record: EvaluatorTableRow) => void
    handleDelete?: (record: EvaluatorTableRow) => void
}

/** @deprecated Use GroupExpandState from @agenta/ui/table instead */
export type EvaluatorExpandState = GroupExpandState

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
                // Group parent shows workflow-level name (workflowId), children show revision name
                const entityId = record.__isEvaluatorGroup ? record.workflowId : record.revisionId
                return (
                    <NameCellContent
                        entityId={entityId}
                        version={record.version}
                        isGroupParent={!!record.__isEvaluatorGroup}
                        isGroupChild={!!record.__isGroupChild}
                        revisionCount={record.__revisionCount ?? 1}
                        rowKey={String(record.key)}
                        expandState={expandState}
                    />
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
                          return <EvaluatorTypeCell revisionId={record.revisionId} />
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
                    return <FeedbackCell revisionId={record.revisionId} />
                }
                return <AutomaticTagsCell revisionId={record.revisionId} />
            },
        },
        {
            type: "text",
            key: "createdAt",
            title: "Date Created",
            render: (_value: unknown, record: EvaluatorTableRow) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                return <DateCell date={record.revisionCreatedAt as string | null} />
            },
        },
        {
            type: "text",
            key: "updatedAt",
            title: "Last modified",
            render: (_value: unknown, record: EvaluatorTableRow) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                if (record.__isGroupChild)
                    return <UpdatedAtRevisionCell revisionId={record.revisionId} />
                return <UpdatedAtCell workflowId={record.workflowId} />
            },
        },
        {
            type: "text",
            key: "modifiedBy",
            title: "Modified by",
            width: 200,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                if (record.__isGroupChild)
                    return <ModifiedByRevisionCell revisionId={record.revisionId} />
                return <ModifiedByCell workflowId={record.workflowId} />
            },
        },
        {
            type: "text",
            key: "commitMessage",
            title: "Commit message",
            width: 200,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="60%" />
                return <CommitMessageCell revisionId={record.revisionId} />
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
