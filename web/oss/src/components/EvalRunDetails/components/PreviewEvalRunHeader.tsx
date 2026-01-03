import {memo, useCallback, useMemo, useState} from "react"

import {PauseIcon, PlayIcon, XCircleIcon} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Tabs, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {invalidatePreviewRunCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"
import {startSimpleEvaluation, stopSimpleEvaluation} from "@/oss/services/onlineEvaluations/api"

import {compareRunIdsAtom, compareRunIdsWriteAtom, getComparisonSolidColor} from "../atoms/compare"
import {
    runDisplayNameAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
    runFlagsAtomFamily,
} from "../atoms/runDerived"
import {previewEvalTypeAtom} from "../state/evalType"

import CompareRunsMenu from "./CompareRunsMenu"
import EvaluationRunTag from "./EvaluationRunTag"

type ActiveView = "overview" | "focus" | "scenarios" | "configuration"

const useOnlineEvaluationActions = (runId: string, projectId?: string | null) => {
    const queryClient = useQueryClient()
    const runFlags = useAtomValue(useMemo(() => runFlagsAtomFamily(runId), [runId]))
    const evalType = useAtomValue(previewEvalTypeAtom)
    const [onlineAction, setOnlineAction] = useState<"start" | "stop" | null>(null)

    const isOnlineEvaluation = evalType === "online"
    const isClosed = runFlags?.isClosed === true
    const isActive = runFlags?.isActive === true && !isClosed
    const canStopOnline = Boolean(isOnlineEvaluation && runId && isActive && !isClosed)
    const canResumeOnline = Boolean(isOnlineEvaluation && runId && !isActive && !isClosed)
    const showOnlineAction = canStopOnline || canResumeOnline

    const refetchRunQueries = useCallback(async () => {
        if (!runId) return
        const projectKey = projectId ?? "none"
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

    return {
        canStopOnline,
        canResumeOnline,
        handleOnlineAction,
        onlineAction,
        showOnlineAction,
    }
}

const PreviewEvalRunTabs = ({
    className,
    activeView,
    onChangeView,
}: {
    className?: string
    activeView?: ActiveView
    onChangeView?: (v: ActiveView) => void
}) => {
    const evalType = useAtomValue(previewEvalTypeAtom)

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
        <div className={clsx("flex items-center justify-end", className)}>
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
    )
}

const PreviewEvalRunMeta = ({
    runId,
    projectId,
    className,
}: {
    runId: string
    projectId?: string | null
    className?: string
}) => {
    const _invocationRefs = useAtomValue(useMemo(() => runInvocationRefsAtomFamily(runId), [runId]))
    const _testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId), [runId]))
    const {canStopOnline, handleOnlineAction, onlineAction, showOnlineAction} =
        useOnlineEvaluationActions(runId, projectId)
    const compareRunIds = useAtomValue(compareRunIdsAtom)
    const setCompareRunIds = useSetAtom(compareRunIdsWriteAtom)

    const orderedRunIds = useMemo(() => {
        const ids = [runId, ...compareRunIds].filter((id): id is string => Boolean(id))
        const seen = new Set<string>()
        return ids.filter((id) => {
            if (seen.has(id)) return false
            seen.add(id)
            return true
        })
    }, [compareRunIds, runId])

    const runDescriptorsAtom = useMemo(
        () =>
            atom((get) =>
                orderedRunIds.map((id) => ({
                    id,
                    name: get(runDisplayNameAtomFamily(id)),
                })),
            ),
        [orderedRunIds],
    )
    const runDescriptors = useAtomValue(runDescriptorsAtom)

    return (
        <div className={clsx("flex items-center justify-between gap-4 px-4", className)}>
            <div className="flex min-w-0 items-center gap-2">
                <Typography.Text className="whitespace-nowrap">Evaluations:</Typography.Text>
                <div className="flex flex-nowrap gap-2 min-w-0 overflow-x-auto">
                    {runDescriptors.map((run, index) => {
                        const isBaseRun = index === 0
                        const tagColor = getComparisonSolidColor(index)
                        return (
                            <EvaluationRunTag
                                key={run.id}
                                label={run.name}
                                compareIndex={index}
                                isBaseRun={isBaseRun}
                                closable={!isBaseRun}
                                closeIcon={
                                    !isBaseRun ? (
                                        <XCircleIcon size={14} style={{color: tagColor}} />
                                    ) : undefined
                                }
                                onClose={
                                    !isBaseRun
                                        ? (event) => {
                                              event.preventDefault()
                                              setCompareRunIds((prev) =>
                                                  prev.filter((id) => id !== run.id),
                                              )
                                          }
                                        : undefined
                                }
                            />
                        )
                    })}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {showOnlineAction ? (
                    <Tooltip title={canStopOnline ? "Pause evaluation" : "Resume evaluation"}>
                        <Button
                            type={canStopOnline ? "default" : "primary"}
                            size="small"
                            icon={canStopOnline ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
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

export {PreviewEvalRunMeta}
export default memo(PreviewEvalRunTabs)
