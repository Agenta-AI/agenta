/**
 * Agenta SDK Tracing — Hierarchy Repairer.
 *
 * Operates on TransformedSpan[] (already cloned from original ReadableSpans).
 * Reparents orphaned spans and propagates session IDs.
 */

import type {TransformedSpan} from "./transformed-span"

/**
 * Repair span hierarchy after filtering.
 *
 * TransformedSpans have mutable `parentSpanId` and `attributes` —
 * safe to modify since they're copies of the originals.
 */
export function repairHierarchy(spans: TransformedSpan[], keptSpanIds: Set<string>): void {
    const byTrace = new Map<string, TransformedSpan[]>()
    for (const span of spans) {
        const traceId = span.spanContext().traceId
        if (!byTrace.has(traceId)) byTrace.set(traceId, [])
        byTrace.get(traceId)!.push(span)
    }

    for (const traceSpans of byTrace.values()) {
        if (traceSpans.length === 0) continue

        traceSpans.sort(
            (a, b) =>
                Number(a.startTime[0] - b.startTime[0]) || Number(a.startTime[1] - b.startTime[1]),
        )

        // Root is the top-level AI SDK span (ai.streamText / ai.generateText)
        // or a manually-created chat: span. Falls back to the span with no
        // parent in the kept set, or the earliest span.
        const root =
            traceSpans.find((s) => s.name === "ai.streamText" || s.name === "ai.generateText") ??
            traceSpans.find((s) => s.name.startsWith("chat:")) ??
            traceSpans.find((s) => !s.parentSpanId || !keptSpanIds.has(s.parentSpanId)) ??
            traceSpans[0]
        const rootSpanId = root.spanContext().spanId

        for (const span of traceSpans) {
            const spanId = span.spanContext().spanId
            const parentId = span.parentSpanId

            if (parentId && !keptSpanIds.has(parentId) && spanId !== rootSpanId) {
                if (span.attributes["ag.type.node"] === "tool") {
                    const chatBefore = [...traceSpans]
                        .reverse()
                        .find(
                            (s) =>
                                s.attributes["ag.type.node"] === "chat" &&
                                (s.startTime[0] < span.startTime[0] ||
                                    (s.startTime[0] === span.startTime[0] &&
                                        s.startTime[1] <= span.startTime[1])),
                        )
                    span.parentSpanId = chatBefore ? chatBefore.spanContext().spanId : rootSpanId
                } else {
                    span.parentSpanId = rootSpanId
                }
            }

            if (spanId === rootSpanId) {
                span.attributes["ag.type.tree"] = "invocation"
                // Clear any stray parent so the root is truly parentless
                span.parentSpanId = undefined
            } else {
                delete span.attributes["ag.type.tree"]
            }
        }
    }
}

/**
 * Propagate session IDs across spans in a trace.
 */
export function propagateSessions(
    spans: TransformedSpan[],
    sessionCache: Map<string, string>,
): void {
    for (const span of spans) {
        const sessionId = span.attributes["ag.session.id"]
        if (typeof sessionId === "string") {
            sessionCache.set(span.spanContext().spanId, sessionId)
        }
    }

    for (const span of spans) {
        if (span.attributes["ag.session.id"]) continue

        const parentId = span.parentSpanId
        let sessionId: string | undefined

        if (parentId) {
            sessionId = sessionCache.get(parentId)
        }

        if (!sessionId) {
            const traceId = span.spanContext().traceId
            for (const other of spans) {
                if (other.spanContext().traceId === traceId) {
                    const otherSession = other.attributes["ag.session.id"]
                    if (typeof otherSession === "string") {
                        sessionId = otherSession
                        break
                    }
                }
            }
        }

        if (sessionId) {
            span.attributes["ag.session.id"] = sessionId
            sessionCache.set(span.spanContext().spanId, sessionId)
        }
    }
}
