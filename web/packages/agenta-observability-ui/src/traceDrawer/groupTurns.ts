/**
 * The rows of the tree's "Group turns" view, built on the one turn rule of a trace
 * (`groupTraceTurns`): one row per turn, holding the children of the root span that belong to
 * it. Pure: no React.
 *
 * @packageDocumentation
 */

import {groupTraceTurns, type TraceSpan} from "@agenta/entities/trace"
import type {TraceSpanNode} from "@agenta/observability"

export interface TraceTurnRow {
    /** 1 for the first turn. */
    index: number
    /** The user's message that opens the turn; null when it cannot be read. */
    message: string | null
    /** The span whose input holds the message. */
    spanId: string
    /** The children of the root span in this turn, in tree order. */
    spans: TraceSpanNode[]
    /** From the first start to the last end of the turn's spans, in ms; null while running. */
    durationMs: number | null
}

const flatten = (node: TraceSpanNode): TraceSpanNode[] => [
    node,
    ...((node.children ?? []) as TraceSpanNode[]).flatMap(flatten),
]

/** The number of turns of a trace; 1 for a trace with no user turn. */
export const countTurns = (root: TraceSpanNode | null | undefined): number =>
    root ? Math.max(1, groupTraceTurns(flatten(root) as unknown as TraceSpan[]).length) : 0

/**
 * The turn rows under a tree's root. `turnsOf` is the trace the turns are read from (the whole
 * trace); `root` is the tree drawn (it may be filtered by search or key spans). Null when the
 * trace has fewer than two turns: there is nothing to group.
 */
export function groupTurns(
    root: TraceSpanNode | null | undefined,
    turnsOf: TraceSpanNode | null | undefined = root,
): TraceTurnRow[] | null {
    if (!root || !turnsOf) return null
    const all = flatten(turnsOf)
    const turns = groupTraceTurns(all as unknown as TraceSpan[])
    if (turns.length < 2) return null
    const children = (root.children ?? []) as TraceSpanNode[]
    return turns.map((turn, index) => {
        const members = new Set(turn.spans.map((span) => span.span_id))
        return {
            index: index + 1,
            message: turn.userText,
            spanId: turn.spanId,
            spans: children.filter((child) => members.has(child.span_id)),
            // The shared rule gives no end while a span of the turn runs.
            durationMs:
                turn.startTime !== null && turn.endTime !== null
                    ? Math.max(0, turn.endTime - turn.startTime)
                    : null,
        }
    })
}
