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
import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {queryAllAnnotations} from "@/oss/services/annotations/api"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {getOrgValues} from "@/oss/state/org"

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

interface TreeNode {
    invocationIds?: {trace_id?: string; span_id?: string} | null
    aggregatedEvaluatorMetrics?: Record<string, unknown> | null
    children?: TreeNode[] | null
}

/**
 * Walk the trace tree for the `{trace_id, span_id}` pairs that key annotation
 * lookups. Mirrors `collectInvocationLinks` in
 * `state/newObservability/atoms/queries.ts`.
 */
const collectInvocationLinks = (nodes: TreeNode[]) => {
    const links: {trace_id: string; span_id: string}[] = []
    const seen = new Set<string>()
    const visit = (node?: TreeNode) => {
        if (!node) return
        const ids = node.invocationIds
        if (ids?.trace_id && ids?.span_id) {
            const key = `${ids.trace_id}:${ids.span_id}`
            if (!seen.has(key)) {
                seen.add(key)
                links.push({trace_id: ids.trace_id, span_id: ids.span_id})
            }
        }
        node.children?.forEach(visit)
    }
    nodes.forEach(visit)
    return links
}

/**
 * Gather evaluator slugs from each node's `aggregatedEvaluatorMetrics` so
 * `getObservabilityColumns` renders the matching annotation columns. Mirrors
 * `collectEvaluatorSlugsFromTraces` in `ObservabilityTable`.
 */
const collectEvaluatorSlugs = (nodes: TreeNode[]) => {
    const slugs = new Set<string>()
    const visit = (node?: TreeNode) => {
        if (!node) return
        const metrics = node.aggregatedEvaluatorMetrics
        if (metrics && typeof metrics === "object") {
            Object.keys(metrics).forEach((slug) => slug && slugs.add(slug))
        }
        node.children?.forEach(visit)
    }
    nodes.forEach(visit)
    return Array.from(slugs)
}

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

    const [traces, setTraces] = useState<PreviewRow[]>([])
    const [evaluatorSlugs, setEvaluatorSlugs] = useState<string[]>([])
    const [status, setStatus] = useState<"loading" | "done" | "error">("loading")

    const columns = useMemo(
        () => getObservabilityColumns({evaluatorSlugs}) as unknown as ColumnsType<PreviewRow>,
        [evaluatorSlugs],
    )

    useEffect(() => {
        if (!projectId) return
        let cancelled = false
        setStatus("loading")
        ;(async () => {
            try {
                const rawTraces = await queryMatchingTraces({projectId, filtering, limit})
                const links = collectInvocationLinks(rawTraces as unknown as TreeNode[])
                let annotations: AnnotationDto[] = []
                if (links.length) {
                    const {selectedOrg} = getOrgValues()
                    const members = selectedOrg?.default_workspace?.members || []
                    const res = await queryAllAnnotations({annotation: {links}})
                    annotations =
                        res.annotations?.map((a) =>
                            transformApiData<AnnotationDto>({data: a, members}),
                        ) ?? []
                }
                // Same merge observability uses — attaches `annotations` and
                // `aggregatedEvaluatorMetrics` onto each matching node.
                const enriched = attachAnnotationsToTraces(
                    rawTraces as never[],
                    annotations,
                ) as unknown as PreviewRow[]
                if (cancelled) return
                setTraces(enriched)
                setEvaluatorSlugs(collectEvaluatorSlugs(enriched as unknown as TreeNode[]))
                setStatus("done")
            } catch {
                if (cancelled) return
                setTraces([])
                setEvaluatorSlugs([])
                setStatus("error")
            }
        })()
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
