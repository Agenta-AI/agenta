/**
 * The one turn rule of a trace: a turn starts at each child of the root span whose input brings a
 * new user message, and holds the spans up to the next turn. The drawer places tool calls per turn
 * with it, and the trace tree groups its rows by it. Pure: no React, no request.
 *
 * @packageDocumentation
 */

import {parseStructuredJson, readValueMessage} from "@agenta/shared/utils"

import {extractInputs} from "../utils/selectors"

import type {TraceSpan} from "./schema"

export interface TraceTurn {
    /**
     * The span whose input holds the user message (a child of the root). The root only when no
     * child of the root holds a user message (then the trace is one turn).
     */
    spanId: string
    /** Every span of the turn, by start time. */
    spans: TraceSpan[]
    /**
     * The earliest start and the latest end of the turn's spans, in ms; null when none has one.
     * `endTime` is also null while a span of the turn has started and not ended (a running turn).
     */
    startTime: number | null
    endTime: number | null
    /** The text of the last user message in the input of the span that starts the turn; null when none. */
    userText: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const timeOf = (value: unknown): number | null => {
    if (typeof value !== "string" && typeof value !== "number") return null
    const ms = new Date(value).getTime()
    return Number.isFinite(ms) ? ms : null
}

/** The messages with the role `user` a value holds, in order, at any depth (JSON text included). */
const userMessagesOf = (value: unknown, depth = 0, found: unknown[] = []): unknown[] => {
    if (depth > 6) return found
    if (typeof value === "string") {
        const parsed = /^\s*[[{]/.test(value) ? parseStructuredJson(value) : null
        if (parsed !== null && typeof parsed === "object") userMessagesOf(parsed, depth + 1, found)
    } else if (Array.isArray(value)) {
        for (const item of value) userMessagesOf(item, depth + 1, found)
    } else if (isRecord(value)) {
        if (value.role === "user") found.push(value)
        else for (const item of Object.values(value)) userMessagesOf(item, depth + 1, found)
    }
    return found
}

/** What a span's input says of the chat so far: how many user messages, and the last one. */
interface UserHistory {
    count: number
    /** The last user message, as text when it has text, else as JSON. */
    lastKey: string
    lastText: string | null
}

const userHistoryOf = (span: TraceSpan): UserHistory | null => {
    const messages = userMessagesOf(extractInputs(span))
    const last = messages.at(-1)
    if (last === undefined) return null
    const text = readValueMessage(last).text.trim()
    return {
        count: messages.length,
        lastKey: text || JSON.stringify((last as Record<string, unknown>).content ?? null),
        lastText: text || null,
    }
}

/**
 * True when a span brings a user message the previous turn start did not have: more user
 * messages, or another last one. An LLM call that only carries the history of its exchange (as
 * the next call of an agent does) starts no turn. The limit: a user who sends the same text twice
 * in a row, in spans that hold only that message, gets one turn for both.
 */
const bringsNewUserMessage = (history: UserHistory, previous: UserHistory | undefined) =>
    !previous || history.count > previous.count || history.lastKey !== previous.lastKey

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

/** By start time; a span with no start time sorts last. */
const byStart = (a: TraceSpan, b: TraceSpan) => {
    const left = timeOf(a.start_time)
    const right = timeOf(b.start_time)
    if (left === null || right === null) return (left === null ? 1 : 0) - (right === null ? 1 : 0)
    return left - right
}

const turnOf = (spanId: string, spans: TraceSpan[], userText: string | null): TraceTurn => {
    const starts = spans.map((span) => timeOf(span.start_time)).filter((ms) => ms !== null)
    const ends = spans.map((span) => timeOf(span.end_time)).filter((ms) => ms !== null)
    const running = spans.some(
        (span) => timeOf(span.start_time) !== null && timeOf(span.end_time) === null,
    )
    return {
        spanId,
        spans,
        startTime: starts.length ? Math.min(...starts) : null,
        endTime: ends.length && !running ? Math.max(...ends) : null,
        userText,
    }
}

/**
 * Split a trace into its user turns. A turn starts at a child of the root that brings a new user
 * message (see `bringsNewUserMessage`); a child that repeats the history of the turn before joins
 * that turn. Spans before the first turn join the first turn; the root span is in no turn when
 * there are turns. A trace with no such child is one turn with every span. Takes a flat list or
 * the nested spans of a trace response.
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
    const starts: TraceSpan[] = []
    const histories: UserHistory[] = []
    for (const top of tops) {
        const history = userHistoryOf(top)
        if (history && bringsNewUserMessage(history, histories.at(-1))) {
            starts.push(top)
            histories.push(history)
        }
    }
    if (starts.length === 0) {
        return [turnOf(root.span_id, all, userHistoryOf(root)?.lastText ?? null)]
    }

    // The turn of each top: the last turn start at or before it, else the first turn.
    const startIndex = new Map(starts.map((start, index) => [start.span_id, index]))
    const turnIndex = new Map<string, number>()
    let current = 0
    for (const top of tops) {
        current = startIndex.get(top.span_id) ?? current
        turnIndex.set(top.span_id, current)
    }
    const members: TraceSpan[][] = starts.map(() => [])
    for (const span of all) {
        if (span === root) continue
        members[turnIndex.get(topOf(span).span_id) ?? 0].push(span)
    }
    return starts.map((start, index) =>
        turnOf(start.span_id, members[index], histories[index].lastText),
    )
}
