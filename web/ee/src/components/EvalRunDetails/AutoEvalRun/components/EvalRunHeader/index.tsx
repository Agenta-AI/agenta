import {memo, useCallback, useEffect, useState} from "react"

import {ReloadOutlined} from "@ant-design/icons"
import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {useRunId} from "@/oss/contexts/RunIdContext"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import useEvaluationRunData from "@/oss/lib/hooks/useEvaluationRunData"
import {
    evalAtomStore,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {progressFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/progress"
import refreshLiveEvaluationRun from "@/oss/lib/hooks/useEvaluationRunData/refreshLiveRun"
import {startSimpleEvaluation, stopSimpleEvaluation} from "@/oss/services/onlineEvaluations/api"

import EvalRunScenariosViewSelector from "../../../components/EvalRunScenariosViewSelector"
import {evalTypeAtom} from "../../../state/evalType"
import {runViewTypeAtom, urlStateAtom} from "../../../state/urlState"
import EvalRunCompareMenu from "../EvalRunCompareMenu"
import EvalRunSelectedEvaluations from "../EvalRunSelectedEvaluations"

const AUTO_REFRESH_INTERVAL_MS = 120_000

const EvalRunHeader = ({className, name, id}: {className?: string; name: string; id: string}) => {
    const store = evalAtomStore()
    const viewType = useAtomValue(runViewTypeAtom, {store})
    const urlState = useAtomValue(urlStateAtom, {store})
    const evalType = useAtomValue(evalTypeAtom)
    const baseRunId = useRunId()
    const progress = useAtomValue(progressFamily(baseRunId!), {store})
    const state = useAtomValue(evaluationRunStateFamily(baseRunId!), {store}) as any
    const enrichedRun = state?.enrichedRun
    const updatedTs =
        (enrichedRun as any)?.updatedAtTimestamp || (enrichedRun as any)?.createdAtTimestamp
    const updatedMoment = updatedTs ? dayjs(updatedTs) : null
    const lastUpdated = updatedMoment?.isValid() ? updatedMoment.fromNow() : undefined
    const flags = ((enrichedRun as any)?.flags || {}) as {
        isActive?: boolean
        isClosed?: boolean
    }
    const runStatus = ((state?.rawRun as any)?.status ||
        (enrichedRun as any)?.status ||
        (enrichedRun as any)?.data?.status) as string | undefined
    const normalizedRunStatus = runStatus
        ? runStatus
              .split("_")
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" ")
        : undefined
    const isActiveFlag = (flags as any).isActive ?? (flags as any).is_active
    const isClosedFlag = (flags as any).isClosed ?? (flags as any).is_closed
    const isActive = Boolean(isActiveFlag)
    const isClosed = Boolean(isClosedFlag)
    const baseStatusLabel = (() => {
        if (!progress || progress.total === 0) return "Running"
        if (progress.completed >= progress.total) return "Completed"
        if (progress.inProgress > 0 || progress.pending > 0) return "Running"
        return "Pending"
    })()
    const activeStatusLabel = (() => {
        if (!normalizedRunStatus) return "Running"
        const lower = normalizedRunStatus.toLowerCase()
        const looksActive = ["run", "progress", "active"].some((token) => lower.includes(token))
        return looksActive ? normalizedRunStatus : "Running"
    })()

    const statusLabel =
        evalType === "online"
            ? isClosed
                ? "Closed"
                : isActive
                  ? activeStatusLabel
                  : normalizedRunStatus && normalizedRunStatus !== "Running"
                    ? normalizedRunStatus
                    : progress?.completed
                      ? "Completed"
                      : "Stopped"
            : baseStatusLabel
    const {refetchEvaluation} = useEvaluationRunData(
        baseRunId || null,
        false,
        baseRunId || undefined,
    )
    const [action, setAction] = useState<"start" | "stop" | null>(null)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const isProcessing = action !== null
    const canStart = !isActive && !isClosed
    const canStop = isActive
    const onStop = useCallback(async () => {
        if (!baseRunId) return
        try {
            setAction("stop")
            await stopSimpleEvaluation(baseRunId)
            message.success("Evaluation stopped")
            refetchEvaluation?.()
        } catch (e) {
            message.error("Failed to stop evaluation")
        } finally {
            setAction(null)
        }
    }, [baseRunId, refetchEvaluation])
    const onStart = useCallback(async () => {
        if (!baseRunId) return
        try {
            setAction("start")
            await startSimpleEvaluation(baseRunId)
            message.success("Evaluation started")
            refetchEvaluation?.()
        } catch (e) {
            message.error("Failed to start evaluation")
        } finally {
            setAction(null)
        }
    }, [baseRunId, refetchEvaluation])
    const onRefresh = useCallback(async () => {
        if (!baseRunId || !refetchEvaluation) return
        const key = `live-run-refresh-${baseRunId}`
        try {
            setIsRefreshing(true)
            message.loading({key, content: "Refreshing evaluation...", duration: 0})
            await refetchEvaluation({background: true})
            const {scenarioCount} = await refreshLiveEvaluationRun(baseRunId)
            const suffix =
                typeof scenarioCount === "number" && scenarioCount >= 0
                    ? ` (${scenarioCount} scenarios)`
                    : ""
            message.success({key, content: `Evaluation refreshed${suffix}`})
        } catch (error) {
            console.error("[EvalRunHeader] Failed to refresh live evaluation run", error)
            message.error({key, content: "Failed to refresh evaluation"})
        } finally {
            setIsRefreshing(false)
        }
    }, [baseRunId, refetchEvaluation])

    useEffect(() => {
        if (evalType !== "online") return
        if (!baseRunId || !refetchEvaluation) return
        if (typeof window === "undefined") return
        if (isClosed) return

        let cancelled = false
        let timeoutId: number | null = null
        let inFlight = false

        const shouldDefer = () =>
            typeof document !== "undefined" && document.visibilityState === "hidden"

        function schedule() {
            if (cancelled) return
            if (timeoutId) {
                window.clearTimeout(timeoutId)
            }
            timeoutId = window.setTimeout(() => {
                void runRefresh()
            }, AUTO_REFRESH_INTERVAL_MS)
        }

        async function runRefresh() {
            if (cancelled) return
            if (inFlight || isRefreshing || isProcessing) {
                schedule()
                return
            }
            if (shouldDefer()) {
                schedule()
                return
            }
            inFlight = true
            try {
                await refetchEvaluation({background: true})
                await refreshLiveEvaluationRun(baseRunId)
            } catch (error) {
                console.error("[EvalRunHeader] Auto refresh failed", error)
            } finally {
                inFlight = false
                schedule()
            }
        }

        const handleVisibilityChange = () => {
            if (cancelled) return
            if (!shouldDefer()) {
                if (timeoutId) {
                    window.clearTimeout(timeoutId)
                }
                void runRefresh()
            }
        }

        schedule()

        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", handleVisibilityChange)
        }

        return () => {
            cancelled = true
            if (timeoutId) {
                window.clearTimeout(timeoutId)
            }
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", handleVisibilityChange)
            }
        }
    }, [baseRunId, evalType, isClosed, isProcessing, isRefreshing, refetchEvaluation])
    return (
        <div
            className={clsx([
                "w-full",
                "flex items-center justify-between gap-4 py-2 px-6 sticky top-0 z-[11] bg-white",
                {"border-0 border-b border-solid border-[#0517290F]": viewType === "overview"},
                className,
            ])}
        >
            <EvalRunScenariosViewSelector />
            {evalType !== "online" ? (
                <div className="flex items-center gap-4 min-w-0 shrink max-w-full">
                    <div className="min-w-0 flex-1">
                        {urlState.compare?.length > 0 && (
                            <EvalRunSelectedEvaluations
                                runIds={urlState.compare || []}
                                baseRunId={baseRunId!}
                            />
                        )}
                    </div>

                    <EvalRunCompareMenu
                        buttonProps={{type: "primary"}}
                        popoverProps={{placement: "bottomRight"}}
                    />
                </div>
            ) : null}
            {evalType === "online" ? (
                <div className="flex w-full min-w-0 shrink items-center justify-end gap-3">
                    <div className="flex min-w-0 items-center gap-3 text-[#475467]">
                        <div className="flex items-center gap-1">
                            <span
                                className={clsx(
                                    "shrink-0 inline-block w-2 h-2 rounded-full",
                                    statusLabel === "Running"
                                        ? "bg-green-500"
                                        : statusLabel === "Completed" || statusLabel === "Closed"
                                          ? "bg-gray-400"
                                          : statusLabel === "Stopped"
                                            ? "bg-red-500"
                                            : "bg-yellow-500",
                                )}
                            />
                            <span className="shrink-0 whitespace-nowrap">{statusLabel}</span>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#98A2B3]">
                            {lastUpdated ? (
                                <Tooltip title={updatedMoment?.format("DD MMM YYYY HH:mm") ?? ""}>
                                    <span className="whitespace-nowrap">Updated {lastUpdated}</span>
                                </Tooltip>
                            ) : null}
                        </div>
                    </div>
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={onRefresh}
                        loading={isRefreshing}
                        disabled={isRefreshing || isProcessing}
                    >
                        Refresh
                    </Button>
                    {canStop ? (
                        <Button
                            danger
                            onClick={onStop}
                            loading={action === "stop"}
                            disabled={isProcessing || isRefreshing}
                        >
                            Stop evaluation
                        </Button>
                    ) : (
                        <Button
                            type="primary"
                            onClick={onStart}
                            loading={action === "start"}
                            disabled={isProcessing || !canStart || isRefreshing}
                        >
                            Start evaluation
                        </Button>
                    )}
                </div>
            ) : null}
        </div>
    )
}

export default memo(EvalRunHeader)
