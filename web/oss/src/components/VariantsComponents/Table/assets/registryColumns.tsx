import {memo, useSyncExternalStore} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {workflowLatestRevisionIdAtomFamily} from "@agenta/entities/workflow"
import {SkeletonLine, createStandardColumns} from "@agenta/ui/table"
import {
    ArrowSquareOut,
    CloudArrowUp,
    Eye,
    MinusCircle,
    PlusCircle,
    Trash,
} from "@phosphor-icons/react"
import {Typography} from "antd"
import {getDefaultStore} from "jotai/vanilla"

import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import type {VariantStatusInfo} from "@/oss/components/VariantDetailsWithStatus/types"

import type {RegistryRevisionRow} from "../../store/registryStore"

// ============================================================================
// DEFAULT STORE HOOK
// ============================================================================

/**
 * Reads an atom from Jotai's default store, bypassing any Provider scope.
 * Needed because IVT cell renderers run inside an isolated Jotai Provider,
 * but entity atoms (sessionAtom, projectIdAtom) live in the default store.
 */
function useDefaultStoreAtomValue<T>(atom: import("jotai").Atom<T>): T {
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

const CommitMessageCell = memo(({record}: {record: RegistryRevisionRow}) => {
    const msg = record.commitMessage
    if (!msg) return null
    return (
        <div className="h-full flex items-center" onClick={(e) => e.stopPropagation()}>
            <TruncatedTooltipTag width={560}>{msg}</TruncatedTooltipTag>
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

export interface RegistryExpandState {
    expandedRowKeys: string[]
    handleExpand: (expanded: boolean, record: RegistryRevisionRow) => void
}

export function createRegistryColumns(
    actions: RegistryColumnActions,
    expandState?: RegistryExpandState,
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

                const isGroupParent = !!record.__isVariantGroup
                const isGroupChild = !!record.__isGroupChild

                // Grouped parent row — expand icon + variant details
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
                if (!record.createdById) {
                    return (
                        <Typography.Text type="secondary" className="h-full flex items-center">
                            —
                        </Typography.Text>
                    )
                }
                return (
                    <div className="h-full flex items-center">
                        <Typography.Text type="secondary" className="text-xs truncate block">
                            <UserAuthorLabel
                                userId={record.createdById}
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
            title: "Commit notes",
            width: 250,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="40%" />
                return <CommitMessageCell record={record} />
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
