import {type Key, useMemo} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {Alert} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue, useStore} from "jotai"

import {getObservabilityColumns} from "@/oss/components/pages/observability/assets/getObservabilityColumns"
import {TraceSpanNode} from "@/oss/services/tracing/types"

import {collectEvaluatorSlugs, queryTracePreviewAtomFamily} from "./queryTracePreviewAtoms"

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

/**
 * Read-only preview of the traces matching a query's filter, rendered with the
 * exact observability table (columns + InfiniteVirtualTable shell) so it stays
 * visually identical to the Observability page — including the annotation
 * (evaluator-metrics) columns, which are loaded by fetching annotations for the
 * matching traces and merging them with the same `attachAnnotationsToTraces`
 * helper observability uses. Fetches a single page; this is a peek, not a browser.
 */
const QueryTracePreview = ({projectId, filtering, limit = 50}: QueryTracePreviewProps) => {
    const store = useStore()
    const previewAtom = useMemo(
        () => queryTracePreviewAtomFamily({projectId, filtering, limit}),
        [filtering, limit, projectId],
    )
    const {traces: sourceTraces, isPending, isError} = useAtomValue(previewAtom)
    const traces = sourceTraces as PreviewRow[]
    const evaluatorSlugs = useMemo(() => collectEvaluatorSlugs(traces), [traces])

    const columns = useMemo(
        () => getObservabilityColumns({evaluatorSlugs}) as unknown as ColumnsType<PreviewRow>,
        [evaluatorSlugs],
    )

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
                isFetching: isPending,
                totalCount: traces.length,
            },
        }),
        [isPending, traces],
    )

    if (isError) {
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
                loading: isPending,
                sticky: true,
                size: "small",
            }}
        />
    )
}

export default QueryTracePreview
