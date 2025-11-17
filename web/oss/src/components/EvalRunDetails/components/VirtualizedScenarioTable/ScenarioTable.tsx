import {memo, useCallback, useEffect, useMemo, useState} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useResizeObserver} from "usehooks-ts"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import NextViewport from "@/oss/components/Onboarding/components/NextViewport"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import QueryFiltersSummaryCard from "@/oss/components/pages/evaluations/onlineEvaluation/components/QueryFiltersSummaryCard"
import {useRunId} from "@/oss/contexts/RunIdContext"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {
    evalAtomStore,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {useAppNavigation, useAppState} from "@/oss/state/appState"

import {
    retrieveQueryRevision,
    type QueryFilteringPayload,
    type QueryWindowingPayload,
} from "../../../../services/onlineEvaluations/api"
import {EvalRunTestcaseTableSkeleton} from "../../AutoEvalRun/components/EvalRunTestcaseViewer/assets/EvalRunTestcaseViewerSkeleton"

import useScrollToScenario from "./hooks/useScrollToScenario"
import useTableDataSource from "./hooks/useTableDataSource"
import type {TableRow} from "./types"
import {HUMAN_EVAL_TABLE_VIEWPORT_ID} from "./assets/constants"

const VirtualizedScenarioTableAnnotateDrawer = dynamic(
    () => import("./assets/VirtualizedScenarioTableAnnotateDrawer"),
    {ssr: false},
)

const ScenarioTable = ({runId: propRunId}: {runId?: string}) => {
    // Data sources - use prop runId if provided, otherwise fall back to context
    const contextRunId = useRunId()
    const runId = propRunId || contextRunId
    const {antColumns, rows, isLoadingSteps} = useTableDataSource()
    const hasRows = rows.length > 0
    const store = evalAtomStore()
    const evaluationState = useAtomValue(evaluationRunStateFamily(runId!), {store}) as any
    const evalType = useAtomValue(evalTypeAtom)
    const navigation = useAppNavigation()
    const appState = useAppState()

    const runIndex = evaluationState?.runIndex
    const queryRef = useMemo(() => {
        const steps: Record<string, any> = runIndex?.steps || {}
        for (const meta of Object.values(steps)) {
            const refs = (meta as any)?.refs || {}
            if (refs?.query?.id) return {id: refs.query.id}
            if (refs?.query_revision?.id) return {revisionId: refs.query_revision.id}
        }
        return undefined
    }, [runIndex?.steps])

    const [filtering, setFiltering] = useState<QueryFilteringPayload | null | undefined>(undefined)
    const [windowing, setWindowing] = useState<QueryWindowingPayload | null | undefined>(undefined)
    const [filtersLoading, setFiltersLoading] = useState<boolean>(false)
    const [queryCreatedAt, setQueryCreatedAt] = useState<string | number | null>(null)

    const resolveTimestamp = (
        ...values: (string | number | null | undefined)[]
    ): string | number | null => {
        for (const value of values) {
            if (!value) continue
            const parsed = dayjs(value)
            if (parsed.isValid()) return value
        }
        return null
    }

    useEffect(() => {
        let mounted = true
        ;(async () => {
            try {
                setFiltersLoading(true)
                if (!queryRef?.id) {
                    if (mounted) setFiltering(null)
                    if (mounted) setWindowing(null)
                    if (mounted) setQueryCreatedAt(null)
                    if (mounted) setFiltersLoading(false)
                    return
                }
                const res = await retrieveQueryRevision({query_ref: {id: queryRef.id}})
                if (mounted) {
                    const data = (res?.query_revision?.data as any) ?? {}
                    setFiltering(data?.filtering ?? null)
                    setWindowing(data?.windowing ?? null)
                    setQueryCreatedAt(
                        resolveTimestamp(
                            (res?.query_revision as any)?.created_at,
                            (res?.query_revision as any)?.createdAt,
                            (res?.query_revision as any)?.createdAtTimestamp,
                            (res?.query_revision?.meta as any)?.created_at,
                            (res?.query_revision?.meta as any)?.createdAt,
                        ),
                    )
                }
            } catch {
                if (mounted) {
                    setFiltering(null)
                    setWindowing(null)
                    setQueryCreatedAt(null)
                }
            } finally {
                if (mounted) setFiltersLoading(false)
            }
        })()
        return () => {
            mounted = false
        }
    }, [queryRef?.id])

    const runCreatedAt = useMemo(
        () =>
            resolveTimestamp(
                queryCreatedAt,
                (evaluationState?.rawRun as any)?.created_at,
                (evaluationState?.rawRun as any)?.createdAt,
                (evaluationState?.rawRun as any)?.createdAtTimestamp,
                (evaluationState?.enrichedRun as any)?.created_at,
                (evaluationState?.enrichedRun as any)?.createdAt,
                (evaluationState?.enrichedRun as any)?.createdAtTimestamp,
            ),
        [queryCreatedAt, evaluationState],
    )

    const {tableContainerRef, tableInstance} = useScrollToScenario({
        dataSource: rows,
    })

    const {height: scrollY} = useResizeObserver({
        ref: tableContainerRef,
        box: "border-box",
    })

    const emptyTableContent = useMemo(() => {
        const isOnline = evalType === "online"
        return (
            <div className="flex w-full flex-col items-center justify-center gap-6 py-10 px-6 text-center">
                <div className="flex flex-col gap-2 max-w-xl text-[#475467]">
                    <span className="text-base font-semibold text-[#1D2939]">
                        {isOnline ? "No traces captured yet" : "No scenarios found"}
                    </span>
                    {isOnline && (
                        <span className="text-sm text-[#98A2B3]">
                            No traces matched the current query yet. This view updates automatically
                            as new requests match your filters.
                        </span>
                    )}
                </div>
                {isOnline && (
                    <div className="w-full max-w-lg">
                        <QueryFiltersSummaryCard
                            filtering={filtering ?? null}
                            windowing={windowing ?? null}
                            loading={filtersLoading}
                            createdAt={runCreatedAt}
                        />
                    </div>
                )}
            </div>
        )
    }, [evalType, filtering, filtersLoading, runCreatedAt, windowing])

    const tableScrollY = useMemo(() => {
        if (!scrollY) return undefined
        const computed = scrollY - 45
        return Number.isFinite(computed) && computed > 0 ? computed : undefined
    }, [scrollY])

    const handleRowFocus = useCallback(
        (record: TableRow, event: React.MouseEvent) => {
            if (evalType !== "auto" && evalType !== "online" && evalType !== "custom") return

            // Ignore clicks originating from interactive elements inside the row
            const interactiveTarget = (event.target as HTMLElement | null)?.closest(
                "button, a, [role='button'], .ant-btn",
            )
            if (interactiveTarget) return

            const scenarioId = record?.scenarioId || record?.key
            const targetRunId = (record as any)?.runId || runId
            if (!scenarioId || !targetRunId) return

            const currentScenario = appState.query?.focusScenarioId
            const currentRun = appState.query?.focusRunId
            const scenarioMatches = Array.isArray(currentScenario)
                ? currentScenario[0] === scenarioId
                : currentScenario === scenarioId
            const runMatches = Array.isArray(currentRun)
                ? currentRun[0] === targetRunId
                : currentRun === targetRunId

            if (scenarioMatches && runMatches) return

            navigation.patchQuery(
                {
                    focusScenarioId: scenarioId,
                    focusRunId: targetRunId,
                },
                {shallow: true},
            )
        },
        [appState.query?.focusRunId, appState.query?.focusScenarioId, evalType, navigation, runId],
    )

    if (isLoadingSteps && !hasRows) {
        return <EvalRunTestcaseTableSkeleton />
    }

    return (
        <div
            ref={tableContainerRef}
            className="grow flex flex-col w-full min-h-0"
            id={evalType === "online" ? "tour-online-eval-results-table" : undefined}
        >
            <div
                className={clsx([
                    "relative w-full flex-1 min-h-0",
                    {
                        "px-6": evalType === "online",
                    },
                ])}
            >
                <EnhancedTable
                    uniqueKey="scenario-table"
                    columns={antColumns as any}
                    dataSource={rows}
                    scroll={{x: "max-content", y: scrollY - 45}}
                    size="small"
                    virtualized
                    rowKey={(record: any) => record.key || record.scenarioId}
                    className="agenta-scenario-table"
                    rowClassName={(record: any) =>
                        clsx(
                            "scenario-row",
                            record?.temporalGroupIndex % 2 === 0 ? "bg-slate-50" : "bg-white",
                            record?.isTemporalGroupStart &&
                                "border-t border-slate-200 first:border-t-0",
                        )
                    }
                    tableLayout="fixed"
                    skeletonRowCount={0}
                    loading={false}
                    locale={{emptyText: emptyTableContent}}
                    ref={tableInstance}
                    onRow={(record: any) => ({
                        onClick: (event) => handleRowFocus(record, event),
                    })}
                />

                <VirtualizedScenarioTableAnnotateDrawer runId={runId} />
            </div>
        </div>
    )
}

export default memo(ScenarioTable)
