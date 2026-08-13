import {useCallback, useRef, useState} from "react"

import {exportMatchingTraces} from "@agenta/entities/trace/etl"
import {
    buildTraceQueryParams,
    createAdaptiveTracePageFetcher,
    createExportWriter,
    createTraceObject,
    DEFAULT_TRACE_EXPORT_HEADERS,
    PICKER_CANCELLED,
    useObservability,
} from "@agenta/observability"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {isColumnGroupDef, type ColumnDefs} from "@agenta/ui/table"
import {useAtomValue} from "jotai"
import Papa from "papaparse"

import type {TraceRow} from "../columns/getObservabilityColumns"

/**
 * CSV export for the traces table, shared by /m and web/oss.
 *
 * Every piece this needs — the query params, the adaptive page fetcher, the writer, the row
 * mapper — already lived in @agenta/observability; only the app id and filename came from
 * web/oss app state, so those are injected and the rest moves here unchanged.
 */
/** Leaf titles only: a group's own title has no row data behind it. */
const flattenLeafTitles = <T>(columns: ColumnDefs<T>): string[] =>
    columns.flatMap((column) =>
        isColumnGroupDef(column)
            ? flattenLeafTitles(column.children)
            : typeof column.title === "string"
              ? [column.title]
              : [],
    )

export interface UseTracesExportOptions {
    columns: ColumnDefs<TraceRow>
    canExportData?: boolean
    /** web/oss reads its current app; /m has none, so both supply their own. */
    resolveAppId?: () => string
    resolveFilename?: () => string
}

export const useTracesExport = ({
    columns,
    canExportData = true,
    resolveAppId,
    resolveFilename,
}: UseTracesExportOptions) => {
    const {traces, filters, sort, traceTabs} = useObservability()
    const projectId = useAtomValue(projectIdAtom)
    const [isExporting, setIsExporting] = useState(false)
    const exportAbortRef = useRef<AbortController | null>(null)

    const onExport = useCallback(async () => {
        const exportKey = "observability-export"

        if (!canExportData) return
        if (!traces.length) return

        const appId = resolveAppId?.() ?? ""
        const filename = resolveFilename?.() ?? "observability.csv"

        const {params, hasAnnotationConditions, hasAnnotationOperator, isHasAnnotationSelected} =
            buildTraceQueryParams(filters, sort, traceTabs, undefined)

        // Papa reads row[field] per header, and createTraceObject emits exactly the
        // DEFAULT_TRACE_EXPORT_HEADERS keys. A header it cannot fill — the "Evaluators" group,
        // or any evaluator column, whose metrics live in annotation atoms rather than on the
        // row — wrote an empty column. So headers come from what the mapper actually emits,
        // narrowed to the columns still visible, in the mapper's order.
        const visibleTitles = new Set(
            flattenLeafTitles(columns).map((title) => (title === "ID" ? "Trace ID" : title)),
        )
        const selected = DEFAULT_TRACE_EXPORT_HEADERS.filter((header) => visibleTitles.has(header))
        const csvHeaders = selected.length > 0 ? selected : DEFAULT_TRACE_EXPORT_HEADERS

        // Open the native file picker BEFORE starting the scan when the
        // browser supports `showSaveFilePicker` (Chromium). User-cancel of
        // the picker bails before any request is fired. On Safari / Firefox
        // this falls back to the buffered Blob path — same UX as before.
        // Outside the try below, so a rejection here would escape into a void-ed call with no
        // feedback: the caller fires this with `void onExport()`.
        let writer: Awaited<ReturnType<typeof createExportWriter>>
        try {
            writer = await createExportWriter({filename, headers: csvHeaders})
        } catch (error) {
            console.error(error)
            message.error({content: "Could not start the export.", key: exportKey})
            return
        }
        if (writer === PICKER_CANCELLED) return

        const controller = new AbortController()
        exportAbortRef.current = controller

        setIsExporting(true)
        message.loading({
            content: "Preparing export",
            key: exportKey,
            duration: 0,
        })

        // Last reported row count — kept so a rate-limit pause can keep
        // showing progress while the scan is paused for backoff.
        let lastRowCount = 0

        // Shared adaptive fetcher: bucket-aware proactive pacing + 429
        // retry as the safety net. The queue scan uses the same helper —
        // both pipelines now pace from the live bucket signal instead of
        // an arbitrary constant.
        const fetchPage = createAdaptiveTracePageFetcher({
            params,
            appId,
            projectId: projectId ?? "",
            isHasAnnotationSelected,
            hasAnnotationConditions,
            hasAnnotationOperator,
            signal: controller.signal,
            onRateLimitPause: (delayMs) => {
                message.loading({
                    content:
                        `Rate limited — pausing for ${Math.ceil(delayMs / 1000)}s` +
                        ` (exported ${lastRowCount.toLocaleString()} rows so far)`,
                    key: exportKey,
                    duration: 0,
                })
            },
        })

        try {
            const {rowCount, limitReached} = await exportMatchingTraces({
                fetchPage,
                flushBatch: async (batch) => {
                    const rows = batch.map(createTraceObject)
                    // The writer streams to disk on Chromium and buffers in
                    // memory on Safari / Firefox — at this seam they look
                    // identical to the pipeline, so memory stays bounded by
                    // one batch on supported browsers.
                    await writer.write(
                        "\r\n" +
                            Papa.unparse(
                                {fields: csvHeaders, data: rows},
                                {header: false, escapeFormulae: true},
                            ),
                    )
                },
                signal: controller.signal,
                // All pacing is done inside `fetchPage` based on the live
                // bucket state — disable the source-level fixed delay.
                pageDelayMs: 0,
                onProgress: ({rows}) => {
                    lastRowCount = rows
                    message.loading({
                        content: `Exporting ${rows.toLocaleString()} rows`,
                        key: exportKey,
                        duration: 0,
                    })
                },
            })

            // `finalize(0)` aborts the streaming writable so no header-only
            // file is left on disk, and is a no-op on the buffered path.
            await writer.finalize(rowCount)

            if (!rowCount) {
                message.info({
                    content: "No traces to export",
                    key: exportKey,
                })
                return
            }

            if (limitReached) {
                message.warning({
                    content: `Export limit reached. Downloaded first ${rowCount.toLocaleString()} rows.`,
                    key: exportKey,
                    duration: 5,
                })
            } else {
                message.success({
                    content: `Exported ${rowCount.toLocaleString()} rows`,
                    key: exportKey,
                })
            }
        } catch (error) {
            // Discard any partial bytes already streamed to disk / buffered.
            await writer.abort().catch(() => {})

            if ((error as Error).name === "AbortError") {
                message.info({
                    content: "Export cancelled",
                    key: exportKey,
                })

                return
            }

            console.error("Export error:", error)
            message.error({
                content: "Export failed",
                key: exportKey,
            })
        } finally {
            exportAbortRef.current = null
            setIsExporting(false)
        }
    }, [
        canExportData,
        columns,
        filters,
        sort,
        traceTabs,
        traces,
        projectId,
        resolveAppId,
        resolveFilename,
    ])

    const handleExportClick = useCallback(() => {
        if (isExporting) {
            exportAbortRef.current?.abort()
            return
        }
        void onExport()
    }, [isExporting, onExport])

    return {onExport: handleExportClick, isExporting}
}

export default useTracesExport
