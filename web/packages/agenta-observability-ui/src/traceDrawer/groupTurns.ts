/**
 * The turns of a conversation trace, for the tree's "Group turns" view. A turn starts at each
 * child of the root span whose input holds a user message; the spans up to the next turn sit
 * under it. Pure: no React.
 *
 * @packageDocumentation
 */

import {getAgDataInputs, type TraceSpanNode} from "@agenta/observability"
import {isChatMessagesArray, readValueMessage} from "@agenta/shared/utils"

export interface TraceTurn {
    /** 1 for the first turn. */
    index: number
    /** The user's message that opens the turn. */
    message: string
    /** The spans of the turn: the span with the message, then the ones up to the next turn. */
    spans: TraceSpanNode[]
    /** From the first span's start to the last span's end, in milliseconds; null while running. */
    durationMs: number | null
}

export interface TraceTurns {
    /** Children of the root that come before the first turn. */
    leading: TraceSpanNode[]
    turns: TraceTurn[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** The text of the last user message in a list of messages, or null. */
const lastUserText = (messages: unknown[]): string | null => {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = readValueMessage(messages[index])
        if (message.role === "user" && message.text.trim()) return message.text.trim()
    }
    return null
}

/**
 * The user message in a span's input: the input itself as messages or one message, or a list
 * of messages under one of its keys.
 */
export function userMessageOf(span: TraceSpanNode): string | null {
    const inputs = getAgDataInputs(span)
    if (isChatMessagesArray(inputs)) return lastUserText(inputs)
    if (!isRecord(inputs)) return null
    if (typeof inputs.role === "string") return lastUserText([inputs])
    for (const value of Object.values(inputs)) {
        if (isChatMessagesArray(value)) {
            const text = lastUserText(value)
            if (text) return text
        }
    }
    return null
}

const timeOf = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined || value === "") return null
    const time = typeof value === "number" ? value : Date.parse(value)
    return Number.isFinite(time) ? time : null
}

const turnDuration = (spans: TraceSpanNode[]): number | null => {
    const start = timeOf(spans[0]?.start_time)
    const end = timeOf(spans[spans.length - 1]?.end_time)
    return start === null || end === null ? null : Math.max(0, end - start)
}

/**
 * The turns under a trace's root span. Null when the root has fewer than two turns: the tree
 * then has nothing to group, and the switch is disabled.
 */
export function groupTurns(root: TraceSpanNode | null | undefined): TraceTurns | null {
    const children = (root?.children ?? []) as TraceSpanNode[]
    const leading: TraceSpanNode[] = []
    const turns: TraceTurn[] = []
    for (const child of children) {
        const message = userMessageOf(child)
        if (message) {
            turns.push({index: turns.length + 1, message, spans: [child], durationMs: null})
        } else if (turns.length > 0) {
            turns[turns.length - 1].spans.push(child)
        } else {
            leading.push(child)
        }
    }
    if (turns.length < 2) return null
    for (const turn of turns) turn.durationMs = turnDuration(turn.spans)
    return {leading, turns}
}
