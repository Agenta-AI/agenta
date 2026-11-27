import {groupTraceTurns, type TraceSpan, type TracesResponse} from "@agenta/entities/trace"
import type {ToolUIPart} from "ai"

import type {ActivityStep} from "../model/activitySteps"

import type {TurnActivity} from "./MessagesValue"

type Loose = Record<string, unknown>

const record = (value: unknown): Loose | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Loose) : null

const at = (value: unknown, path: string[]): unknown =>
    path.reduce<unknown>((current, key) => record(current)?.[key], value)

const timeOf = (value: unknown): number | null => {
    if (typeof value === "number") return value
    if (typeof value !== "string") return null
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
}

/** The top spans of a trace response; their children stay nested under `spans`. */
const rootSpans = (trace: TracesResponse | null | undefined): TraceSpan[] =>
    Object.values(trace?.traces ?? {}).flatMap((entry) => Object.values(entry.spans ?? {}))

/** The tool's own name: the span's tool attribute, else its span name without the operation. */
const toolName = (span: TraceSpan): string => {
    const attributes = span.attributes as unknown
    const named =
        at(attributes, ["ag", "meta", "tool", "name"]) ?? at(attributes, ["gen_ai", "tool", "name"])
    if (typeof named === "string" && named) return named
    return (span.span_name ?? "tool").replace(/^execute_tool\s+/, "")
}

const durationOf = (span: TraceSpan): number | undefined => {
    const recorded = at(span.attributes, ["ag", "metrics", "duration", "cumulative"])
    if (typeof recorded === "number") return recorded
    const start = timeOf(span.start_time)
    const end = timeOf(span.end_time)
    return start !== null && end !== null ? end - start : undefined
}

/** One tool span as the settled step `ActivityTimeline` draws: input, result or error, duration. */
const toolStep = (span: TraceSpan): ActivityStep => {
    const failed = span.status_code === "STATUS_CODE_ERROR"
    const data = at(span.attributes, ["ag", "data"])
    const callId = at(span.attributes, ["ag", "meta", "tool", "call", "id"])
    const id = typeof callId === "string" && callId ? callId : span.span_id
    const part = {
        type: `tool-${toolName(span)}`,
        toolCallId: id,
        input: at(data, ["inputs"]),
        ...(failed
            ? {state: "output-error", errorText: span.status_message ?? ""}
            : {state: "output-available", output: at(data, ["outputs"])}),
    } as unknown as ToolUIPart
    return {kind: "tool", key: span.span_id, part, files: [], durationMs: durationOf(span)}
}

/**
 * The work of each user turn of a trace, for `ValueField`'s `turnActivity`: the turn's tool
 * calls in the order they started, and the turn's time. One entry per turn of
 * `groupTraceTurns`, so the entries line up with the chat's user exchanges.
 */
export function toolStepsFromTrace(trace: TracesResponse | null | undefined): TurnActivity[] {
    return groupTraceTurns(rootSpans(trace)).map((turn) => ({
        steps: turn.spans.filter((span) => span.span_type === "tool").map(toolStep),
        durationMs:
            turn.startTime !== null && turn.endTime !== null
                ? turn.endTime - turn.startTime
                : undefined,
    }))
}
