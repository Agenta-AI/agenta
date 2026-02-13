import {memo, useCallback, useMemo} from "react"

import {
    sortSpansByStartTime,
    transformTracesResponseToTree,
    traceEntityAtomFamily,
    type TraceSpan,
    type TraceSpanNode,
    StatusCodeEnum,
} from "@agenta/entities/trace"
import {PlusCircle, Timer, TreeView} from "@phosphor-icons/react"
import {Button, Space, Tag} from "antd"
import clsx from "clsx"
import {getDefaultStore, useAtomValue} from "jotai"

import StatusRenderer from "@/oss/components/pages/observability/components/StatusRenderer"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {resolvePath} from "@/oss/lib/traces/traceUtils"
import {useQueryParamState} from "@/oss/state/appState"

// Map StatusCodeEnum values to match legacy StatusCode usage
const StatusCode = {
    STATUS_CODE_OK: StatusCodeEnum.enum.STATUS_CODE_OK,
    STATUS_CODE_ERROR: StatusCodeEnum.enum.STATUS_CODE_ERROR,
    STATUS_CODE_UNSET: StatusCodeEnum.enum.STATUS_CODE_UNSET,
}

// Use the global Jotai store to ensure the TraceDrawer (rendered in AppGlobalWrappers)
// receives the state updates, even when this component is inside an isolated store context
const globalStore = getDefaultStore()

interface TreeNode {
    metrics?: {
        acc?: {
            duration?: {total?: number}
            tokens?: {total?: number; prompt?: number; completion?: number}
            costs?: {total?: number}
        }
        unit?: {
            duration?: {total?: number}
            tokens?: {total?: number; prompt?: number; completion?: number}
            costs?: {total?: number}
        }
    }
    status?: string
}

interface SharedGenerationResultUtilsProps {
    /** Trace ID for fetching metrics from server */
    traceId?: string | null
    /** Inline tree data with metrics (alternative to traceId) */
    tree?: {
        nodes?: TreeNode[]
        trace_id?: string
    } | null
    className?: string
    showStatus?: boolean
}

const numeric = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return undefined
}

const buildSpanList = (data: any): TraceSpan[] => {
    console.log("[SharedGenerationResultUtils] buildSpanList input:", {
        hasData: !!data,
        dataType: typeof data,
        hasSpans: !!data?.spans,
        hasTraces: !!data?.traces,
        dataKeys: data ? Object.keys(data) : [],
    })

    if (!data) return []

    if (Array.isArray(data?.spans)) {
        console.log("[SharedGenerationResultUtils] Found spans array:", data.spans.length)
        return data.spans as TraceSpan[]
    }

    if (data?.traces && typeof data.traces === "object") {
        const traces = Object.values(data.traces ?? {}) as any[]
        const spans: TraceSpan[] = []
        console.log("[SharedGenerationResultUtils] Found traces object:", {
            traceCount: traces.length,
            traceKeys: Object.keys(data.traces),
        })
        traces.forEach((entry, idx) => {
            const record = entry?.spans
            console.log(`[SharedGenerationResultUtils] Trace ${idx}:`, {
                hasSpans: !!record,
                spansType: typeof record,
                spanCount: record ? Object.keys(record).length : 0,
            })
            if (record && typeof record === "object") {
                spans.push(...(Object.values(record) as TraceSpan[]))
            }
        })
        console.log("[SharedGenerationResultUtils] Total spans extracted:", spans.length)
        return spans
    }

    console.log("[SharedGenerationResultUtils] No spans or traces found")
    return []
}

const extractPrimarySpan = (response: any, traceId?: string | null): TraceSpanNode | undefined => {
    console.log("[SharedGenerationResultUtils] extractPrimarySpan:", {
        hasResponse: !!response,
        responseType: typeof response,
        hasTraces: !!response?.traces,
        hasNodes: !!response?.nodes,
        traceId,
    })

    // Handle inline tree format (from old playground response.tree)
    // Format: { nodes: [{ metrics: { acc: {...}, unit: {...} }, status: "..." }] }
    if (response?.nodes && Array.isArray(response.nodes) && response.nodes.length > 0) {
        const node = response.nodes[0]
        const metricAcc = node?.metrics?.acc
        const metricUnit = node?.metrics?.unit
        const metric = metricAcc || metricUnit

        // Convert inline tree node to TraceSpanNode-like structure
        // This allows the readMetric function to extract values
        return {
            span_id: traceId || "inline",
            trace_id: traceId || "inline",
            status_code: node?.status,
            // Put metrics in attributes.ag.metrics for readMetric to find
            attributes: {
                ag: {
                    metrics: {
                        duration: {cumulative: metric?.duration},
                        tokens: {cumulative: metric?.tokens},
                        costs: {cumulative: metric?.costs},
                    },
                },
            },
            // Also keep original metrics for direct access
            metrics: metric,
        } as unknown as TraceSpanNode
    }

    const nodes = (() => {
        if (response?.traces) {
            console.log("[SharedGenerationResultUtils] Using transformTracesResponseToTree")
            const result = transformTracesResponseToTree(response as any)
            console.log("[SharedGenerationResultUtils] transformTracesResponseToTree result:", {
                nodeCount: result?.length,
                firstNode: result?.[0]
                    ? {span_id: result[0].span_id, trace_id: result[0].trace_id}
                    : null,
            })
            return result
        }
        const spans = buildSpanList(response)
        if (!spans.length) return []
        return spans.map((span) => ({...span}) as TraceSpanNode)
    })()

    console.log("[SharedGenerationResultUtils] nodes:", {
        count: nodes.length,
        firstNode: nodes[0] ? {span_id: nodes[0].span_id, parent_id: nodes[0].parent_id} : null,
    })

    if (!nodes.length) return undefined

    const roots = nodes.filter((node) => !node.parent_id || node.trace_id === traceId)
    console.log("[SharedGenerationResultUtils] roots:", roots.length)
    const sorted = sortSpansByStartTime(roots.length ? roots : nodes)
    console.log(
        "[SharedGenerationResultUtils] primarySpan:",
        sorted[0] ? {span_id: sorted[0].span_id} : null,
    )
    return sorted[0]
}

type MetricPath = string | {path: string; valueKeys?: string[]}

const extractNumber = (value: unknown, valueKeys?: string[]): number | undefined => {
    const direct = numeric(value)
    if (direct !== undefined) return direct
    if (value && typeof value === "object") {
        const keys = valueKeys && valueKeys.length ? valueKeys : ["total", "value", "duration"]
        for (const key of keys) {
            const candidate = (value as any)[key]
            const num = numeric(candidate)
            if (num !== undefined) return num
        }
    }
    return undefined
}

const readMetric = (span: TraceSpanNode | undefined, paths: MetricPath[]): number | undefined => {
    if (!span) return undefined
    const sources = [
        span,
        (span as any).data,
        span.attributes,
        (span as any).metrics,
        (span as any).attributes?.ag,
        (span as any).attributes?.ag?.metrics,
    ].filter(Boolean)

    for (const pathEntry of paths) {
        const path = typeof pathEntry === "string" ? pathEntry : pathEntry.path
        const valueKeys = typeof pathEntry === "string" ? undefined : pathEntry.valueKeys
        for (const source of sources) {
            const value = resolvePath(source, path)
            const num = extractNumber(value, valueKeys)
            if (num !== undefined) return num
        }
    }

    return undefined
}

const SharedGenerationResultUtils = ({
    traceId,
    tree,
    className,
    showStatus = true,
}: SharedGenerationResultUtilsProps) => {
    const [, setTraceQueryParam] = useQueryParamState("trace")
    const [, setSpanQueryParam] = useQueryParamState("span")

    // Determine effective trace ID (from prop or inline tree)
    const effectiveTraceId = traceId ?? tree?.trace_id ?? null

    // Use trace entity atom family for data fetching (only if no inline tree)
    const traceEntityAtom = useMemo(
        () => traceEntityAtomFamily(!tree ? effectiveTraceId : null),
        [effectiveTraceId, tree],
    )
    const {data: fetchedData, isPending} = useAtomValue(traceEntityAtom)

    // Use inline tree data if provided, otherwise use fetched data
    const data = tree || fetchedData

    // Only show loading if we're actually fetching (no inline tree and query is pending)
    const isLoading = !tree && isPending

    console.log("[SharedGenerationResultUtils] data source:", {
        traceId,
        effectiveTraceId,
        hasInlineTree: !!tree,
        hasFetchedData: !!fetchedData,
        isLoading,
    })

    const primarySpan = useMemo(
        () => extractPrimarySpan(data, effectiveTraceId ?? undefined),
        [data, effectiveTraceId],
    )

    const status: StatusCode | undefined = useMemo(() => {
        if (!primarySpan) return undefined
        const raw = (primarySpan.status_code as StatusCode | undefined) ?? undefined
        const hasError =
            readMetric(primarySpan, [
                "attributes.ag.metrics.errors.cumulative.total",
                "metrics.errors.total",
                "errors.total",
            ]) ?? 0
        if (hasError && hasError > 0) return StatusCode.STATUS_CODE_ERROR
        if (raw) return raw
        return StatusCode.STATUS_CODE_OK
    }, [primarySpan])

    const durationMs = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.duration.cumulative.total",
                {
                    path: "attributes.ag.metrics.duration.cumulative",
                    valueKeys: ["total", "duration"],
                },
                "metrics.acc.duration.total",
                "metrics.unit.duration.total",
                "metrics.duration.total",
                {path: "duration", valueKeys: ["total", "value"]},
            ]),
        [primarySpan],
    )

    const totalTokens = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.tokens.cumulative.total",
                {path: "attributes.ag.metrics.tokens.cumulative", valueKeys: ["total"]},
                "metrics.tokens.total",
                {path: "tokens", valueKeys: ["total"]},
            ]),
        [primarySpan],
    )

    const promptTokens = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.tokens.cumulative.prompt",
                {
                    path: "attributes.ag.metrics.tokens.cumulative",
                    valueKeys: ["prompt", "prompt_tokens"],
                },
                "metrics.tokens.prompt",
                {path: "tokens", valueKeys: ["prompt", "prompt_tokens"]},
            ]),
        [primarySpan],
    )

    const completionTokens = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.tokens.cumulative.completion",
                {
                    path: "attributes.ag.metrics.tokens.cumulative",
                    valueKeys: ["completion", "completion_tokens"],
                },
                "metrics.tokens.completion",
                {path: "tokens", valueKeys: ["completion", "completion_tokens"]},
            ]),
        [primarySpan],
    )

    const totalCost = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.costs.cumulative.total",
                {path: "attributes.ag.metrics.costs.cumulative", valueKeys: ["total", "cost"]},
                "metrics.costs.total",
                {path: "costs", valueKeys: ["total"]},
                "cost",
            ]),
        [primarySpan],
    )

    const handleOpenTrace = useCallback(
        (event: React.MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            if (!effectiveTraceId || effectiveTraceId === "inline") return

            const activeSpanId = primarySpan?.span_id ?? null
            // Use the global store directly to ensure the TraceDrawer (in AppGlobalWrappers)
            // receives the state update, even when this component is inside an isolated store
            globalStore.set(openTraceDrawerAtom, {traceId: effectiveTraceId, activeSpanId})
            globalStore.set(setTraceDrawerActiveSpanAtom, activeSpanId)
            setTraceQueryParam(effectiveTraceId, {shallow: true})
            if (activeSpanId) {
                setSpanQueryParam(activeSpanId, {shallow: true})
            } else {
                setSpanQueryParam(undefined, {shallow: true})
            }
        },
        [effectiveTraceId, primarySpan?.span_id, setSpanQueryParam, setTraceQueryParam],
    )

    const formattedLatency = useMemo(
        () => formatLatency(durationMs !== undefined ? durationMs / 1000 : null),
        [durationMs],
    )
    const formattedTokens = useMemo(() => formatTokenUsage(totalTokens), [totalTokens])
    const formattedCosts = useMemo(() => formatCurrency(totalCost), [totalCost])
    const formattedPrompts = useMemo(() => formatTokenUsage(promptTokens), [promptTokens])
    const formattedCompletions = useMemo(
        () => formatTokenUsage(completionTokens),
        [completionTokens],
    )

    // Return null if neither traceId nor inline tree data provided
    if (!traceId && !tree) return null

    // Can only open trace drawer if we have a real traceId (not inline data)
    const canOpenTrace = !!effectiveTraceId && effectiveTraceId !== "inline"

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <Button
                type="default"
                size="small"
                icon={<TreeView size={14} />}
                loading={isLoading}
                disabled={!canOpenTrace}
                onClick={handleOpenTrace}
                data-ivt-stop-row-click
            />

            {showStatus && status ? <StatusRenderer status={status} /> : null}

            {durationMs !== undefined ? (
                <Tag color="default" variant="filled" className="flex items-center gap-1">
                    <Timer size={14} /> {formattedLatency}
                </Tag>
            ) : null}

            {totalTokens !== undefined || totalCost !== undefined ? (
                <ResultTag
                    color="default"
                    variant="filled"
                    value1={
                        <div className="flex items-center gap-1 text-nowrap">
                            <PlusCircle size={14} /> {formattedTokens} / {formattedCosts}
                        </div>
                    }
                    popoverContent={
                        <Space orientation="vertical">
                            <Space>
                                <div>{formattedPrompts}</div>
                                <div>Prompt tokens</div>
                            </Space>
                            <Space>
                                <div>{formattedCompletions}</div>
                                <div>Completion tokens</div>
                            </Space>
                        </Space>
                    }
                />
            ) : null}
        </div>
    )
}

export default memo(SharedGenerationResultUtils)
