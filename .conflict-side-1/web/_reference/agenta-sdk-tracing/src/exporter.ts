/**
 * Agenta SDK Tracing — Exporter.
 *
 * Custom SpanExporter pipeline:
 * 1. Filter to agent-relevant spans (LLM, tool, embedding)
 * 2. Buffer per-trace until the root span arrives (prevents cross-batch orphans)
 * 3. Clone into TransformedSpans (never mutate originals)
 * 4. Map framework attributes to Agenta conventions (ag.*)
 * 5. Repair hierarchy (reparent orphaned spans)
 * 6. Propagate session IDs
 * 7. Forward to Agenta's OTLP endpoint
 */

import {ExportResultCode, type ExportResult} from "@opentelemetry/core"
import {type SpanExporter, type ReadableSpan} from "@opentelemetry/sdk-trace-base"

import {repairHierarchy, propagateSessions} from "./hierarchy-repairer"
import {isAgentSpan} from "./span-filter"
import {TransformedSpan} from "./transformed-span"

const MAX_CACHED_IDS = 2000
const PRUNE_TO = 1000

/** Max time (ms) to buffer spans waiting for a root before flushing anyway. */
const BUFFER_TIMEOUT_MS = 30_000

/**
 * Check if a span is the root of an LLM trace.
 *
 * The root is the top-level AI SDK span (`ai.streamText` or `ai.generateText`)
 * which is the last to end (after streaming completes). Child spans like
 * `ai.toolCall` and `ai.streamText.doStream` end first during streaming.
 *
 * Also supports manually-created `chat:` root spans for custom tracing.
 */
function isRootSpan(span: ReadableSpan): boolean {
    const name = span.name
    return name === "ai.streamText" || name === "ai.generateText" || name.startsWith("chat:")
}

export class AgentaExporter implements SpanExporter {
    private inner: SpanExporter
    private mapper: (span: ReadableSpan) => Record<string, unknown>
    private exportedSpanIds = new Set<string>()
    private sessionCache = new Map<string, string>()

    /**
     * Per-trace buffer: holds child spans until the root `chat:` span arrives.
     * Key = traceId, Value = { spans, deadline }.
     */
    private pendingTraces = new Map<string, {spans: ReadableSpan[]; deadline: number}>()

    constructor(
        innerExporter: SpanExporter,
        mapper?: (span: ReadableSpan) => Record<string, unknown>,
    ) {
        this.inner = innerExporter
        this.mapper =
            mapper ??
            ((span) => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const {createMapper} = require("./mappers/index")
                const autoMapper = createMapper("auto")
                this.mapper = autoMapper
                return autoMapper(span)
            })
    }

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        // 1. Filter to agent spans only
        const agentSpans = spans.filter(isAgentSpan)
        if (agentSpans.length === 0) {
            resultCallback({code: ExportResultCode.SUCCESS})
            return
        }

        // 2. Group incoming spans by traceId
        const byTrace = new Map<string, ReadableSpan[]>()
        for (const span of agentSpans) {
            const traceId = span.spanContext().traceId
            if (!byTrace.has(traceId)) byTrace.set(traceId, [])
            byTrace.get(traceId)!.push(span)
        }

        // 3. Merge with pending buffer and decide what's ready to export
        const readyToExport: ReadableSpan[] = []

        for (const [traceId, traceSpans] of byTrace) {
            const pending = this.pendingTraces.get(traceId)
            const allSpans = pending ? [...pending.spans, ...traceSpans] : traceSpans

            const hasRoot = allSpans.some(isRootSpan)

            if (hasRoot) {
                readyToExport.push(...allSpans)
                this.pendingTraces.delete(traceId)
            } else {
                const deadline = pending?.deadline ?? Date.now() + BUFFER_TIMEOUT_MS
                this.pendingTraces.set(traceId, {spans: allSpans, deadline})
            }
        }

        // 4. Flush any timed-out pending traces (safety valve)
        const now = Date.now()
        for (const [traceId, pending] of this.pendingTraces) {
            if (now >= pending.deadline) {
                readyToExport.push(...pending.spans)
                this.pendingTraces.delete(traceId)
            }
        }

        if (readyToExport.length === 0) {
            resultCallback({code: ExportResultCode.SUCCESS})
            return
        }

        // 5. Build kept span ID set (for hierarchy repair)
        const keptSpanIds = new Set(this.exportedSpanIds)
        for (const s of readyToExport) {
            keptSpanIds.add(s.spanContext().spanId)
        }

        // 6. Clone into TransformedSpans with mapped attributes
        const transformed = readyToExport.map((span) => {
            const newAttrs = this.mapper(span)
            return new TransformedSpan(span, {attributes: newAttrs})
        })

        // 7. Propagate session IDs (on cloned spans — safe to mutate)
        propagateSessions(transformed, this.sessionCache)

        // 8. Repair hierarchy (on cloned spans — safe to reparent)
        repairHierarchy(transformed, keptSpanIds)

        // 9. Track exported IDs (with cap)
        for (const s of transformed) {
            this.exportedSpanIds.add(s.spanContext().spanId)
        }
        if (this.exportedSpanIds.size > MAX_CACHED_IDS) {
            const ids = Array.from(this.exportedSpanIds)
            this.exportedSpanIds = new Set(ids.slice(ids.length - PRUNE_TO))
        }
        if (this.sessionCache.size > MAX_CACHED_IDS) {
            const entries = Array.from(this.sessionCache.entries())
            this.sessionCache = new Map(entries.slice(entries.length - PRUNE_TO))
        }

        // 10. Forward transformed spans to inner exporter
        this.inner.export(transformed, resultCallback)
    }

    async shutdown(): Promise<void> {
        // Flush any remaining buffered spans before shutdown
        if (this.pendingTraces.size > 0) {
            const remaining: ReadableSpan[] = []
            for (const pending of this.pendingTraces.values()) {
                remaining.push(...pending.spans)
            }
            this.pendingTraces.clear()

            if (remaining.length > 0) {
                const keptSpanIds = new Set(this.exportedSpanIds)
                for (const s of remaining) keptSpanIds.add(s.spanContext().spanId)
                const transformed = remaining.map((span) => {
                    const newAttrs = this.mapper(span)
                    return new TransformedSpan(span, {attributes: newAttrs})
                })
                propagateSessions(transformed, this.sessionCache)
                repairHierarchy(transformed, keptSpanIds)
                await new Promise<void>((resolve) => {
                    this.inner.export(transformed, () => resolve())
                })
            }
        }
        return this.inner.shutdown()
    }

    async forceFlush(): Promise<void> {
        if ("forceFlush" in this.inner && typeof this.inner.forceFlush === "function") {
            return (this.inner as {forceFlush: () => Promise<void>}).forceFlush()
        }
    }
}
