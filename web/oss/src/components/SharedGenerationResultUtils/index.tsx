import {memo, useMemo, useCallback} from "react"

import {TreeView, Timer, PlusCircle} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {Button, Space, Tag} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"

import StatusRenderer from "@/oss/components/pages/observability/components/StatusRenderer"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {resolvePath} from "@/oss/lib/traces/traceUtils"
import {sortSpansByStartTime} from "@/oss/lib/traces/tracing"
import {fetchPreviewTrace} from "@/oss/services/tracing/api"
import {transformTracesResponseToTree} from "@/oss/services/tracing/lib/helpers"
import {StatusCode, type TraceSpan, type TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"

import {
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
} from "../Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"

interface SharedGenerationResultUtilsProps {
    traceId?: string | null
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
    if (!data) return []

    if (Array.isArray(data?.spans)) {
        return data.spans as TraceSpan[]
    }

    if (data?.traces && typeof data.traces === "object") {
        const traces = Object.values(data.traces ?? {}) as any[]
        const spans: TraceSpan[] = []
        traces.forEach((entry) => {
            const record = entry?.spans
            if (record && typeof record === "object") {
                spans.push(...(Object.values(record) as TraceSpan[]))
            }
        })
        return spans
    }

    return []
}

const extractPrimarySpan = (response: any, traceId?: string | null): TraceSpanNode | undefined => {
    const nodes = (() => {
        if (response?.traces) {
            return transformTracesResponseToTree(response as any)
        }
        const spans = buildSpanList(response)
        if (!spans.length) return []
        return spans.map((span) => ({...span}) as TraceSpanNode)
    })()

    if (!nodes.length) return undefined

    const roots = nodes.filter((node) => !node.parent_id || node.trace_id === traceId)
    const sorted = sortSpansByStartTime(roots.length ? roots : nodes)
    return sorted[0]
}

const readMetric = (span: TraceSpanNode | undefined, paths: string[]): number | undefined => {
    if (!span) return undefined
    const sources = [
        span,
        (span as any).data,
        span.attributes,
        (span as any).metrics,
        (span as any).attributes?.ag,
        (span as any).attributes?.ag?.metrics,
    ].filter(Boolean)

    for (const path of paths) {
        for (const source of sources) {
            const value = resolvePath(source, path)
            const num = numeric(value)
            if (num !== undefined) return num
        }
    }

    return undefined
}

const SharedGenerationResultUtils = ({
    traceId,
    className,
    showStatus = true,
}: SharedGenerationResultUtilsProps) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const setActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const [, setTraceQueryParam] = useQueryParamState("trace")
    const [, setSpanQueryParam] = useQueryParamState("span")

    const {data, isLoading} = useQuery({
        queryKey: ["generation-trace", traceId ?? "none"],
        enabled: Boolean(traceId),
        queryFn: () => (traceId ? fetchPreviewTrace(traceId) : null),
        staleTime: 15_000,
    })

    const primarySpan = useMemo(
        () => extractPrimarySpan(data, traceId ?? undefined),
        [data, traceId],
    )

    const status: StatusCode | undefined = useMemo(() => {
        if (!primarySpan) return undefined
        const raw = (primarySpan.status_code as StatusCode | undefined) ?? undefined
        const hasError =
            readMetric(primarySpan, ["attributes.ag.metrics.errors.cumulative.total"]) ??
            readMetric(primarySpan, ["metrics.errors.total"]) ??
            0
        if (hasError && hasError > 0) return StatusCode.STATUS_CODE_ERROR
        if (raw) return raw
        return StatusCode.STATUS_CODE_OK
    }, [primarySpan])

    const durationMs = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.duration.cumulative.total",
                "metrics.duration.total",
                "duration.total",
                "duration",
            ]),
        [primarySpan],
    )

    const totalTokens = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.tokens.cumulative.total",
                "metrics.tokens.total",
                "tokens.total",
                "tokens",
            ]),
        [primarySpan],
    )

    const promptTokens = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.tokens.cumulative.prompt",
                "metrics.tokens.prompt",
                "tokens.prompt",
            ]),
        [primarySpan],
    )

    const completionTokens = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.tokens.cumulative.completion",
                "metrics.tokens.completion",
                "tokens.completion",
            ]),
        [primarySpan],
    )

    const totalCost = useMemo(
        () =>
            readMetric(primarySpan, [
                "attributes.ag.metrics.costs.cumulative.total",
                "metrics.costs.total",
                "costs.total",
                "cost",
            ]),
        [primarySpan],
    )

    const handleOpenTrace = useCallback(() => {
        if (!traceId) return
        const activeSpanId = primarySpan?.span_id ?? null
        openTraceDrawer({traceId, activeSpanId})
        setActiveSpan(activeSpanId)
        setTraceQueryParam(traceId, {shallow: true})
        if (activeSpanId) {
            setSpanQueryParam(activeSpanId, {shallow: true})
        } else {
            setSpanQueryParam(undefined, {shallow: true})
        }
    }, [
        primarySpan?.span_id,
        openTraceDrawer,
        setActiveSpan,
        setSpanQueryParam,
        setTraceQueryParam,
        traceId,
    ])

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

    if (!traceId) return null

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <Button
                type="text"
                size="small"
                icon={<TreeView size={14} />}
                loading={isLoading}
                disabled={!primarySpan}
                onClick={handleOpenTrace}
                data-ivt-stop-row-click
            />

            {showStatus && status ? <StatusRenderer status={status} /> : null}

            {durationMs !== undefined ? (
                <Tag color="default" bordered={false} className="flex items-center gap-1">
                    <Timer size={14} /> {formattedLatency}
                </Tag>
            ) : null}

            {totalTokens !== undefined || totalCost !== undefined ? (
                <ResultTag
                    color="default"
                    bordered={false}
                    value1={
                        <div className="flex items-center gap-1 text-nowrap">
                            <PlusCircle size={14} /> {formattedTokens} / {formattedCosts}
                        </div>
                    }
                    popoverContent={
                        <Space direction="vertical">
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
