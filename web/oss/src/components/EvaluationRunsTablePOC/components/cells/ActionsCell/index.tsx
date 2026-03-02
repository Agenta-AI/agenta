import {memo, useMemo, useState, useCallback} from "react"

import {message} from "@agenta/ui/app-message"
import {MoreOutlined} from "@ant-design/icons"
import {
    Database,
    Note,
    Rocket,
    Trash,
    DownloadSimple,
    Play,
    Stop,
    Copy,
} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Dropdown, MenuProps, Tooltip} from "antd"

import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {extractPrimaryInvocation} from "@/oss/components/pages/evaluations/utils"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {EvaluationStatus} from "@/oss/lib/Types"
import {startSimpleEvaluation, stopSimpleEvaluation} from "@/oss/services/onlineEvaluations/api"

import {
    useRunRowDetails,
    useRunRowSummary,
    useRunRowReferences,
} from "../../../context/RunRowDataContext"
import type {EvaluationRunTableRow} from "../../../types"

const CELL_CLASS =
    "flex h-full w-full min-w-0 items-center justify-center px-2 [&_.ant-btn]:h-8 [&_.ant-btn]:w-8"

const BLOCKED_STATUSES = new Set<string>([
    EvaluationStatus.PENDING,
    EvaluationStatus.RUNNING,
    EvaluationStatus.CANCELLED,
    EvaluationStatus.INITIALIZED,
])

interface RunActionsCellProps {
    record: EvaluationRunTableRow
    onOpenDetails: (record: EvaluationRunTableRow) => void
    onVariantNavigation: (params: {revisionId: string; appId?: string | null}) => void
    onTestsetNavigation: (testsetId: string, revisionId?: string | null) => void
    onRequestDelete: (record: EvaluationRunTableRow) => void
    resolveAppId: (record: EvaluationRunTableRow) => string | null
    isVisible?: boolean
    onExportRow?: (record: EvaluationRunTableRow) => void
    isExporting?: boolean
}

const RunActionsCell = ({
    record,
    onOpenDetails,
    onVariantNavigation,
    onTestsetNavigation,
    onRequestDelete,
    resolveAppId,
    isVisible = true,
    onExportRow,
    isExporting = false,
}: RunActionsCellProps) => {
    const queryClient = useQueryClient()
    const runId = record.preview?.id ?? record.runId
    const {summary, stepReferences, isLoading: summaryLoading} = useRunRowSummary(record, isVisible)
    const referenceSequence = useRunRowReferences(record)
    const {
        camelRun,
        status: detailedStatus,
        isLoading: detailsLoading,
    } = useRunRowDetails(record, isVisible)
    const [onlineAction, setOnlineAction] = useState<"start" | "stop" | null>(null)

    const invocation = useMemo(
        () => (camelRun ? extractPrimaryInvocation(camelRun as any) : null),
        [camelRun],
    )

    const effectiveStatus = detailedStatus ?? record.status ?? null
    const normalizedStatus =
        typeof effectiveStatus === "string" ? effectiveStatus.toUpperCase() : null
    const isBlocked = normalizedStatus ? BLOCKED_STATUSES.has(normalizedStatus) : false

    const effectiveVariantRevisionId = invocation?.revisionId ?? null
    const effectiveAppId = invocation?.appId ?? resolveAppId(record)
    const effectiveTestsetId = summary?.testsetIds?.[0] ?? null

    // Extract testset revision ID from step references
    const effectiveTestsetRevisionId = useMemo(() => {
        if (!stepReferences || !effectiveTestsetId) return null
        for (const stepKey of Object.keys(stepReferences)) {
            const refs = (stepReferences as Record<string, any>)[stepKey]
            if (!refs || typeof refs !== "object") continue
            const testsetRef = refs.testset ?? refs.test_set ?? refs.testsetVariant
            if (testsetRef?.id === effectiveTestsetId) {
                const revisionRef = refs.testset_revision ?? refs.testsetRevision
                return revisionRef?.id ?? null
            }
        }
        return null
    }, [stepReferences, effectiveTestsetId])
    const hasVariantReference = referenceSequence.some((slot) => slot.role === "variant")
    const hasTestsetReference = referenceSequence.some((slot) => slot.role === "testset")

    const canOpenDetails = Boolean(!record.__isSkeleton && runId)
    const canOpenVariant =
        hasVariantReference && Boolean(!record.__isSkeleton && effectiveVariantRevisionId)
    const canOpenTestset =
        hasTestsetReference && Boolean(!record.__isSkeleton && effectiveTestsetId)
    const canDelete = Boolean(!record.__isSkeleton && !isBlocked)
    const projectId = record.projectId ?? null

    const flagSources = useMemo(() => {
        const sources: Record<string, unknown>[] = []
        if (summary?.flags && typeof summary.flags === "object") {
            sources.push(summary.flags)
        }
        if (camelRun?.flags && typeof (camelRun as any).flags === "object") {
            sources.push((camelRun as any).flags as Record<string, unknown>)
        }
        const previewFlags = (record.previewMeta as any)?.flags
        if (previewFlags && typeof previewFlags === "object") {
            sources.push(previewFlags as Record<string, unknown>)
        }
        return sources
    }, [summary?.flags, camelRun, record.previewMeta])

    const isFlagExplicitTrue = (value: unknown) =>
        value === true || value === 1 || value === "true" || value === "1"
    const isFlagExplicitFalse = (value: unknown) =>
        value === false || value === 0 || value === "false" || value === "0"

    const getFlagValue = useCallback(
        (keys: string[]): unknown => {
            for (const source of flagSources) {
                for (const key of keys) {
                    const value = (source as any)?.[key]
                    if (value !== undefined && value !== null) {
                        return value
                    }
                }
            }
            return undefined
        },
        [flagSources],
    )

    const evaluationKindValue = getFlagValue(["evaluation_kind", "evaluationKind"])
    const normalizedEvaluationKind =
        typeof evaluationKindValue === "string"
            ? evaluationKindValue.toLowerCase()
            : typeof record.evaluationKind === "string"
              ? record.evaluationKind.toLowerCase()
              : ""
    const isOnlineEvaluation = normalizedEvaluationKind === "online"

    const isClosed = isFlagExplicitTrue(getFlagValue(["isClosed", "is_closed"]))
    const activeValue = getFlagValue(["isActive", "is_active", "isLive", "is_live"])
    const isActive = isFlagExplicitTrue(activeValue) && !isClosed
    const isStoppedFlag =
        isFlagExplicitTrue(getFlagValue(["isStopped", "is_stopped"])) ||
        isFlagExplicitFalse(activeValue)
    const normalizedStatusString = (summary?.status ?? record.status ?? "").toLowerCase()
    const stopStatusTokens = ["stopped", "cancelled", "canceled", "halted", "closed"]
    const isStoppedByStatus = stopStatusTokens.some((token) =>
        normalizedStatusString.includes(token),
    )
    const _isOnlineStopped = isStoppedFlag || isStoppedByStatus

    const canStopOnline = Boolean(
        isOnlineEvaluation && runId && isActive && !isClosed && !record.__isSkeleton,
    )
    const canResumeOnline = Boolean(
        isOnlineEvaluation && runId && !isActive && !isClosed && !record.__isSkeleton,
    )
    const showOnlineAction = canStopOnline || canResumeOnline

    const invalidateRunQueries = useCallback(() => {
        if (!runId) return
        const projectKey = projectId ?? "none"
        queryClient.invalidateQueries({
            queryKey: ["preview-evaluation-run-summary", projectKey, runId],
        })
        queryClient.invalidateQueries({
            queryKey: ["preview", "evaluation-run", runId, projectId],
        })
    }, [projectId, queryClient, runId])

    const handleOnlineAction = useCallback(async () => {
        if (!runId || !showOnlineAction) return
        const actionType: "stop" | "start" = canStopOnline ? "stop" : "start"
        setOnlineAction(actionType)
        try {
            if (actionType === "stop") {
                await stopSimpleEvaluation(runId)
                message.success("Evaluation stopped")
            } else {
                await startSimpleEvaluation(runId)
                message.success("Evaluation resumed")
            }
            invalidateRunQueries()
        } catch (error) {
            console.error("[RunActionsCell] Failed to toggle online evaluation", error)
            message.error(
                actionType === "stop" ? "Failed to stop evaluation" : "Failed to resume evaluation",
            )
        } finally {
            setOnlineAction(null)
        }
    }, [canStopOnline, invalidateRunQueries, runId, showOnlineAction])

    const items = useMemo<MenuProps["items"]>(() => {
        const menuItems: MenuProps["items"] = [
            {
                key: "details",
                label: "Open details",
                icon: <Note size={16} />,
                disabled: !canOpenDetails,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    if (!canOpenDetails) return
                    onOpenDetails(record)
                },
            },
            {
                key: "copy-run-id",
                label: "Copy run ID",
                icon: <Copy size={16} />,
                disabled: !runId,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    if (!runId) return
                    copyToClipboard(runId)
                },
            },
        ]

        if (showOnlineAction) {
            menuItems.push({
                key: canStopOnline ? "online-stop" : "online-resume",
                label: canStopOnline ? "Stop evaluation" : "Resume evaluation",
                icon: canStopOnline ? <Stop size={16} /> : <Play size={16} />,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    if (onlineAction) return
                    handleOnlineAction()
                },
                disabled: Boolean(onlineAction),
            })
        }

        if (hasVariantReference) {
            menuItems.push({
                key: "variant",
                label: "View variant",
                icon: <Rocket size={16} />,
                disabled: !canOpenVariant,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    if (!canOpenVariant || !effectiveVariantRevisionId) return
                    onVariantNavigation({
                        revisionId: effectiveVariantRevisionId,
                        appId: effectiveAppId,
                    })
                },
            })
        }
        if (hasTestsetReference) {
            menuItems.push({
                key: "testset",
                label: "View testset",
                icon: <Database size={16} />,
                disabled: !canOpenTestset,
                onClick: (event) => {
                    event.domEvent.stopPropagation()
                    if (!canOpenTestset || !effectiveTestsetId) return
                    onTestsetNavigation(effectiveTestsetId, effectiveTestsetRevisionId)
                },
            })
        }

        menuItems.push({
            key: "export-run",
            label: "Export row",
            icon: <DownloadSimple size={16} />,
            disabled: !onExportRow || isExporting,
            onClick: (event) => {
                event.domEvent.stopPropagation()
                if (!onExportRow || isExporting) return
                onExportRow(record)
            },
        })
        menuItems.push({type: "divider"})
        menuItems.push({
            key: "delete",
            label: "Delete",
            icon: <Trash size={16} />,
            danger: true,
            disabled: !canDelete,
            onClick: (event) => {
                event.domEvent.stopPropagation()
                if (!canDelete) return
                onRequestDelete(record)
            },
        })

        return menuItems
    }, [
        canOpenDetails,
        canOpenVariant,
        canOpenTestset,
        canDelete,
        effectiveVariantRevisionId,
        effectiveAppId,
        effectiveTestsetId,
        effectiveTestsetRevisionId,
        onOpenDetails,
        onVariantNavigation,
        onTestsetNavigation,
        onRequestDelete,
        record,
        onExportRow,
        isExporting,
        hasVariantReference,
        hasTestsetReference,
        showOnlineAction,
        canStopOnline,
        onlineAction,
        handleOnlineAction,
    ])

    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <SkeletonLine width="32px" />
            </div>
        )
    }

    if (!isVisible) {
        return null
    }

    const isLoading = summaryLoading || detailsLoading
    const button = (
        <Button
            type="text"
            shape="circle"
            icon={<MoreOutlined />}
            onClick={(event) => event.stopPropagation()}
            loading={isLoading}
        />
    )

    if (isLoading) {
        return <div className={CELL_CLASS}>{button}</div>
    }

    return (
        <div className={CELL_CLASS}>
            <Dropdown trigger={["click"]} menu={{items}} styles={{root: {width: 200}}}>
                <Tooltip title="Actions">{button}</Tooltip>
            </Dropdown>
        </div>
    )
}

export default memo(RunActionsCell)
