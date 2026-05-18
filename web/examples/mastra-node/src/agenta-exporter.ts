/**
 * AgentaMastraExporter — bridges Mastra's `ObservabilityBus` to the
 * globally-registered OTel TracerProvider.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Why this exists (Phase 6 finding):                          │
 *   │                                                             │
 *   │ Mastra emits spans to its own `ObservabilityBus` as         │
 *   │ `TracingEvent` payloads — NOT as OTel ReadableSpans.        │
 *   │ A globally-registered NodeTracerProvider doesn't see them.  │
 *   │ Mastra's vendored AI SDK v1 also returns a `noopTracer`     │
 *   │ when `experimental_telemetry.isEnabled` defaults to false,  │
 *   │ which Mastra never flips on via the user-facing API. So     │
 *   │ AI SDK's `ai.*` OTel spans never emit through Mastra.       │
 *   │                                                             │
 *   │ This exporter closes the gap. It subscribes to Mastra's     │
 *   │ TracingEvent stream and re-emits each Mastra span as an     │
 *   │ OTel span through the globally-registered tracer. The OTel  │
 *   │ SDK then handles OTLP serialization, transport, batching,   │
 *   │ and retries — no hand-crafted protocol code.                │
 *   │                                                             │
 *   │ ID strategy: OTel generates its own trace_id/span_id (the   │
 *   │ SDK doesn't expose "use these specific IDs"). We maintain   │
 *   │ a Mastra-id → OTel-span map so child spans can find their   │
 *   │ parent's OTel context. The trace_id Agenta sees is OTel's,  │
 *   │ not Mastra's — that's fine for end users.                   │
 *   │                                                             │
 *   │ This is THE SAME SHAPE @agenta/sdk-mastra would have to     │
 *   │ take in production: extend Mastra's BaseExporter, re-emit   │
 *   │ through the user's globally-registered OTel provider.       │
 *   │ ~150 lines of code is the v0 wedge.                         │
 *   │                                                             │
 *   │ Backend-led alternative (aligned with team direction): ship │
 *   │ a thinner JS shim that POSTs Mastra spans raw to a          │
 *   │ dedicated Agenta endpoint, and the backend handles OTLP +   │
 *   │ ag.* mapping. Out of scope for this PoC; discussed in       │
 *   │ docs/design/ts-sdk-tracing/summary.md (Strategic            │
 *   │ alternative: backend-led integration).                       │
 *   └─────────────────────────────────────────────────────────────┘
 */

import type {AnyExportedSpan, TracingEvent} from "@mastra/core/observability"
import {TracingEventType} from "@mastra/core/observability"
import {BaseExporter} from "@mastra/observability"
import type {BaseExporterConfig} from "@mastra/observability"
import type {Context, Span} from "@opentelemetry/api"
import {context, trace} from "@opentelemetry/api"

export interface AgentaMastraExporterConfig extends BaseExporterConfig {
    /** OTel tracer name (also used as instrumentation scope). */
    tracerName?: string
}

/**
 * Bridge Mastra `TracingEvent` bus → OTel SDK → OTLP → Agenta.
 *
 * Strategy:
 *   - SPAN_STARTED: open an OTel span (using the globally-registered
 *     tracer), parented to whatever OTel span corresponds to Mastra's
 *     `parentSpanId`. Cache by Mastra id.
 *   - SPAN_UPDATED: look up the OTel span, merge updated attributes.
 *   - SPAN_ENDED: look up the OTel span, set final attrs, end it. The
 *     globally-registered SpanProcessor takes over from there.
 *
 * Because OTel doesn't let us specify span IDs, Agenta sees fresh
 * OTel-generated IDs, not Mastra's. The tree shape is preserved.
 */
export class AgentaMastraExporter extends BaseExporter {
    name = "agenta-mastra-exporter"

    private readonly tracerName: string
    private readonly active = new Map<string, Span>()

    constructor(config: AgentaMastraExporterConfig = {}) {
        super(config)
        this.tracerName = config.tracerName ?? "@agenta/sdk-mastra"
    }

    protected async _exportTracingEvent(event: TracingEvent): Promise<void> {
        const span = event.exportedSpan

        if (event.type === TracingEventType.SPAN_STARTED) {
            const tracer = trace.getTracer(this.tracerName)
            // Resolve parent context: if Mastra says this span has a parent
            // AND we have an OTel span for that parent, use its context.
            // Otherwise this becomes a root span in OTel's eyes.
            let ctx: Context = context.active()
            if (span.parentSpanId) {
                const parentOtelSpan = this.active.get(span.parentSpanId)
                if (parentOtelSpan) {
                    ctx = trace.setSpan(context.active(), parentOtelSpan)
                }
            }

            const otelSpan = tracer.startSpan(
                span.name,
                {
                    startTime: span.startTime,
                    attributes: this.mapAttributes(span),
                },
                ctx,
            )
            this.active.set(span.id, otelSpan)
        } else if (event.type === TracingEventType.SPAN_UPDATED) {
            const otelSpan = this.active.get(span.id)
            if (otelSpan) otelSpan.setAttributes(this.mapAttributes(span))
        } else if (event.type === TracingEventType.SPAN_ENDED) {
            const otelSpan = this.active.get(span.id)
            if (otelSpan) {
                // Merge any final attrs that arrived only on end (output,
                // usage, finish reason).
                otelSpan.setAttributes(this.mapAttributes(span))
                if (span.errorInfo) {
                    otelSpan.setStatus({
                        code: 2, // ERROR
                        message: span.errorInfo.message ?? "unknown",
                    })
                }
                otelSpan.end(span.endTime)
                this.active.delete(span.id)
            }
        }
    }

    /** Map a Mastra ExportedSpan's data to Agenta's `ag.*` attribute namespace. */
    private mapAttributes(span: AnyExportedSpan): Record<string, string | number | boolean> {
        const out: Record<string, string | number | boolean> = {}

        // ag.type.* — span / trace categorization
        out["ag.type.span"] = span.type
        out["ag.type.trace"] = "invocation"

        // ag.data.inputs / ag.data.outputs — the headline payload
        if (span.input !== undefined) {
            out["ag.data.inputs"] = safeStringify(span.input)
        }
        if (span.output !== undefined) {
            out["ag.data.outputs"] = safeStringify(span.output)
        }

        // ag.user.id / ag.session.id from Mastra's tracingOptions.metadata.
        // (Mastra propagates these down through child spans automatically.)
        if (span.metadata?.userId) {
            out["ag.user.id"] = String(span.metadata.userId)
        }
        if (span.metadata?.sessionId) {
            out["ag.session.id"] = String(span.metadata.sessionId)
        }

        // ag.meta.* — flatten the span-type-specific attributes one level.
        if (span.attributes && typeof span.attributes === "object") {
            for (const [k, v] of Object.entries(span.attributes)) {
                if (v === undefined || v === null) continue
                const key = `ag.meta.${k}`
                if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
                    out[key] = v
                } else {
                    out[key] = safeStringify(v)
                }
            }
        }

        // Mastra-native entity info (agent name, etc.) — surface separately
        // so it's visible in the Agenta dashboard.
        if (span.entityType) out["ag.meta.entity.type"] = span.entityType
        if (span.entityId) out["ag.meta.entity.id"] = span.entityId
        if (span.entityName) out["ag.meta.entity.name"] = span.entityName

        return out
    }

    /** Drain any open spans on shutdown (best-effort). */
    async shutdown(): Promise<void> {
        // End any spans Mastra didn't get a chance to close (defensive).
        for (const [id, span] of this.active) {
            try {
                span.end()
            } catch {
                // ignore
            }
            this.active.delete(id)
        }
    }
}

function safeStringify(v: unknown): string {
    try {
        return JSON.stringify(v)
    } catch {
        return String(v)
    }
}
