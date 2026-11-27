/**
 * The one turn rule of a trace: a turn starts at each child of the root span whose input holds a
 * user message, and holds the spans up to the next turn. The drawer places tool calls per turn
 * with it, and the trace tree groups its rows by it. Pure: no React, no request.
 *
 * @packageDocumentation
 */

import {parseStructuredJson} from "@agenta/shared/utils"

import {extractInputs} from "../utils/selectors"

import type {TraceSpan} from "./schema"

export interface TraceTurn {
    /** The span whose input holds the user message (a child of the root); the root when one turn. */
    spanId: string
    /** Every span of the turn, by start time. */
    spans: TraceSpan[]
    /** The earliest start and the latest end of the turn's spans, in ms; null when none has one. */
    startTime: number | null
    endTime: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const timeOf = (value: unknown): number | null => {
    if (typeof value !== "string" && typeof value !== "number") return null
    const ms = new Date(value).getTime()
    return Number.isFinite(ms) ? ms : null
}

/** True when a value holds a message with the role `user`, at any depth (JSON text included). */
const hasUserMessage = (value: unknown, depth = 0): boolean => {
    if (depth > 6) return false
    if (typeof value === "string") {
        const parsed = /^\s*[[{]/.test(value) ? parseStructuredJson(value) : null
        return parsed !== null && typeof parsed === "object" && hasUserMessage(parsed, depth + 1)
    }
    if (Array.isArray(value)) return value.some((item) => hasUserMessage(item, depth + 1))
    if (!isRecord(value)) return false
    if (value.role === "user") return true
    return Object.values(value).some((item) => hasUserMessage(item, depth + 1))
}

/** The spans of a list, with the children a trace response nests under `spans`, once each. */
const flatten = (spans: readonly TraceSpan[]): TraceSpan[] => {
    const seen = new Map<string, TraceSpan>()
    const visit = (span: TraceSpan) => {
        if (seen.has(span.span_id)) return
        seen.set(span.span_id, span)
        for (const child of Object.values(span.spans ?? {})) {
            for (const nested of Array.isArray(child) ? child : [child]) visit(nested)
        }
    }
    spans.forEach(visit)
    return [...seen.values()]
}

const byStart = (a: TraceSpan, b: TraceSpan) =>
    (timeOf(a.start_time) ?? 0) - (timeOf(b.start_time) ?? 0)

const turnOf = (spanId: string, spans: TraceSpan[]): TraceTurn => {
    const starts = spans.map((span) => timeOf(span.start_time)).filter((ms) => ms !== null)
    const ends = spans.map((span) => timeOf(span.end_time)).filter((ms) => ms !== null)
    return {
        spanId,
        spans,
        startTime: starts.length ? Math.min(...starts) : null,
        endTime: ends.length ? Math.max(...ends) : null,
    }
}

/**
 * Split a trace into its user turns. Spans before the first turn join the first turn; the root
 * span is in no turn when there are turns. A trace with no such child is one turn with every
 * span. Takes a flat list or the nested spans of a trace response.
 */
export function groupTraceTurns(spans: readonly TraceSpan[]): TraceTurn[] {
    const all = flatten(spans).sort(byStart)
    if (all.length === 0) return []
    const byId = new Map(all.map((span) => [span.span_id, span]))
    const root = all.find((span) => !span.parent_id || !byId.has(span.parent_id)) ?? all[0]

    // Each span's top: its ancestor that is a child of the root (or a span with no known parent).
    const topOf = (span: TraceSpan): TraceSpan => {
        let current = span
        const visited = new Set<string>()
        while (current.parent_id && current.parent_id !== root.span_id) {
            const parent = byId.get(current.parent_id)
            if (!parent || visited.has(parent.span_id)) break
            visited.add(current.span_id)
            current = parent
        }
        return current
    }

    const tops = all.filter((span) => span !== root && topOf(span) === span)
    const starts = tops.filter((span) => hasUserMessage(extractInputs(span)))
    if (starts.length === 0) return [turnOf(root.span_id, all)]

    // The turn of each top: the last turn start at or before it, else the first turn.
    const turnIndex = new Map<string, number>()
    let current = 0
    for (const top of tops) {
        const found = starts.indexOf(top)
        if (found !== -1) current = found
        turnIndex.set(top.span_id, current)
    }
    const members: TraceSpan[][] = starts.map(() => [])
    for (const span of all) {
        if (span === root) continue
        members[turnIndex.get(topOf(span).span_id) ?? 0].push(span)
    }
    return starts.map((start, index) => turnOf(start.span_id, members[index]))
}
