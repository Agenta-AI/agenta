import type {SessionTurn} from "./schema"

/** A turn's figures in `ExecutionMetricsDisplay`'s field names. A missing field is unknown. */
export interface TurnFigures {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    totalCost?: number
    durationMs?: number
}

/** Trace ids arrive as a UUID (turn rows) or as 32 hex characters (messages, spans). */
export const normalizeTraceId = (traceId: string | null | undefined): string =>
    (traceId ?? "").replace(/-/g, "").toLowerCase()

const num = (value: number | null | undefined): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined

/**
 * The figures stored on a turn row: latency from its start and end whenever both exist, tokens
 * and cost from its usage. `undefined` when the row knows none of them. A null usage field stays
 * undefined (unknown), never 0.
 */
export const turnFigures = (turn: SessionTurn): TurnFigures | undefined => {
    const figures: TurnFigures = {}
    const start = turn.start_time ? Date.parse(turn.start_time) : NaN
    const end = turn.end_time ? Date.parse(turn.end_time) : NaN
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        figures.durationMs = end - start
    }
    const usage = turn.usage
    const prompt = num(usage?.input_tokens)
    const completion = num(usage?.output_tokens)
    const total = num(usage?.total_tokens)
    const cost = num(usage?.cost)
    if (prompt !== undefined) figures.promptTokens = prompt
    if (completion !== undefined) figures.completionTokens = completion
    if (total !== undefined) figures.totalTokens = total
    if (cost !== undefined) figures.totalCost = cost
    return Object.keys(figures).length > 0 ? figures : undefined
}

/** The turns of a session keyed by normalized trace id. A turn without a trace is left out. */
export const turnsByTraceId = (turns: SessionTurn[]): Map<string, SessionTurn> => {
    const byTrace = new Map<string, SessionTurn>()
    for (const turn of turns) {
        const key = normalizeTraceId(turn.trace_id)
        if (key) byTrace.set(key, turn)
    }
    return byTrace
}

// Polling bounds. A running turn is watched for 30 minutes from its start, so a turn that never
// ends (stopped, crashed, an older runner) stops the polling. An ended turn is watched for 2
// minutes for its usage from the trace, which ingest writes over any runner value.
const RUNNING_WATCH_MS = 30 * 60_000
const ENDED_WATCH_MS = 2 * 60_000

/** Whether the turns may still change within the polling bounds above. */
export const turnsMayChange = (turns: SessionTurn[], now: number = Date.now()): boolean =>
    turns.some((turn) => {
        if (!turn.end_time) {
            const started = turn.start_time ? Date.parse(turn.start_time) : NaN
            return Number.isFinite(started) && now - started < RUNNING_WATCH_MS
        }
        const ended = Date.parse(turn.end_time)
        return Number.isFinite(ended) && now - ended < ENDED_WATCH_MS
    })
