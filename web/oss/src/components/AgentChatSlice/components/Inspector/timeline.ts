/**
 * Records → timeline model (build-spec §5). Pure: turns the backend event log into typed events
 * grouped by turn. Turn boundaries come from `done` events (records carry no turn_id — verified
 * at the backend DTO; the runner writes a flat log delimited by `done`), so "Turn N" is the Nth
 * done-delimited group in ingest (`created_at`) order — NOT record_index, which resets per turn.
 * Cross-device: reads the durable records, never live useChat state.
 */
import type {SessionRecord} from "@agenta/entities/session"

export type TimelineEventType =
    | "message"
    | "thought"
    | "tool_call"
    | "tool_result"
    | "interaction_request"
    | "done"
    | "error"
    | "other"

/** Colors + chip labels per event type (build-spec §5). */
export const EVENT_META: Record<TimelineEventType, {dot: string; chip: string}> = {
    message: {dot: "#9aa0a6", chip: "message"},
    thought: {dot: "#b98cff", chip: "thought"},
    tool_call: {dot: "#7fb0ff", chip: "tool_call"},
    tool_result: {dot: "#4fd1b5", chip: "tool_result"},
    interaction_request: {dot: "#e0b050", chip: "interaction"},
    done: {dot: "#8fd07a", chip: "done"},
    error: {dot: "#f0857c", chip: "error"},
    other: {dot: "#9aa0a6", chip: "event"},
}

const KNOWN: TimelineEventType[] = [
    "message",
    "thought",
    "tool_call",
    "tool_result",
    "interaction_request",
    "done",
    "error",
]

/** The event type from a record: `session_update` (record_type) is authoritative; fall back to
 * the payload's own `type` (streaming shards echo it). */
export function recordEventType(record: SessionRecord): TimelineEventType {
    const raw =
        record.session_update ??
        (record.payload && typeof record.payload === "object"
            ? (record.payload as {type?: string}).type
            : undefined)
    const base = (raw ?? "").replace(/_(start|delta)$/, "")
    return (KNOWN as string[]).includes(base) ? (base as TimelineEventType) : "other"
}

export interface TimelineEvent {
    id: string
    index: number
    type: TimelineEventType
    /** `user` | `agent` — record_source. */
    source: string | null
    payload: unknown
    at: number | null
    /** 1-based turn this event belongs to. */
    turn: number
    /** Human tool label for tool_call/tool_result rows (filled by the view via resolveToolDisplay). */
    toolName?: string
}

export interface TurnGroup {
    /** 1-based. */
    turn: number
    events: TimelineEvent[]
    startAt: number | null
    endAt: number | null
    status: "ok" | "error" | "running"
}

const toMs = (ts: string | null | undefined): number | null => {
    if (!ts) return null
    const t = Date.parse(ts)
    return Number.isNaN(t) ? null : t
}

/** Ordered events with their turn number, plus the grouped turns. Streaming shard events
 * (`*_start`/`*_delta`) are collapsed into their base type but kept as rows so a live turn is
 * visible; a turn closes on `done`. Events after the last `done` form a trailing (running) turn. */
export function buildTimeline(records: SessionRecord[] | null | undefined): {
    events: TimelineEvent[]
    turns: TurnGroup[]
} {
    // Mirror the backend read order (dao: `created_at asc, record_index asc`). `record_index`
    // (= event_index) RESETS per turn (runner counter, persist.ts), so sorting on it alone
    // interleaves turns (turn1.idx1, turn2.idx1, turn1.idx2, …) and breaks done-delimiting.
    // created_at (ingest time) is the true global order; event_index only tiebreaks within a turn.
    const sorted = [...(records ?? [])].sort((a, b) => {
        const ta = toMs(a.created_at)
        const tb = toMs(b.created_at)
        if (ta != null && tb != null && ta !== tb) return ta - tb
        return (a.event_index ?? 0) - (b.event_index ?? 0)
    })
    const events: TimelineEvent[] = []
    let turn = 1
    for (const record of sorted) {
        const type = recordEventType(record)
        events.push({
            id: record.id,
            index: record.event_index ?? events.length,
            type,
            source: record.sender ?? null,
            payload: record.payload,
            at: toMs(record.created_at),
            turn,
        })
        if (type === "done") turn += 1
    }

    const byTurn = new Map<number, TimelineEvent[]>()
    for (const e of events) {
        const list = byTurn.get(e.turn)
        if (list) list.push(e)
        else byTurn.set(e.turn, [e])
    }
    const turns: TurnGroup[] = [...byTurn.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([n, evts]) => {
            const times = evts.map((e) => e.at).filter((t): t is number => t != null)
            const hasError = evts.some((e) => e.type === "error")
            const hasDone = evts.some((e) => e.type === "done")
            return {
                turn: n,
                events: evts,
                startAt: times.length ? Math.min(...times) : null,
                endAt: times.length ? Math.max(...times) : null,
                status: hasError ? "error" : hasDone ? "ok" : "running",
            }
        })
    return {events, turns}
}

/** Relative offset label from a reference time, e.g. `+1.4s` (build-spec §5). */
export function relOffset(at: number | null, from: number | null): string {
    if (at == null || from == null) return ""
    const d = (at - from) / 1000
    if (Math.abs(d) < 0.05) return "+0s"
    return `${d >= 0 ? "+" : ""}${d.toFixed(1)}s`
}

/** Duration between a tool_call and its matching tool_result (by call id), e.g. `820ms`. */
export function toolDuration(callAt: number | null, resultAt: number | null): string {
    if (callAt == null || resultAt == null) return ""
    const ms = resultAt - callAt
    if (ms < 0) return ""
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function formatWallClock(at: number | null): string {
    if (at == null) return ""
    const d = new Date(at)
    return d.toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit", second: "2-digit"})
}
