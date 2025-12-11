import {memo, useCallback, useMemo, useState} from "react"

import {Pause, Play} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Space, Tabs, Tag, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {invalidatePreviewRunCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"
import {startSimpleEvaluation, stopSimpleEvaluation} from "@/oss/services/onlineEvaluations/api"

import {
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
    runFlagsAtomFamily,
} from "../atoms/runDerived"
import {evaluationRunQueryAtomFamily} from "../atoms/table"
import {previewEvalTypeAtom} from "../state/evalType"

import CompareRunsMenu from "./CompareRunsMenu"

const statusColor = (status?: string | null) => {
    if (!status) return "default"
    const normalized = status.toLowerCase()
    if (normalized.includes("success") || normalized.includes("completed")) return "green"
    if (normalized.includes("fail") || normalized.includes("error")) return "red"
    if (normalized.includes("running") || normalized.includes("queued")) return "blue"
    return "default"
}

type ActiveView = "overview" | "focus" | "scenarios" | "configuration"

const PreviewEvalRunHeader = ({
    runId,
    className,
    activeView,
    onChangeView,
    projectId,
}: {
    runId: string
    className?: string
    activeView?: ActiveView
    onChangeView?: (v: ActiveView) => void
    projectId?: string | null
}) => {
    const queryClient = useQueryClient()
    const runQueryAtom = useMemo(() => evaluationRunQueryAtomFamily(runId), [runId])
    const runQuery = useAtomValue(runQueryAtom)
    const _invocationRefs = useAtomValue(useMemo(() => runInvocationRefsAtomFamily(runId), [runId]))
    const _testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId), [runId]))
    const evalType = useAtomValue(previewEvalTypeAtom)
    const runFlags = useAtomValue(useMemo(() => runFlagsAtomFamily(runId), [runId]))
    const [onlineAction, setOnlineAction] = useState<"start" | "stop" | null>(null)

    const runData = runQuery.data?.camelRun ?? runQuery.data?.rawRun ?? null
    const runStatus = runData?.status ?? null
    const updatedTs =
        (runData as any)?.updatedAt ||
        (runData as any)?.updated_at ||
        (runData as any)?.createdAt ||
        (runData as any)?.created_at ||
        null
    const updatedMoment = updatedTs ? dayjs(updatedTs) : null
    const lastUpdated = updatedMoment?.isValid() ? updatedMoment.fromNow() : undefined

    const _statusDotClass = (() => {
        const lower = (runStatus || "").toLowerCase()
        if (
            lower.includes("run") ||
            lower.includes("progress") ||
            lower.includes("active") ||
            lower.includes("running") ||
            lower.includes("queued")
        ) {
            return "bg-green-500"
        }
        if (lower.includes("completed") || lower.includes("closed") || lower.includes("success")) {
            return "bg-gray-400"
        }
        if (lower.includes("stopped") || lower.includes("error") || lower.includes("fail")) {
            return "bg-red-500"
        }
        return "bg-yellow-500"
    })()

    // Online evaluation pause/continue logic
    const isOnlineEvaluation = evalType === "online"
    const isClosed = runFlags?.isClosed === true
    const isActive = runFlags?.isActive === true && !isClosed
    const canStopOnline = Boolean(isOnlineEvaluation && runId && isActive && !isClosed)
    const canResumeOnline = Boolean(isOnlineEvaluation && runId && !isActive && !isClosed)
    const showOnlineAction = canStopOnline || canResumeOnline

    const refetchRunQueries = useCallback(async () => {
        if (!runId) return
        const projectKey = projectId ?? "none"
        // Use refetchQueries to force immediate refetch regardless of staleTime
        await Promise.all([
            queryClient.refetchQueries({
                queryKey: ["preview-evaluation-run-summary", projectKey, runId],
            }),
            queryClient.refetchQueries({
                queryKey: ["preview", "evaluation-run", runId, projectId],
            }),
        ])
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
            // Invalidate the batcher cache and refetch queries
            if (projectId) {
                invalidatePreviewRunCache(projectId, runId)
            }
            await refetchRunQueries()
        } catch (error) {
            console.error("[PreviewEvalRunHeader] Failed to toggle online evaluation", error)
            message.error(
                actionType === "stop" ? "Failed to stop evaluation" : "Failed to resume evaluation",
            )
        } finally {
            setOnlineAction(null)
        }
    }, [canStopOnline, projectId, refetchRunQueries, runId, showOnlineAction])

    const tabs = useMemo(() => {
        const base: {label: string; value: ActiveView}[] = [
            {label: "Overview", value: "overview"},
            {label: "Scenarios", value: "scenarios"},
            {label: "Configuration", value: "configuration"},
        ]

        if (evalType === "human") {
            base.push({label: "Focus", value: "focus"})
        }

        return base
    }, [evalType])

    const currentView = activeView ?? tabs[0]?.value ?? "overview"

    return (
        <div
            className={clsx(
                "w-full",
                "flex items-center justify-between gap-4 p-2 sticky top-0 z-[11] bg-white",
                currentView === "overview" && "border-0",
                className,
            )}
        >
            <div className={clsx("flex min-w-0 items-center gap-6")}>
                <Tabs
                    className="run-header-tabs [&_.ant-tabs-nav]:mb-0"
                    activeKey={currentView}
                    onChange={(key) => {
                        const view = key as ActiveView
                        if (view !== currentView) {
                            onChangeView?.(view)
                        }
                    }}
                    items={tabs.map((tab) => ({
                        key: tab.value,
                        label: tab.label,
                    }))}
                />
            </div>
            <div className="flex items-center gap-3 shrink-0">
                <Space size={8} wrap className="text-[#475467]">
                    {runStatus ? (
                        <>
                            <Tag color={statusColor(runStatus)} className="m-0">
                                {runStatus}
                            </Tag>
                            {lastUpdated ? (
                                <Tooltip title={updatedMoment?.format("DD MMM YYYY HH:mm") ?? ""}>
                                    <span className="text-xs text-[#98A2B3] whitespace-nowrap">
                                        Updated {lastUpdated}
                                    </span>
                                </Tooltip>
                            ) : null}
                        </>
                    ) : null}
                </Space>
                {showOnlineAction ? (
                    <Tooltip title={canStopOnline ? "Pause evaluation" : "Resume evaluation"}>
                        <Button
                            type={canStopOnline ? "default" : "primary"}
                            size="small"
                            icon={canStopOnline ? <Pause size={16} /> : <Play size={16} />}
                            loading={onlineAction !== null}
                            onClick={handleOnlineAction}
                        >
                            {canStopOnline ? "Pause" : "Resume"}
                        </Button>
                    </Tooltip>
                ) : null}
                <CompareRunsMenu runId={runId} />
            </div>
        </div>
    )
}

export default memo(PreviewEvalRunHeader)
