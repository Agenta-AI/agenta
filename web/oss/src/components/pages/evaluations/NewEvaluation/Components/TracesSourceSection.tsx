import {type Key, useMemo} from "react"

import {matchingTracesQueryAtomFamily} from "@agenta/entities/query"
import type {TraceSpanNode} from "@agenta/entities/trace"
import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {Alert, Empty} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue, useStore} from "jotai"

import {getObservabilityColumns} from "@/oss/components/pages/observability/assets/getObservabilityColumns"

import {
    buildTraceIdFilter,
    rootKeysForTraceIds,
    selectedKeysToTraceIds,
} from "../evalSteps/sourceHelpers"
import type {EvalStepSectionProps} from "../evalSteps/types"

type TraceRow = TraceSpanNode & {key: Key; [extra: string]: unknown}

interface TraceMetricNode {
    aggregatedEvaluatorMetrics?: Record<string, unknown> | null
    children?: TraceMetricNode[] | null
}

const collectEvaluatorSlugs = (nodes: TraceMetricNode[]) => {
    const slugs = new Set<string>()
    const visit = (node: TraceMetricNode) => {
        Object.keys(node.aggregatedEvaluatorMetrics ?? {}).forEach((slug) => slugs.add(slug))
        node.children?.forEach(visit)
    }
    nodes.forEach(visit)
    return Array.from(slugs)
}

const TracesSourceSection = ({value, slot, context}: EvalStepSectionProps<string[]>) => {
    const store = useStore()
    // The preset defines available rows; value tracks the current evaluation selection.
    const sourceTraceIds = slot.kind === "traces" && slot.preset !== undefined ? slot.preset : value
    const queryAtom = useMemo(
        () =>
            matchingTracesQueryAtomFamily({
                projectId: context.projectId,
                filtering: buildTraceIdFilter(sourceTraceIds),
                limit: sourceTraceIds.length,
            }),
        [context.projectId, sourceTraceIds],
    )
    const {data: sourceTraces = [], isPending, isError} = useAtomValue(queryAtom)
    const traces = useMemo(
        () =>
            sourceTraces.map((row) => ({
                ...row,
                key: row.span_id || row.key || row.trace_id,
            })) as TraceRow[],
        [sourceTraces],
    )

    const evaluatorSlugs = useMemo(
        () => collectEvaluatorSlugs(traces as unknown as TraceMetricNode[]),
        [traces],
    )
    const columns = useMemo(
        () => getObservabilityColumns({evaluatorSlugs}) as unknown as ColumnsType<TraceRow>,
        [evaluatorSlugs],
    )
    const selectedRowKeys = useMemo(() => rootKeysForTraceIds(traces, value), [traces, value])
    const rootKeys = useMemo(
        () => new Set(traces.map((trace) => String(trace.span_id || trace.key))),
        [traces],
    )
    const tableScope: TableScopeConfig = useMemo(
        () => ({
            scopeId: "evaluation-traces-source",
            pageSize: Math.max(sourceTraceIds.length, 1),
            enableInfiniteScroll: false,
        }),
        [sourceTraceIds.length],
    )
    const pagination: TableFeaturePagination<TraceRow> = useMemo(
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

    if (!sourceTraceIds.length) {
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No traces selected" />
    }
    if (!context.projectId || isError) {
        return <Alert type="error" showIcon message="Couldn't load selected traces" />
    }

    return (
        <InfiniteVirtualTableFeatureShell<TraceRow>
            tableScope={tableScope}
            columns={columns}
            rowKey={(record) => record.span_id || record.key}
            pagination={pagination}
            resizableColumns
            enableExport={false}
            useSettingsDropdown={false}
            store={store}
            className="h-full min-h-0 [&_.ant-table-thead_tr:nth-child(2)]:hidden"
            rowSelection={{
                type: "checkbox",
                selectedRowKeys,
                getCheckboxProps: (record) => ({
                    disabled: !rootKeys.has(String(record.span_id || record.key)),
                }),
                onChange: (keys) => {
                    context.setStepValue("traces", selectedKeysToTraceIds(traces, keys))
                },
            }}
            tableProps={{
                bordered: true,
                loading: isPending,
                sticky: true,
                size: "small",
            }}
        />
    )
}

export default TracesSourceSection
