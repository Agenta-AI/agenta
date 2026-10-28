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
 * The figures stored on a turn row: tokens and cost from its usage, latency from its start and
 * end. `undefined` when the turn has no usage yet, so the caller can fall back to another source.
 * A null usage field stays undefined (unknown), never 0.
 */
export const turnFigures = (turn: SessionTurn): TurnFigures | undefined => {
    const usage = turn.usage
    if (!usage) return undefined
    const figures: TurnFigures = {}
    const prompt = num(usage.input_tokens)
    const completion = num(usage.output_tokens)
    const total = num(usage.total_tokens)
    const cost = num(usage.cost)
    if (prompt !== undefined) figures.promptTokens = prompt
    if (completion !== undefined) figures.completionTokens = completion
    if (total !== undefined) figures.totalTokens = total
    if (cost !== undefined) figures.totalCost = cost
    const start = turn.start_time ? Date.parse(turn.start_time) : NaN
    const end = turn.end_time ? Date.parse(turn.end_time) : NaN
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        figures.durationMs = end - start
    }
    return figures
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

const RECENT_END_MS = 120_000

/**
 * Whether the turns may still change: a turn is running, or one ended recently without a
 * priced usage (the trace write-back fills it after ingest).
 */
export const turnsMayChange = (turns: SessionTurn[], now: number = Date.now()): boolean =>
    turns.some((turn) => {
        if (!turn.end_time) return true
        const ended = Date.parse(turn.end_time)
        const recent = Number.isFinite(ended) && now - ended < RECENT_END_MS
        return recent && num(turn.usage?.cost) === undefined
    })
