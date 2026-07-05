import {memo, useMemo, useState, useCallback} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {message} from "@agenta/ui/app-message"
import {SkeletonLine} from "@agenta/ui/table"
import {MoreOutlined} from "@ant-design/icons"
import {
    Database,
    Note,
    Rocket,
    Trash,
    DownloadSimple,
    Play,
    PencilSimple,
    Stop,
    Copy,
} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"

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
    onEditEvaluation?: (record: EvaluationRunTableRow) => void
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
    onEditEvaluation,
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

    // Edit (v1: add evaluators) only on a finished, not-closed batch run. Online/live
    // and still-running runs are out of scope. Requires a parent-provided handler so
    // the drawer is owned by the table parent, not rendered inside this cell.
    const canEditEvaluation = Boolean(
        onEditEvaluation &&
        runId &&
        !record.__isSkeleton &&
        !isBlocked &&
        !isClosed &&
        !isOnlineEvaluation,
    )

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
    const triggerButton = (
        <Button
            variant="ghost"
            className="size-7 rounded-full"
            onClick={(event) => event.stopPropagation()}
            disabled={isLoading}
        >
            <MoreOutlined />
        </Button>
    )

    if (isLoading) {
        return <div className={CELL_CLASS}>{triggerButton}</div>
    }

    return (
        <div className={CELL_CLASS}>
            <DropdownMenu>
                <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                    <Tooltip>
                        <TooltipTrigger render={triggerButton} />
                        <TooltipContent>Actions</TooltipContent>
                    </Tooltip>
                </DropdownMenuTrigger>
                <DropdownMenuContent style={{width: 200}}>
                    <DropdownMenuItem
                        onClick={() => {
                            if (!canOpenDetails) return
                            onOpenDetails(record)
                        }}
                        disabled={!canOpenDetails}
                    >
                        <Note size={16} />
                        Open details
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => {
                            if (!runId) return
                            copyToClipboard(runId)
                        }}
                        disabled={!runId}
                    >
                        <Copy size={16} />
                        Copy run ID
                    </DropdownMenuItem>
                    {showOnlineAction && (
                        <DropdownMenuItem
                            onClick={() => {
                                if (onlineAction) return
                                handleOnlineAction()
                            }}
                            disabled={Boolean(onlineAction)}
                        >
                            {canStopOnline ? <Stop size={16} /> : <Play size={16} />}
                            {canStopOnline ? "Stop evaluation" : "Resume evaluation"}
                        </DropdownMenuItem>
                    )}
                    {canEditEvaluation && (
                        <DropdownMenuItem onClick={() => onEditEvaluation?.(record)}>
                            <PencilSimple size={16} />
                            Edit evaluation
                        </DropdownMenuItem>
                    )}
                    {hasVariantReference && (
                        <DropdownMenuItem
                            onClick={() => {
                                if (!canOpenVariant || !effectiveVariantRevisionId) return
                                onVariantNavigation({
                                    revisionId: effectiveVariantRevisionId,
                                    appId: effectiveAppId,
                                })
                            }}
                            disabled={!canOpenVariant}
                        >
                            <Rocket size={16} />
                            View variant
                        </DropdownMenuItem>
                    )}
                    {hasTestsetReference && (
                        <DropdownMenuItem
                            onClick={() => {
                                if (!canOpenTestset || !effectiveTestsetId) return
                                onTestsetNavigation(effectiveTestsetId, effectiveTestsetRevisionId)
                            }}
                            disabled={!canOpenTestset}
                        >
                            <Database size={16} />
                            View testset
                        </DropdownMenuItem>
                    )}
                    {onExportRow && (
                        <DropdownMenuItem
                            onClick={() => {
                                if (isExporting) return
                                onExportRow(record)
                            }}
                            disabled={isExporting}
                        >
                            <DownloadSimple size={16} />
                            Export row
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                            if (!canDelete) return
                            onRequestDelete(record)
                        }}
                        disabled={!canDelete}
                    >
                        <Trash size={16} />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

export default memo(RunActionsCell)
