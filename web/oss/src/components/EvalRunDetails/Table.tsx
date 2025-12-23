import {useCallback, useMemo, useRef} from "react"

import {useAtomValue, useStore} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import VirtualizedScenarioTableAnnotateDrawer from "@/oss/components/EvalRunDetails/components/AnnotateDrawer/VirtualizedScenarioTableAnnotateDrawer"
import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
    useInfiniteTablePagination,
} from "@/oss/components/InfiniteVirtualTable"
import {
    EXPORT_RESOLVE_SKIP,
    type TableExportColumnContext,
} from "@/oss/components/InfiniteVirtualTable/hooks/useTableExport"

import {MAX_COMPARISON_RUNS, compareRunIdsAtom, getComparisonColor} from "./atoms/compare"
import {runDisplayNameAtomFamily} from "./atoms/runDerived"
import type {EvaluationTableColumn} from "./atoms/table"
import {DEFAULT_SCENARIO_PAGE_SIZE} from "./atoms/table"
import type {PreviewTableRow} from "./atoms/tableRows"
import {
    evaluationPreviewDatasetStore,
    evaluationPreviewTableStore,
} from "./evaluationPreviewTableStore"
import {resolveScenarioColumnValue} from "./export/columnResolvers"
import {buildGroupMap, resolveScenarioColumnLabel} from "./export/labelResolvers"
import type {ScenarioColumnExportMetadata} from "./export/types"

import {buildExportMetadata} from "./export/types"
import usePreviewColumns from "./hooks/usePreviewColumns"
import usePreviewTableData from "./hooks/usePreviewTableData"
import useRowHeightMenuItems from "./hooks/useRowHeightMenuItems"
import {scenarioRowHeightAtom} from "./state/rowHeight"
import {patchFocusDrawerQueryParams} from "./state/urlFocusDrawer"
import useComparisonPaginations from "../EvalRunDetails2/hooks/useComparisonPaginations"

type TableRowData = PreviewTableRow

// Alternating background colors for timestamp-based batch grouping
const TIMESTAMP_GROUP_COLORS = [
    "rgba(59, 130, 246, 0.06)", // blue
    "rgba(16, 185, 129, 0.06)", // green
]

interface EvalRunDetailsTableProps {
    runId: string
    evaluationType: "auto" | "human" | "online"
    skeletonRowCount?: number
    projectId?: string | null
}

const EvalRunDetailsTable = ({
    runId,
    evaluationType,
    skeletonRowCount = DEFAULT_SCENARIO_PAGE_SIZE,
    projectId: _projectId = null,
}: EvalRunDetailsTableProps) => {
    const pageSize = skeletonRowCount ?? 50
    const compareRunIds = useAtomValue(compareRunIdsAtom)
    const rowHeight = useAtomValue(scenarioRowHeightAtom)
    const runDisplayNameAtom = useMemo(() => runDisplayNameAtomFamily(runId), [runId])
    const runDisplayName = useAtomValue(runDisplayNameAtom)
    const rowHeightMenuItems = useRowHeightMenuItems()
    const store = useStore()

    const basePagination = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: runId,
        pageSize,
    })

    const compareSlots = useMemo(
        () => Array.from({length: MAX_COMPARISON_RUNS}, (_, index) => compareRunIds[index] ?? null),
        [compareRunIds],
    )

    // Use custom hook to handle multiple comparison paginations
    const comparePaginations = useComparisonPaginations({
        compareSlots,
        pageSize,
    })

    const compareRowsBySlot = useMemo(
        () => comparePaginations.map((pagination) => pagination.rows),
        [comparePaginations],
    )

    const {columnResult} = usePreviewTableData({runId})

    const previewColumns = usePreviewColumns({columnResult, evaluationType})

    // Inject synthetic columns for comparison exports (hidden in table display)
    const columnsWithSyntheticColumns = useMemo(() => {
        const hasCompareRuns = compareSlots.some(Boolean)
        if (!hasCompareRuns) {
            return previewColumns.columns
        }

        const hiddenColumnStyle = {
            display: "none",
            width: 0,
            minWidth: 0,
            maxWidth: 0,
            padding: 0,
            margin: 0,
            border: "none",
            visibility: "hidden",
            position: "absolute",
            left: "-9999px",
        } as const

        // Create synthetic "Run" column for export only (completely hidden in table)
        const runColumn = {
            key: "__run_type__",
            title: () => null,
            dataIndex: "__run_type__",
            width: 0,
            minWidth: 0,
            maxWidth: 0,
            render: () => null,
            exportEnabled: true,
            exportLabel: "Run",
            onHeaderCell: () => ({style: hiddenColumnStyle}),
            onCell: () => ({style: hiddenColumnStyle}),
        }

        // Create synthetic "Run ID" column for export only (completely hidden in table)
        const runIdColumn = {
            key: "__run_id__",
            title: () => null,
            dataIndex: "__run_id__",
            width: 0,
            minWidth: 0,
            maxWidth: 0,
            render: () => null,
            exportEnabled: true,
            exportLabel: "Run ID",
            onHeaderCell: () => ({style: hiddenColumnStyle}),
            onCell: () => ({style: hiddenColumnStyle}),
        }

        return [runColumn, runIdColumn, ...previewColumns.columns]
    }, [previewColumns.columns, compareSlots])

    const mergedRows = useMemo(() => {
        if (!compareSlots.some(Boolean)) {
            return basePagination.rows.map((row) => ({
                ...row,
                baseScenarioId: row.scenarioId ?? row.id,
                compareIndex: 0,
                isComparisonRow: false,
            }))
        }

        const baseRows = basePagination.rows.map((row) => ({
            ...row,
            baseScenarioId: row.scenarioId ?? row.id,
            compareIndex: 0,
            isComparisonRow: false,
        }))

        const compareData = compareSlots.map((runId, idx) => {
            const slotRows = compareRowsBySlot[idx] ?? []
            const mapByTestcase = new Map<string, PreviewTableRow>()
            const mapByIndex = new Map<number, PreviewTableRow>()

            slotRows.forEach((row) => {
                if (!row || row.__isSkeleton) return
                if (row.testcaseId) {
                    mapByTestcase.set(row.testcaseId, row)
                }
                if (typeof row.scenarioIndex === "number") {
                    mapByIndex.set(row.scenarioIndex, row)
                }
            })

            return {
                runId,
                rows: slotRows,
                mapByTestcase,
                mapByIndex,
                compareIndex: idx + 1,
            }
        })

        const result: PreviewTableRow[] = []

        baseRows.forEach((baseRow) => {
            result.push(baseRow)
            if (baseRow.__isSkeleton) {
                return
            }

            const baseTestcaseId = baseRow.testcaseId
            const baseScenarioIndex = baseRow.scenarioIndex
            const baseScenarioId = baseRow.scenarioId ?? baseRow.id

            compareData.forEach(({runId, mapByTestcase, mapByIndex, compareIndex}) => {
                if (!runId) return
                const counterpart =
                    (baseTestcaseId ? mapByTestcase.get(baseTestcaseId) : undefined) ||
                    mapByIndex.get(baseScenarioIndex)

                if (counterpart) {
                    const key = `${runId}:${counterpart.scenarioId ?? counterpart.id}`
                    result.push({
                        ...counterpart,
                        rowId: key,
                        key,
                        runId,
                        baseScenarioId,
                        scenarioIndex: baseRow.scenarioIndex,
                        compareIndex,
                        isComparisonRow: true,
                        testcaseId: counterpart.testcaseId ?? baseTestcaseId,
                    })
                } else {
                    const key = `${runId}:${baseScenarioId}:placeholder:${compareIndex}`
                    result.push({
                        ...baseRow,
                        rowId: key,
                        key,
                        runId,
                        scenarioId: undefined,
                        baseScenarioId,
                        compareIndex,
                        isComparisonRow: true,
                        testcaseId: baseTestcaseId,
                        status: "loading",
                        __isSkeleton: true,
                    })
                }
            })
        })

        return result
    }, [basePagination.rows, compareSlots, compareRowsBySlot])

    const handleRowClick = useCallback(
        (record: TableRowData) => {
            if (record.__isSkeleton) return
            const scenarioId = record.scenarioId ?? record.id
            if (!scenarioId) return
            const targetRunId = record.runId ?? runId
            if (!targetRunId) return

            // Determine if we should open in compare mode
            const isBaseRow = !record.isComparisonRow
            const hasComparisons = compareRunIds.length > 0
            const shouldCompare = isBaseRow && hasComparisons

            const focusTarget = {
                focusRunId: targetRunId,
                focusScenarioId: scenarioId,
                compareMode: shouldCompare,
                testcaseId: shouldCompare ? record.testcaseId : undefined,
                scenarioIndex: shouldCompare ? record.scenarioIndex : undefined,
            }
            if (process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true") {
                console.info("[EvalRunDetails2][Table] row click", {focusTarget, record})
            }

            // Use patchFocusDrawerQueryParams which writes to the global Jotai store
            // (the table has an isolated Jotai Provider, so useSetAtom would write to the wrong store)
            patchFocusDrawerQueryParams(focusTarget)
        },
        [runId, compareRunIds],
    )

    const handleLoadMore = useCallback(() => {
        basePagination.loadNextPage()
        comparePaginations.forEach((pagination, idx) => {
            if (!compareSlots[idx]) return
            pagination.loadNextPage()
        })
    }, [basePagination, comparePaginations, compareSlots])

    const handleResetPages = useCallback(() => {
        basePagination.resetPages()
        comparePaginations.forEach((pagination, idx) => {
            if (!compareSlots[idx]) return
            pagination.resetPages()
        })
    }, [basePagination, comparePaginations, compareSlots])

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: runId,
            pageSize,
            enableInfiniteScroll: true,
            columnVisibilityStorageKey: runId ? `eval-run:${runId}:columns` : undefined,
        }),
        [pageSize, runId],
    )

    const paginationForShell = useMemo<TableFeaturePagination<TableRowData>>(
        () => ({
            rows: mergedRows,
            loadNextPage: handleLoadMore,
            resetPages: handleResetPages,
        }),
        [handleLoadMore, handleResetPages, mergedRows],
    )

    // Build timestamp color map for row grouping (only for online evaluations)
    const timestampColorMap = useMemo(() => {
        const map = new Map<string, string>()
        if (evaluationType !== "online") return map

        // Process rows in order to assign consistent colors
        mergedRows.forEach((row) => {
            if (row.timestamp && !map.has(row.timestamp)) {
                const colorIndex = map.size % TIMESTAMP_GROUP_COLORS.length
                map.set(row.timestamp, TIMESTAMP_GROUP_COLORS[colorIndex])
            }
        })
        return map
    }, [evaluationType, mergedRows])

    // Build group map for export label resolution
    const groupMap = useMemo(() => {
        return buildGroupMap(columnResult?.groups)
    }, [columnResult?.groups])

    // Build column lookup map from column key to EvaluationTableColumn
    const columnLookupMap = useMemo(() => {
        const map = new Map<string, EvaluationTableColumn>()

        // Add all regular columns
        if (columnResult?.columns) {
            columnResult.columns.forEach((col) => {
                map.set(col.id, col)
            })
        }

        // Add static metric columns (they have composite keys like "groupId::metricPath")
        if (columnResult?.groups && columnResult?.staticMetricColumns) {
            const metricsForType =
                evaluationType === "auto"
                    ? columnResult.staticMetricColumns.auto
                    : columnResult.staticMetricColumns.human

            columnResult.groups
                .filter((group) => group.kind === "metric")
                .forEach((group) => {
                    metricsForType.forEach((metric) => {
                        const key = `${group.id}::${metric.path}`
                        // Create a pseudo-column for static metrics
                        const pseudoColumn: EvaluationTableColumn = {
                            id: key,
                            label: metric.name,
                            displayLabel: metric.displayLabel ?? metric.name,
                            kind: "metric",
                            stepKey: metric.stepKey,
                            path: metric.path,
                            pathSegments: metric.path.split("."),
                            stepType: "metric",
                            valueKey: metric.path.split(".").pop(),
                            metricKey: metric.path,
                            metricType: metric.metricType,
                            groupId: group.id,
                        }
                        map.set(key, pseudoColumn)
                    })
                })
        }

        return map
    }, [columnResult, evaluationType])

    // Track export progress
    const exportProgressRef = useRef({
        processedRows: 0,
        skippedRows: 0,
        totalColumns: 0,
        startTime: 0,
    })

    // Track total rows being exported for summary
    const totalExportRowsRef = useRef(0)

    // Export value resolver - fetches actual cell values during export
    const exportResolveValue = useCallback(
        async ({
            column,
            row,
            rowIndex,
            columnIndex,
        }: {
            column: any
            row: PreviewTableRow
            rowIndex: number
            columnIndex: number
        }): Promise<unknown> => {
            const hasCompareRuns = compareSlots.some(Boolean)

            // The column from the table is an Ant Design column with a 'key' property
            const columnKey = (column as any)?.key
            if (!columnKey) {
                return EXPORT_RESOLVE_SKIP
            }

            const columnKeyStr = String(columnKey)

            // Handle synthetic "__run_type__" column for comparison exports
            if (columnKeyStr === "__run_type__") {
                // Track progress on the synthetic Run column
                if (columnIndex === 0) {
                    exportProgressRef.current.processedRows++

                    if (rowIndex === totalExportRowsRef.current - 1) {
                        const elapsed = Date.now() - exportProgressRef.current.startTime
                        const exportedCount =
                            exportProgressRef.current.processedRows -
                            exportProgressRef.current.skippedRows
                        console.info(
                            `[EvalRunDetails2][Export] ✓ Export complete - ${exportedCount} scenarios exported in ${(elapsed / 1000).toFixed(1)}s`,
                        )
                        console.info(
                            `[EvalRunDetails2][Export] Summary: ${exportProgressRef.current.processedRows} rows processed, ${exportProgressRef.current.skippedRows} skipped`,
                        )
                    } else if (exportProgressRef.current.processedRows % 10 === 0) {
                        const elapsed = Date.now() - exportProgressRef.current.startTime
                        const rate = exportProgressRef.current.processedRows / (elapsed / 1000)
                        console.info(
                            `[EvalRunDetails2][Export] Progress: ${exportProgressRef.current.processedRows} rows processed (${rate.toFixed(1)} rows/sec)`,
                        )
                    }
                }

                if (!row || row.__isSkeleton) {
                    if (columnIndex === 0) {
                        exportProgressRef.current.skippedRows++
                    }
                    return EXPORT_RESOLVE_SKIP
                }

                // Return the run type value
                return row.isComparisonRow ? `Compare ${row.compareIndex}` : "Main"
            }

            // Handle synthetic "__run_id__" column for comparison exports
            if (columnKeyStr === "__run_id__") {
                if (!row || row.__isSkeleton) {
                    return EXPORT_RESOLVE_SKIP
                }
                // Return the run ID
                return row.runId ?? ""
            }

            // Track first real data column for progress (if not already tracked by __run_type__)
            if (!hasCompareRuns && columnIndex === 0) {
                exportProgressRef.current.processedRows++

                if (rowIndex === totalExportRowsRef.current - 1) {
                    const elapsed = Date.now() - exportProgressRef.current.startTime
                    const exportedCount =
                        exportProgressRef.current.processedRows -
                        exportProgressRef.current.skippedRows
                    console.info(
                        `[EvalRunDetails2][Export] ✓ Export complete - ${exportedCount} scenarios exported in ${(elapsed / 1000).toFixed(1)}s`,
                    )
                    console.info(
                        `[EvalRunDetails2][Export] Summary: ${exportProgressRef.current.processedRows} rows processed, ${exportProgressRef.current.skippedRows} skipped`,
                    )
                } else if (exportProgressRef.current.processedRows % 10 === 0) {
                    const elapsed = Date.now() - exportProgressRef.current.startTime
                    const rate = exportProgressRef.current.processedRows / (elapsed / 1000)
                    console.info(
                        `[EvalRunDetails2][Export] Progress: ${exportProgressRef.current.processedRows} rows processed (${rate.toFixed(1)} rows/sec)`,
                    )
                }
            }

            if (!row || row.__isSkeleton) {
                if (!hasCompareRuns && columnIndex === 0) {
                    exportProgressRef.current.skippedRows++
                }
                return EXPORT_RESOLVE_SKIP
            }

            // Skip other internal columns (column visibility, selection, etc.)
            if (columnKeyStr.startsWith("__")) {
                return EXPORT_RESOLVE_SKIP
            }

            // Look up the actual EvaluationTableColumn from our map
            const tableColumn = columnLookupMap.get(columnKeyStr)
            if (!tableColumn) {
                console.warn(`[EvalRunDetails2][Export] Column not found in lookup map:`, {
                    columnKey: columnKeyStr,
                    hasCompareRuns,
                    columnIndex,
                })
                return EXPORT_RESOLVE_SKIP
            }

            // Build export metadata for this column
            const metadata: ScenarioColumnExportMetadata = buildExportMetadata(tableColumn)

            // Resolve the actual value using our column resolver
            const resolvedValue = await resolveScenarioColumnValue(
                store,
                row,
                tableColumn,
                metadata,
            )

            return resolvedValue
        },
        [store, columnLookupMap, compareSlots],
    )

    // Export column label resolver - formats column headers for CSV
    const resolveColumnLabel = useCallback(
        ({column, columnIndex}: TableExportColumnContext<PreviewTableRow>) => {
            // The column from the table is an Ant Design column with a 'key' property
            const columnKey = (column as any)?.key

            if (!columnKey) {
                console.warn("[EvalRunDetails2][Export] Column label: no key", {column})
                return undefined
            }

            const columnKeyStr = String(columnKey)

            // Handle synthetic "__run_type__" column
            if (columnKeyStr === "__run_type__") {
                return "Run"
            }

            // Handle synthetic "__run_id__" column
            if (columnKeyStr === "__run_id__") {
                return "Run ID"
            }

            // Look up the actual EvaluationTableColumn from our map
            const tableColumn = columnLookupMap.get(columnKeyStr)
            if (!tableColumn) {
                console.warn("[EvalRunDetails2][Export] Column label: not found in lookup map", {
                    columnKey: columnKeyStr,
                })
                return undefined
            }

            const metadata: ScenarioColumnExportMetadata = buildExportMetadata(tableColumn)
            const resolvedLabel = resolveScenarioColumnLabel(tableColumn, metadata, groupMap)

            return resolvedLabel
        },
        [groupMap, columnLookupMap],
    )

    // Track if we're currently loading pages to prevent stuck pagination
    const isLoadingPagesRef = useRef(false)

    // Load all pages before export
    const loadAllPagesBeforeExport = useCallback(
        async (rows: PreviewTableRow[]) => {
            if (isLoadingPagesRef.current) {
                console.warn("[EvalRunDetails2][Export] Already loading pages, skipping")
                return
            }

            isLoadingPagesRef.current = true

            // Reset progress tracking
            exportProgressRef.current = {
                processedRows: 0,
                skippedRows: 0,
                totalColumns: 0,
                startTime: Date.now(),
            }

            // Count non-skeleton, non-comparison rows that will actually be exported
            const exportableRows = rows.filter((r) => !r.__isSkeleton && !r.isComparisonRow)
            totalExportRowsRef.current = rows.length // Total including skipped rows
            console.info(
                `[EvalRunDetails2][Export] Starting export - ${exportableRows.length} scenarios ready in memory`,
            )
            message.info(`Loading all scenarios... (${exportableRows.length} currently loaded)`)

            try {
                /**
                 * Direct page loading function that bypasses the LOW_PRIORITY scheduler
                 * This directly manipulates the pagesAtom and waits for query atoms to resolve
                 */
                const loadAllPagesDirectly = async (scopeId: string | null) => {
                    const maxPages = 200 // Safety limit
                    let pageLoadCount = 0

                    const pagesAtom = evaluationPreviewTableStore.atoms.pagesAtomFamily({
                        scopeId,
                        pageSize,
                    })
                    const paginationInfoAtom =
                        evaluationPreviewTableStore.atoms.paginationInfoAtomFamily({
                            scopeId,
                            pageSize,
                        })
                    const combinedRowsAtom =
                        evaluationPreviewTableStore.atoms.combinedRowsAtomFamily({
                            scopeId,
                            pageSize,
                        })

                    while (pageLoadCount < maxPages) {
                        // Get current pagination info
                        const paginationInfo = store.get(paginationInfoAtom)

                        if (!paginationInfo.hasMore) {
                            break
                        }

                        const nextCursor = paginationInfo.nextCursor
                        if (!nextCursor) {
                            console.warn(
                                `[EvalRunDetails2][Export] No nextCursor available, stopping`,
                            )
                            break
                        }

                        const nextOffset =
                            paginationInfo.nextOffset ?? (pageLoadCount + 1) * pageSize
                        const nextWindowing = paginationInfo.nextWindowing ?? {
                            next: nextCursor,
                            order: "ascending" as const,
                            limit: pageSize,
                            stop: null,
                        }

                        // Read current row count from store before adding page
                        const beforeRows = store.get(combinedRowsAtom)
                        const beforeCount = beforeRows.filter((r: any) => !r.__isSkeleton).length

                        console.info(
                            `[EvalRunDetails2][Export] Loading page ${pageLoadCount + 1}:`,
                            {
                                nextCursor,
                                nextOffset,
                                currentScenarios: beforeCount,
                            },
                        )

                        // Directly append page to pages array (bypass scheduler)
                        store.set(pagesAtom, (prev) => {
                            // Check if this page already exists to avoid duplicates
                            const pageExists = prev.pages.some(
                                (page) =>
                                    page.cursor === nextCursor &&
                                    (page.windowing?.next ?? null) ===
                                        (nextWindowing?.next ?? nextCursor),
                            )

                            if (pageExists) {
                                return prev
                            }

                            return {
                                pages: [
                                    ...prev.pages,
                                    {
                                        offset: nextOffset,
                                        limit: pageSize,
                                        cursor: nextCursor,
                                        windowing: nextWindowing,
                                    },
                                ],
                            }
                        })

                        // Wait for this page's query atom to finish loading
                        const queryAtom = evaluationPreviewTableStore.atoms.rowsQueryAtomFamily({
                            scopeId,
                            cursor: nextCursor,
                            limit: pageSize,
                            offset: nextOffset,
                            windowing: nextWindowing,
                        })

                        // Subscribe to query atom and wait for it to finish loading
                        await new Promise<void>((resolve) => {
                            const timeout = setTimeout(() => {
                                unsubscribe()
                                console.warn(
                                    `[EvalRunDetails2][Export] Page ${pageLoadCount + 1} query timeout`,
                                )
                                resolve()
                            }, 10000) // 10 second timeout per page

                            const unsubscribe = store.sub(queryAtom, () => {
                                const queryState = store.get(queryAtom)
                                if (!queryState.isFetching && !queryState.isPending) {
                                    clearTimeout(timeout)
                                    unsubscribe()
                                    resolve()
                                }
                            })

                            // Check immediately in case it's already loaded
                            const immediateCheck = store.get(queryAtom)
                            if (!immediateCheck.isFetching && !immediateCheck.isPending) {
                                clearTimeout(timeout)
                                unsubscribe()
                                resolve()
                            }
                        })

                        // Read row count from store after page is loaded
                        const afterRows = store.get(combinedRowsAtom)
                        const afterCount = afterRows.filter((r: any) => !r.__isSkeleton).length

                        console.info(
                            `[EvalRunDetails2][Export] Page ${pageLoadCount + 1} loaded:`,
                            {
                                beforeScenarios: beforeCount,
                                afterScenarios: afterCount,
                                newScenarios: afterCount - beforeCount,
                            },
                        )

                        pageLoadCount++
                    }

                    // Return final count from store, not React state
                    const finalRows = store.get(combinedRowsAtom)
                    const finalCount = finalRows.filter((r: any) => !r.__isSkeleton).length

                    return {pageLoadCount, scenarioCount: finalCount}
                }

                // Load all pages for the base run
                const baseResult = await loadAllPagesDirectly(runId)

                // Load all pages for comparison runs
                if (compareSlots.some((slot) => slot)) {
                    console.info(
                        `[EvalRunDetails2][Export] Loading ${compareSlots.filter(Boolean).length} comparison run(s)`,
                    )
                }

                for (const compareRunId of compareSlots) {
                    if (!compareRunId) continue
                    await loadAllPagesDirectly(compareRunId)
                }

                message.info(`Generating CSV file with ${baseResult.scenarioCount} scenarios...`)

                // Return the updated merged rows from the store
                const baseRowsAtom = evaluationPreviewTableStore.atoms.combinedRowsAtomFamily({
                    scopeId: runId,
                    pageSize,
                })
                const updatedBaseRows = store.get(baseRowsAtom)

                // Build merged rows with comparison data (same logic as mergedRows useMemo)
                if (!compareSlots.some(Boolean)) {
                    return updatedBaseRows.map((row) => ({
                        ...row,
                        baseScenarioId: row.scenarioId ?? row.id,
                        compareIndex: 0,
                        isComparisonRow: false,
                    }))
                }

                const baseRows = updatedBaseRows.map((row) => ({
                    ...row,
                    baseScenarioId: row.scenarioId ?? row.id,
                    compareIndex: 0,
                    isComparisonRow: false,
                }))

                const compareData = compareSlots.map((slotRunId, idx) => {
                    if (!slotRunId) return null

                    const compareRowsAtom =
                        evaluationPreviewTableStore.atoms.combinedRowsAtomFamily({
                            scopeId: slotRunId,
                            pageSize,
                        })
                    const slotRows = store.get(compareRowsAtom)

                    const mapByTestcase = new Map<string, PreviewTableRow>()
                    const mapByIndex = new Map<number, PreviewTableRow>()

                    slotRows.forEach((row) => {
                        if (!row || row.__isSkeleton) return
                        if (row.testcaseId) {
                            mapByTestcase.set(row.testcaseId, row)
                        }
                        if (typeof row.scenarioIndex === "number") {
                            mapByIndex.set(row.scenarioIndex, row)
                        }
                    })

                    return {
                        runId: slotRunId,
                        rows: slotRows,
                        mapByTestcase,
                        mapByIndex,
                        compareIndex: idx + 1,
                    }
                })

                const result: PreviewTableRow[] = []

                baseRows.forEach((baseRow) => {
                    result.push(baseRow)
                    if (baseRow.__isSkeleton) {
                        return
                    }

                    const baseTestcaseId = baseRow.testcaseId
                    const baseScenarioIndex = baseRow.scenarioIndex
                    const baseScenarioId = baseRow.scenarioId ?? baseRow.id

                    compareData.forEach((data) => {
                        if (!data) return
                        const {mapByTestcase, mapByIndex, compareIndex} = data
                        const counterpart =
                            (baseTestcaseId ? mapByTestcase.get(baseTestcaseId) : undefined) ||
                            mapByIndex.get(baseScenarioIndex)

                        if (counterpart) {
                            result.push({
                                ...counterpart,
                                baseScenarioId,
                                compareIndex,
                                isComparisonRow: true,
                            })
                        }
                    })
                })

                return result
            } finally {
                isLoadingPagesRef.current = false
            }
        },
        [basePagination, comparePaginations, compareSlots, pageSize, runId, store],
    )

    // Export options passed to the table
    const exportOptions = useMemo(
        () => ({
            resolveValue: exportResolveValue,
            resolveColumnLabel,
            filename: `${runDisplayName || runId}-scenarios.csv`,
            beforeExport: loadAllPagesBeforeExport,
        }),
        [exportResolveValue, resolveColumnLabel, runId, runDisplayName, loadAllPagesBeforeExport],
    )

    return (
        <section className="bg-zinc-1 w-full h-full overflow-scroll flex flex-col px-4 pt-2">
            <div className="w-full grow min-h-0 overflow-scroll">
                <InfiniteVirtualTableFeatureShell<TableRowData>
                    datasetStore={evaluationPreviewDatasetStore}
                    tableScope={tableScope}
                    columns={columnsWithSyntheticColumns}
                    rowKey={(record) => record.key}
                    tableClassName={clsx(
                        "agenta-scenario-table",
                        `agenta-scenario-table--row-${rowHeight}`,
                    )}
                    resizableColumns
                    useSettingsDropdown
                    settingsDropdownMenuItems={rowHeightMenuItems}
                    columnVisibilityMenuRenderer={(
                        controls,
                        close,
                        {scopeId, onExport, isExporting},
                    ) => (
                        <ScenarioColumnVisibilityPopoverContent
                            controls={controls}
                            onClose={close}
                            scopeId={scopeId}
                            runId={runId}
                            evaluationType={evaluationType}
                            onExport={onExport}
                            isExporting={isExporting}
                        />
                    )}
                    pagination={paginationForShell}
                    exportOptions={exportOptions}
                    tableProps={{
                        rowClassName: (record) =>
                            clsx("scenario-row", {
                                "scenario-row--comparison": record.isComparisonRow,
                            }),
                        size: "small",
                        sticky: true,
                        virtual: true,
                        bordered: true,
                        tableLayout: "fixed",
                        onRow: (record) => {
                            // Determine background color: comparison color takes precedence, then timestamp grouping
                            let backgroundColor: string | undefined
                            if (record.compareIndex) {
                                backgroundColor = getComparisonColor(record.compareIndex)
                            } else if (
                                evaluationType === "online" &&
                                record.timestamp &&
                                timestampColorMap.has(record.timestamp)
                            ) {
                                backgroundColor = timestampColorMap.get(record.timestamp)
                            }

                            return {
                                onClick: (event) => {
                                    const target = event.target as HTMLElement | null
                                    if (target?.closest("[data-ivt-stop-row-click]")) return
                                    handleRowClick(record as TableRowData)
                                },
                                className: clsx({
                                    "comparison-row": record.isComparisonRow,
                                }),
                                style: backgroundColor ? {backgroundColor} : undefined,
                            }
                        },
                    }}
                />
            </div>
            <VirtualizedScenarioTableAnnotateDrawer runId={runId} />
        </section>
    )
}

export default EvalRunDetailsTable
