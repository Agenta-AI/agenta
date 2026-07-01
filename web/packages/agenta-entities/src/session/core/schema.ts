/**
 * Zod boundary schemas for the durable Sessions API.
 *
 * Fern's compile-time types under-declare backend `extra="allow"` fields, so a local
 * schema still has independent drift-detection value (see `web/CLAUDE.md`). Kept loose:
 * `payload` is the opaque ACP `AgentEvent`, validated structurally by the consumer.
 *
 * The durable append-only event log the backend calls "records" (formerly "transcripts").
 */
import {z} from "zod"

/** One durable, append-only record event row. `payload` is the ACP `AgentEvent`. */
export const sessionRecordSchema = z.object({
    id: z.string(),
    session_id: z.string(),
    project_id: z.string(),
    event_index: z.number().nullish(),
    sender: z.string().nullish(),
    session_update: z.string().nullish(),
    payload: z.record(z.string(), z.unknown()).nullish(),
    created_at: z.string().nullish(),
})

export const sessionRecordsQueryResponseSchema = z.object({
    count: z.number(),
    records: z.array(sessionRecordSchema),
})

export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type SessionRecordsQueryResponse = z.infer<typeof sessionRecordsQueryResponseSchema>

/** Durable SDK record + sandbox resume pointer. `data` is the opaque SDK `SessionRecord`. */
export const sessionStateSchema = z.object({
    session_id: z.string(),
    data: z.record(z.string(), z.unknown()).nullish(),
    sandbox_id: z.string().nullish(),
    id: z.string().nullish(),
    project_id: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
})

export const sessionStateResponseSchema = z.object({
    count: z.number().nullish(),
    session_state: sessionStateSchema.nullish(),
})

export type SessionState = z.infer<typeof sessionStateSchema>

/** A HITL request raised mid-run. `status.code` carries the lifecycle (pending/responded/…). */
export const sessionInteractionSchema = z.object({
    id: z.string().nullish(),
    session_id: z.string(),
    run_id: z.string().nullish(),
    token: z.string(),
    kind: z.string(),
    status: z
        .object({
            code: z.string().nullish(),
            type: z.string().nullish(),
            message: z.string().nullish(),
        })
        .nullish(),
    data: z
        .object({
            request: z.record(z.string(), z.unknown()).nullish(),
            references: z.record(z.string(), z.unknown()).nullish(),
            selector: z.record(z.string(), z.unknown()).nullish(),
            resolution: z.record(z.string(), z.unknown()).nullish(),
        })
        .nullish(),
})

export const sessionInteractionsResponseSchema = z.object({
    count: z.number().nullish(),
    interactions: z.array(sessionInteractionSchema).nullish(),
})

export const sessionInteractionResponseSchema = z.object({
    count: z.number().nullish(),
    interaction: sessionInteractionSchema.nullish(),
})

export type SessionInteraction = z.infer<typeof sessionInteractionSchema>

/** HITL lifecycle codes. `pending` is the only actionable state. */
export type SessionInteractionStatusCode = "pending" | "responded" | "resolved" | "cancelled"
export type SessionInteractionKind = "user_approval" | "user_input" | "client_tool"

/**
 * A live stream handle. Liveness rides `flags` (nested: alive ⊇ running ⊇ attached);
 * `resumable` (alive & !running) and `reattachable` (running & !attached) are derived
 * client-side.
 */
export const sessionStreamSchema = z.object({
    id: z.string(),
    project_id: z.string(),
    session_id: z.string(),
    turn_id: z.string().nullish(),
    status: z.object({code: z.string().nullish(), message: z.string().nullish()}).nullish(),
    flags: z
        .object({
            is_alive: z.boolean().nullish(),
            is_running: z.boolean().nullish(),
            is_attached: z.boolean().nullish(),
        })
        .nullish(),
})

export const sessionStreamsResponseSchema = z.object({
    count: z.number(),
    streams: z.array(sessionStreamSchema),
})

export const sessionStreamResponseSchema = z.object({
    stream: sessionStreamSchema.nullish(),
})

/** Control-call result for the prompt × force command matrix. */
export const sessionStreamCommandResponseSchema = z.object({
    mode: z.string(),
    session_id: z.string(),
    turn_id: z.string().nullish(),
    watcher_id: z.string().nullish(),
    detached: z.boolean().nullish(),
})

export type SessionStream = z.infer<typeof sessionStreamSchema>
export type SessionStreamCommandResponse = z.infer<typeof sessionStreamCommandResponseSchema>

/** Stream lifecycle codes from `SessionStream.status.code`. */
export type StreamStatusCode = "running" | "detached" | "idle" | "ended"
/** Stream command modes (prompt × force matrix). */
export type CommandMode = "send" | "steer" | "cancel" | "attach"
