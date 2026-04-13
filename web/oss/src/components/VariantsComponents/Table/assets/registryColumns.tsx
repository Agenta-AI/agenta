import {memo} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {workflowLatestRevisionIdAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {VariantDetailsWithStatus, type VariantStatusInfo} from "@agenta/entity-ui/variant"
import {SkeletonLine, createStandardColumns, useDefaultStoreAtomValue} from "@agenta/ui/table"
import type {GroupExpandState} from "@agenta/ui/table"
import {
    ArrowSquareOut,
    CloudArrowUp,
    Eye,
    MinusCircle,
    PlusCircle,
    Trash,
} from "@phosphor-icons/react"
import {Typography} from "antd"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {RegistryRevisionRow} from "../../store/registryStore"

// ============================================================================
// SCALAR ATOM FAMILIES (molecule-backed, for cell renderers)
// ============================================================================

/**
 * Read from the raw server query (workflowMolecule.atoms.query) instead of
 * workflowMolecule.selectors.data to avoid subscribing to the inspect/OpenAPI
 * schema resolution chain. Table cells only need scalar fields (message,
 * created_by_id) that are on the revision response — no inspect needed.
 */
const revisionCommitMessageAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => {
        const query = get(workflowMolecule.atoms.query(id))
        return query.data?.message ?? null
    }),
)

const revisionCreatedByIdAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => {
        const query = get(workflowMolecule.atoms.query(id))
        return query.data?.created_by_id ?? null
    }),
)

// ============================================================================
// CELL RENDERERS
// ============================================================================

const RegistryVariantNameCell = memo(({record}: {record: RegistryRevisionRow}) => {
    const deployedIn = useDefaultStoreAtomValue(
        environmentMolecule.atoms.revisionDeployment(record.revisionId),
    )
    const latestRevisionId = useDefaultStoreAtomValue(
        workflowLatestRevisionIdAtomFamily(record.workflowId),
    )
    const isLatest = !!latestRevisionId && record.revisionId === latestRevisionId

    const variantMin: VariantStatusInfo = {
        id: record.revisionId,
        deployedIn: deployedIn?.length ? deployedIn : [],
        isLatestRevision: isLatest,
    }

    return (
        <VariantDetailsWithStatus
            variant={variantMin}
            variantName={record.variantName || "-"}
            revision={record.version}
            showBadges
            showRevisionAsTag
            isLatest={isLatest}
            hideDiscard
        />
    )
})

const CreatedByCell = memo(({revisionId}: {revisionId: string}) => {
    const createdById = useDefaultStoreAtomValue(revisionCreatedByIdAtomFamily(revisionId))
    if (!createdById) {
        return (
            <Typography.Text type="secondary" className="h-full flex items-center">
                —
            </Typography.Text>
        )
    }
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs truncate block">
                <UserAuthorLabel userId={createdById} showPrefix={false} showAvatar showYouLabel />
            </Typography.Text>
        </div>
    )
})

const CommitMessageCell = memo(({revisionId}: {revisionId: string}) => {
    const msg = useDefaultStoreAtomValue(revisionCommitMessageAtomFamily(revisionId))
    if (!msg) return null
    return (
        <div className="h-full flex items-center">
            <Typography.Text type="secondary" className="text-xs truncate block">
                {msg}
            </Typography.Text>
        </div>
    )
})

// ============================================================================
// COLUMN FACTORY
// ============================================================================

export interface RegistryColumnActions {
    handleOpenDetails?: (record: RegistryRevisionRow) => void
    handleOpenInPlayground?: (record: RegistryRevisionRow) => void
    handleDeploy?: (record: RegistryRevisionRow) => void
    handleDelete?: (record: RegistryRevisionRow) => void
}

export function createRegistryColumns(
    actions: RegistryColumnActions,
    expandState?: GroupExpandState,
) {
    return createStandardColumns<RegistryRevisionRow>([
        {
            type: "text",
            key: "variantName",
            title: "Name",
            width: 280,
            fixed: "left",
            columnVisibilityLocked: true,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="70%" />

                const isGroupParent =
                    !!record.__isVariantGroup || (record.__revisionCount as number) > 1
                const isGroupChild = !!record.__isGroupChild

                // Grouped parent row — expand icon + variant details
                if (isGroupParent && expandState) {
                    const rowKey = String(record.key)
                    const isExpanded = expandState.expandedRowKeys.includes(rowKey)
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
                            <RegistryVariantNameCell record={record} />
                        </div>
                    )
                }

                // Child row in grouped view — indent to align with parent content
                if (isGroupChild) {
                    return (
                        <div className="flex items-center h-full min-w-0 pl-6">
                            <RegistryVariantNameCell record={record} />
                        </div>
                    )
                }

                // Flat mode
                return (
                    <div className="flex items-center h-full min-w-0">
                        <RegistryVariantNameCell record={record} />
                    </div>
                )
            },
        },
        {
            type: "text",
            key: "model",
            title: "Model",
            width: 200,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                return <div className="h-full flex items-center">{record.model || "—"}</div>
            },
        },
        {
            type: "date",
            key: "createdAt",
            title: "Created on",
        },
        {
            type: "text",
            key: "createdById",
            title: "Created by",
            width: 180,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="50%" />
                return <CreatedByCell revisionId={record.revisionId} />
            },
        },
        {
            type: "text",
            key: "commitMessage",
            title: "Commit notes",
            width: 250,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="40%" />
                return <CommitMessageCell revisionId={record.revisionId} />
            },
        },
        {
            type: "actions",
            width: 48,
            maxWidth: 48,
            items: [
                {
                    key: "details",
                    label: "View details",
                    icon: <Eye size={16} />,
                    onClick: (record) => actions.handleOpenDetails?.(record),
                },
                {
                    key: "playground",
                    label: "Open in Playground",
                    icon: <ArrowSquareOut size={16} />,
                    onClick: (record) => actions.handleOpenInPlayground?.(record),
                },
                {
                    key: "deploy",
                    label: "Deploy",
                    icon: <CloudArrowUp size={16} />,
                    onClick: (record) => actions.handleDeploy?.(record),
                },
                {type: "divider"},
                {
                    key: "delete",
                    label: "Delete",
                    icon: <Trash size={16} />,
                    danger: true,
                    onClick: (record) => actions.handleDelete?.(record),
                },
            ],
            getRecordId: (record) => record.revisionId,
        },
    ])
}
