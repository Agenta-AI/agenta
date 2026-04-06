import {memo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared"
import {workflowVariantsListDataAtomFamily} from "@agenta/entities/workflow"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {SkeletonLine, createStandardColumns, useDefaultStoreAtomValue} from "@agenta/ui/table"
import {ArrowCounterClockwise, ArrowSquareOut, Eye, Lightning} from "@phosphor-icons/react"
import {Typography} from "antd"

import {routerAppIdAtom} from "@/oss/state/app"

import type {DeploymentRevisionRow} from "../../store/deploymentStore"

// ============================================================================
// CELL RENDERERS
// ============================================================================

const DeploymentVariantCell = memo(({record}: {record: DeploymentRevisionRow}) => {
    const revisionId = record.deployedRevisionId
    const appId = useDefaultStoreAtomValue(routerAppIdAtom) || ""
    const variants = useDefaultStoreAtomValue(workflowVariantsListDataAtomFamily(appId))

    if (!revisionId) {
        return (
            <Typography.Text type="secondary" className="h-full flex items-center">
                —
            </Typography.Text>
        )
    }

    const variantEntity = record.variantId ? variants.find((v) => v.id === record.variantId) : null
    // Legacy deploys may not store variantId — fall back to single-variant name
    const fallbackName = !variantEntity && variants.length === 1 ? variants[0]?.name : null
    const variantName = variantEntity?.name || fallbackName || record.variantSlug || "-"
    const revision = record.deployedRevisionVersion

    return (
        <div className="h-full flex items-center">
            <VariantDetailsWithStatus
                variantName={variantName}
                revision={revision}
                showRevisionAsTag
                showStable
                hideDiscard
            />
        </div>
    )
})

const CommitMessageCell = memo(({record}: {record: DeploymentRevisionRow}) => {
    const msg = record.commitMessage
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

export interface DeploymentColumnActions {
    handleOpenDetails?: (record: DeploymentRevisionRow) => void
    handleOpenInPlayground?: (record: DeploymentRevisionRow) => void
    handleUseApi?: (record: DeploymentRevisionRow) => void
    handleRevert?: (record: DeploymentRevisionRow) => void
    /** The currently deployed revision ID — used to disable revert on current deploy */
    currentDeployedRevisionId?: string | null
}

export function createDeploymentColumns(actions: DeploymentColumnActions) {
    return createStandardColumns<DeploymentRevisionRow>([
        {
            type: "text",
            key: "version",
            title: "Revision",
            width: 88,
            fixed: "left",
            columnVisibilityLocked: true,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="40%" />
                return <div className="h-full flex items-center">v{record.version}</div>
            },
        },
        {
            type: "text",
            key: "deployedRevisionId",
            title: "Variant",
            width: 280,
            fixed: "left",
            exportValue: (_row) => {
                const record = _row as DeploymentRevisionRow
                const name = record.variantSlug || "-"
                const version = record.deployedRevisionVersion
                return version != null ? `${name} v${version}` : name
            },
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="70%" />
                return <DeploymentVariantCell record={record} />
            },
        },
        {
            type: "text",
            key: "commitMessage",
            title: "Notes",
            width: 280,
            render: (_value, record) => {
                if (record.__isSkeleton) return <SkeletonLine width="40%" />
                return <CommitMessageCell record={record} />
            },
        },
        {
            type: "date",
            key: "createdAt",
            title: "Date modified",
        },
        {
            type: "text",
            key: "createdById",
            title: "Modified by",
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
                            />
                        </Typography.Text>
                    </div>
                )
            },
        },
        {
            type: "actions",
            width: 48,
            maxWidth: 48,
            items: [
                {
                    key: "details",
                    label: "Open details",
                    icon: <Eye size={16} />,
                    onClick: (record) => actions.handleOpenDetails?.(record),
                },
                {
                    key: "use_api",
                    label: "Use API",
                    icon: <Lightning size={16} />,
                    onClick: (record) => actions.handleUseApi?.(record),
                },
                {
                    key: "playground",
                    label: "Open in Playground",
                    icon: <ArrowSquareOut size={16} />,
                    onClick: (record) => actions.handleOpenInPlayground?.(record),
                    hidden: (record) => !record.deployedRevisionId,
                },
                {
                    key: "revert",
                    label: "Revert",
                    icon: <ArrowCounterClockwise size={16} />,
                    onClick: (record) => actions.handleRevert?.(record),
                    hidden: (record) =>
                        record.deployedRevisionId === actions.currentDeployedRevisionId,
                },
            ],
            getRecordId: (record) => record.envRevisionId,
        },
    ])
}
