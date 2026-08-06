/**
 * Agenta SDK Tracing — Transformed Span.
 *
 * A lightweight copy of a ReadableSpan with overridden attributes
 * and parentSpanId. The original span is never mutated.
 *
 * Implements ReadableSpan so it can be passed to the inner OTLP exporter.
 */

import {
    type Attributes,
    type HrTime,
    type Link,
    type SpanContext,
    type SpanKind,
    type SpanStatus,
    TraceFlags,
} from "@opentelemetry/api"
import type {InstrumentationScope} from "@opentelemetry/core"
import type {Resource} from "@opentelemetry/resources"
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"
import type {TimedEvent} from "@opentelemetry/sdk-trace-base"

export class TransformedSpan implements ReadableSpan {
    readonly name: string
    readonly kind: SpanKind
    readonly spanContext: () => SpanContext
    readonly startTime: HrTime
    readonly endTime: HrTime
    readonly status: SpanStatus
    readonly attributes: Attributes
    readonly links: Link[]
    readonly events: TimedEvent[]
    readonly duration: HrTime
    readonly ended: boolean
    readonly resource: Resource
    readonly instrumentationScope: InstrumentationScope
    readonly droppedAttributesCount: number
    readonly droppedEventsCount: number
    readonly droppedLinksCount: number

    /**
     * Mutable parent span ID for reparenting.
     * Used by hierarchy repairer, reflected in parentSpanContext getter.
     */
    parentSpanId?: string

    private _traceId: string
    private _originalParentSpanContext?: SpanContext

    /**
     * Returns parentSpanContext reflecting the current parentSpanId.
     * This ensures the OTLP exporter serializes reparented hierarchy correctly.
     */
    get parentSpanContext(): SpanContext | undefined {
        if (!this.parentSpanId) return undefined
        // If parentSpanId hasn't changed, return the original context
        if (this._originalParentSpanContext?.spanId === this.parentSpanId) {
            return this._originalParentSpanContext
        }
        // Build a new context for the reparented span
        return {
            traceId: this._traceId,
            spanId: this.parentSpanId,
            traceFlags: TraceFlags.SAMPLED,
        }
    }

    constructor(
        source: ReadableSpan,
        overrides: {
            attributes?: Record<string, unknown>
            parentSpanId?: string
        },
    ) {
        this.name = source.name
        this.kind = source.kind
        this.spanContext = () => source.spanContext()
        this._traceId = source.spanContext().traceId
        this._originalParentSpanContext = source.parentSpanContext
        this.startTime = source.startTime
        this.endTime = source.endTime
        this.status = source.status
        this.links = source.links
        this.events = source.events
        this.duration = source.duration
        this.ended = source.ended
        this.resource = source.resource
        this.instrumentationScope = source.instrumentationScope
        this.droppedAttributesCount = source.droppedAttributesCount
        this.droppedEventsCount = source.droppedEventsCount
        this.droppedLinksCount = source.droppedLinksCount

        // Merge source attributes with overrides
        this.attributes = {
            ...source.attributes,
            ...(overrides.attributes as Attributes),
        }

        // Read parentSpanId from source's parentSpanContext
        this.parentSpanId = overrides.parentSpanId ?? source.parentSpanContext?.spanId
    }
}
