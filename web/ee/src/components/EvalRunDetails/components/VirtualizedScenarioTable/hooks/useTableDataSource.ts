import {useCallback, useMemo, useState} from "react"

import deepEqual from "fast-deep-equal"
import {atom, useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
import groupBy from "lodash/groupBy"
import {useLocalStorage} from "usehooks-ts"

import {
    displayedScenarioIds,
    evaluationEvaluatorsAtom,
    evaluationRunStateAtom,
    loadableScenarioStepFamily,
    runIndexAtom,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {runMetricsStatsAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"
import {ColumnDef} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"

import {buildScenarioTableData, buildScenarioTableRows} from "../assets/dataSourceBuilder"
import {buildAntdColumns} from "../assets/utils"

const EMPTY_SCENARIOS: any[] = []

export const allScenariosLoadedAtom = atom(
    (get) =>
        (get(evaluationRunStateAtom).scenarios || EMPTY_SCENARIOS).map((s: any) => s.id)?.length >
        0,
)

export const metricsFromEvaluatorsAtom = selectAtom(
    evaluationEvaluatorsAtom,
    (evs) => {
        return groupBy(
            evs.reduce((acc, ev) => {
                return [
                    ...acc,
                    ...Object.entries(ev.metrics).map(([metricName, metricInfo]) => {
                        return {
                            [metricName]: {
                                metricType: metricInfo.type,
                            },
                            evaluatorSlug: ev.slug,
                        }
                    }),
                ]
            }, []),
            (def) => {
                return def.evaluatorSlug
            },
        )
    },
    deepEqual,
)

const useTableDataSource = () => {
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
    const toggleGroup = useCallback(
        (key: string) => setCollapsedGroups((prev) => ({...prev, [key]: !prev[key]})),
        [],
    )

    const scenarioIds = useAtomValue(displayedScenarioIds) || EMPTY_SCENARIOS
    const allScenariosLoaded = useAtomValue(allScenariosLoadedAtom)

    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})

    // const metricDistributions = useAtomValue(runMetricsStatsAtom)
    const runIndex = useAtomValue(runIndexAtom)
    const metricsFromEvaluators = useAtomValue(metricsFromEvaluatorsAtom) || EMPTY_SCENARIOS
    const evaluationRunState = useAtomValue(evaluationRunStateAtom)
    const metrics = useAtomValue(runMetricsStatsAtom)
    // temporary implementation to implement loading state for auto eval
    const loadable = useAtomValue(loadableScenarioStepFamily(scenarioIds?.[0]))

    const isLoadingSteps = useMemo(
        () => loadable.state === "loading" || !allScenariosLoaded,
        [loadable, allScenariosLoaded],
    )

    const rows = useMemo(() => {
        return buildScenarioTableRows({
            scenarioIds,
            allScenariosLoaded,
        })
    }, [scenarioIds, allScenariosLoaded])

    // New alternative data source built via shared helper
    const builtColumns: ColumnDef[] = useMemo(
        () =>
            buildScenarioTableData({
                runIndex,
                metricsFromEvaluators,
                metrics,
            }),
        [runIndex, metricsFromEvaluators, metrics],
    )

    const evaluationRunName = useMemo(() => {
        return evaluationRunState?.enrichedRun?.name
    }, [evaluationRunState])

    // Handle column resize updates
    const handleResize = useCallback(
        (colKey: string) =>
            (_: any, {size}: {size: {width: number}}) => {
                // Enforce minimum width of 50px
                const minWidth = 50
                const newWidth = Math.max(size.width, minWidth)
                setColumnWidths((widths) => ({...widths, [colKey]: newWidth}))
            },
        [],
    )

    const makeColumnsResizable = useCallback(
        (cols: any): any => {
            return cols.map((col: any) => {
                const colKey =
                    col?.key || col?.dataIndex || col?.title || Math.random().toString(36).slice(2)

                // If this column has children, treat it as a pure group header: keep all original
                // props (title, fixed, etc.) and recurse into children.  We intentionally avoid
                // attaching resize handlers to the header cell itself so that the resize handles
                // appear only on the leaf columns.
                if (Array.isArray(col?.children) && col?.children.length) {
                    return {
                        ...col,
                        key: colKey,
                        width: columnWidths[colKey] || col?.width || 240,
                        ellipsis: true,
                        // minWidth: col?.minWidth || 120,
                        onHeaderCell: () => ({
                            width: columnWidths[colKey] || col?.width || 240,
                            minWidth: col?.minWidth ?? 120,
                            style: {textAlign: "center"},
                            onResize: handleResize(colKey),
                        }),
                        // Preserve explicit width if author supplied one, otherwise let AntD auto size
                        // width: col?.width,
                        children: makeColumnsResizable(col?.children),
                    }
                }

                // Leaf columns – optional auto-width handling
                if (col?.autoWidth) {
                    return {
                        ...col,
                        key: colKey,
                        // width: columnWidths[colKey] ?? col?.width,
                        width: columnWidths[colKey] || Math.max(col?.width || 160, 80),
                        ellipsis: true,
                        onHeaderCell: () => ({
                            width: columnWidths[colKey] || Math.max(col?.width ?? 160, 80),
                            minWidth: 80,
                            onResize: handleResize(colKey),
                        }),
                    }
                }

                return {
                    ...col,
                    key: colKey,
                    ellipsis: true,
                    width: columnWidths[colKey] ?? col?.width ?? 160,
                    onHeaderCell: () => ({
                        width: columnWidths[colKey] ?? col?.width ?? 160,
                        minWidth: col?.minWidth ?? 80,
                        onResize: handleResize(colKey),
                    }),
                }
            })
        },
        [columnWidths, handleResize],
    )

    // Build Ant Design columns and make them resizable
    const antColumns = useMemo(() => {
        const base = buildAntdColumns(
            builtColumns,
            // metricDistributions,
            collapsedGroups,
            toggleGroup,
            evaluationRunName,
        )
        return makeColumnsResizable(base)
    }, [makeColumnsResizable, builtColumns, collapsedGroups, toggleGroup, evaluationRunName])

    const totalColumnWidth = useMemo(() => {
        const calc = (cols: any[]): number =>
            cols.reduce((sum, col) => {
                if (col?.children && col?.children.length) {
                    return sum + calc(col?.children)
                }
                return sum + (columnWidths[col?.key] ?? col?.width ?? col?.minWidth ?? 100)
            }, 0)
        return calc(antColumns)
    }, [antColumns, columnWidths])

    return {
        antColumns,
        rows,
        totalColumnWidth,
        isLoadingSteps,
    }
}

export default useTableDataSource
