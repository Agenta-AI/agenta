import {type Key, useEffect, useMemo, useState} from "react"

import {queryMatchingTraces} from "@agenta/entities/query"
import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {Alert} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useStore} from "jotai"

import {getObservabilityColumns} from "@/oss/components/pages/observability/assets/getObservabilityColumns"
import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface QueryTracePreviewProps {
    projectId?: string | null
    /**
     * Structured tracing filter payload (`toFilteringPayload(filters)`).
     * `undefined` matches every trace; the parent decides whether to render the
     * preview at all in that case.
     */
    filtering: unknown
    /** Max traces to fetch for the preview (no pagination — this is a peek). */
    limit?: number
}

/**
 * The InfiniteVirtualTable row constraint (`InfiniteTableRowBase`) requires a
 * required `key` and an index signature, which the observability `TraceSpanNode`
 * doesn't declare. ObservabilityTable lives with the resulting tsc mismatch;
 * here we widen to a constraint-satisfying row so this new file stays clean.
 */
type PreviewRow = TraceSpanNode & {key: Key; [extra: string]: unknown}

// Stable empty array so the observability columns memo never re-creates and the
// drawer preview never shows the evaluator-metrics column group.
const NO_EVALUATORS: string[] = []

/**
 * Read-only preview of the traces matching a query's filter, rendered with the
 * exact observability table (columns + InfiniteVirtualTable shell) so it stays
 * visually identical to the Observability page. Fetches a single page via the
 * query entity's `queryMatchingTraces`; this is a peek, not a paginated browser.
 */
const QueryTracePreview = ({projectId, filtering, limit = 50}: QueryTracePreviewProps) => {
    const store = useStore()
    const columns = useMemo(
        () =>
            getObservabilityColumns({
                evaluatorSlugs: NO_EVALUATORS,
            }) as unknown as ColumnsType<PreviewRow>,
        [],
    )

    const [traces, setTraces] = useState<PreviewRow[]>([])
    const [status, setStatus] = useState<"loading" | "done" | "error">("loading")

    useEffect(() => {
        if (!projectId) return
        let cancelled = false
        setStatus("loading")
        queryMatchingTraces({projectId, filtering, limit})
            .then((result) => {
                if (cancelled) return
                // Entity TraceSpanNode is structurally the OSS node the observability
                // columns render against; the cast bridges the two package types.
                setTraces(result as unknown as PreviewRow[])
                setStatus("done")
            })
            .catch(() => {
                if (cancelled) return
                setTraces([])
                setStatus("error")
            })
        return () => {
            cancelled = true
        }
    }, [projectId, filtering, limit])

    const tableScope: TableScopeConfig = useMemo(
        () => ({scopeId: "query-trace-preview", pageSize: limit, enableInfiniteScroll: false}),
        [limit],
    )

    const pagination: TableFeaturePagination<PreviewRow> = useMemo(
        () => ({
            rows: traces,
            loadNextPage: () => undefined,
            resetPages: () => undefined,
            paginationInfo: {
                hasMore: false,
                nextCursor: null,
                nextOffset: null,
                isFetching: status === "loading",
                totalCount: traces.length,
            },
        }),
        [traces, status],
    )

    if (status === "error") {
        return (
            <Alert
                type="error"
                showIcon
                message="Couldn't load matching traces"
                className="text-xs"
            />
        )
    }

    return (
        <InfiniteVirtualTableFeatureShell<PreviewRow>
            tableScope={tableScope}
            columns={columns}
            rowKey={(record) => record.span_id || record.key}
            pagination={pagination}
            resizableColumns
            enableExport={false}
            useSettingsDropdown={false}
            store={store}
            className="flex-1 min-h-0 [&_.ant-table-thead_tr:nth-child(2)]:hidden"
            tableProps={{
                bordered: true,
                loading: status === "loading",
                sticky: true,
                size: "small",
            }}
        />
    )
}

export default QueryTracePreview
