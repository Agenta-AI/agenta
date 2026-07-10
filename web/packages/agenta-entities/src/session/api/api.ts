/**
 * Durable Sessions API functions (PR #4916 + #4937/#4938).
 *
 * @example
 * ```typescript
 * import {querySessionRecords} from "@agenta/entities/session"
 *
 * const events = await querySessionRecords({sessionId, projectId})
 * ```
 */
import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {
    sessionInteractionResponseSchema,
    sessionInteractionsResponseSchema,
    sessionRecordsQueryResponseSchema,
    sessionStateResponseSchema,
    sessionStreamCommandResponseSchema,
    sessionStreamResponseSchema,
    sessionStreamsResponseSchema,
    type SessionInteraction,
    type SessionInteractionKind,
    type SessionInteractionStatusCode,
    type SessionRecord,
    type SessionState,
    type SessionStream,
    type SessionStreamCommandResponse,
} from "../core/schema"

import {callFern, getSessionsClient, projectScopedRequest} from "./client"

export interface QueryRecordsParams {
    sessionId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
}

/**
 * Fetch a session's durable, append-only record log — the replay source for rendering a
 * conversation. Returns events ordered by the backend (uuid7 `id`); `null` on failure or
 * when the project scope is missing.
 */
export async function querySessionRecords({
    sessionId,
    projectId,
    appId,
    abortSignal,
}: QueryRecordsParams): Promise<SessionRecord[] | null> {
    if (!projectId || !sessionId) return null

    const data = await callFern("[querySessionRecords]", () =>
        getSessionsClient().queryRecords(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        sessionRecordsQueryResponseSchema,
        data,
        "[querySessionRecords]",
    )
    return validated?.records ?? null
}

export interface SessionScopedParams {
    sessionId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
}

/**
 * Read a session's durable state: the opaque SDK `SessionRecord` + the `sandbox_id` resume
 * pointer. Read-only from the FE — the record is owned and written by the runner/SDK, so the
 * FE never calls `setState(data)` (it would clobber the runner's record). Returns `null` when
 * absent (no run has persisted state yet) or on failure.
 */
export async function getSessionState({
    sessionId,
    projectId,
    appId,
    abortSignal,
}: SessionScopedParams): Promise<SessionState | null> {
    if (!projectId || !sessionId) return null

    const data = await callFern("[getSessionState]", () =>
        getSessionsClient().getState(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(sessionStateResponseSchema, data, "[getSessionState]")
    return validated?.session_state ?? null
}

export interface QueryInteractionsParams extends SessionScopedParams {
    kind?: SessionInteractionKind
    status?: SessionInteractionStatusCode
    /** Only requests still awaiting an answer. */
    actionableOnly?: boolean
}

/**
 * List a session's HITL interactions (pending approvals etc.). Used to know whether a
 * record-rendered request is still actionable — NOT as the render source (the record renders
 * the question; interactions hold the answer-state).
 */
export async function queryInteractions({
    sessionId,
    projectId,
    appId,
    abortSignal,
    kind,
    status,
    actionableOnly,
}: QueryInteractionsParams): Promise<SessionInteraction[] | null> {
    if (!projectId || !sessionId) return null

    const data = await callFern("[queryInteractions]", () =>
        getSessionsClient().queryInteractions(
            {query: {session_id: sessionId, kind, status, actionable_only: actionableOnly}},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        sessionInteractionsResponseSchema,
        data,
        "[queryInteractions]",
    )
    return validated?.interactions ?? null
}

export interface InteractionScopedParams {
    interactionId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
}

/** Fetch one HITL interaction by id (live status check before rendering an action). */
export async function fetchInteraction({
    interactionId,
    projectId,
    appId,
    abortSignal,
}: InteractionScopedParams): Promise<SessionInteraction | null> {
    if (!projectId || !interactionId) return null

    const data = await callFern("[fetchInteraction]", () =>
        getSessionsClient().fetchInteraction(
            {interaction_id: interactionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        sessionInteractionResponseSchema,
        data,
        "[fetchInteraction]",
    )
    return validated?.interaction ?? null
}

export interface RespondInteractionParams extends InteractionScopedParams {
    /** The answer payload (e.g. an approval decision). Shape is interaction-kind specific. */
    answer: Record<string, unknown>
}

/**
 * Resolve a HITL interaction (approve/deny/input). Returns the updated record, or `null`.
 *
 * NOTE (2026-06): per JP, decoupled interactions are deferred/"not a priority" — approvals +
 * tool-calls currently flow through MESSAGES (the live `addToolApprovalResponse` +
 * `tool_approvals` transport path), which stays. This is the durable replacement, ready but
 * not yet wired (runner doesn't auto-create rows; respond doesn't transition status).
 */
export async function respondInteraction({
    interactionId,
    projectId,
    appId,
    abortSignal,
    answer,
}: RespondInteractionParams): Promise<SessionInteraction | null> {
    if (!projectId || !interactionId) return null

    const data = await callFern("[respondInteraction]", () =>
        getSessionsClient().respondInteraction(
            {interaction_id: interactionId, answer},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        sessionInteractionResponseSchema,
        data,
        "[respondInteraction]",
    )
    return validated?.interaction ?? null
}

/**
 * List a session's live stream handles — liveness rides each stream's `flags`
 * (`is_alive`/`is_running`/`is_attached`). Drives attach/detach + "someone else is running
 * this" UI. Pass no `sessionId` to list across the project. Returns `null` on failure.
 */
export async function querySessionStreams({
    sessionId,
    projectId,
    appId,
    abortSignal,
    isAlive,
    isRunning,
}: Omit<SessionScopedParams, "sessionId"> & {
    sessionId?: string
    isAlive?: boolean
    isRunning?: boolean
}): Promise<SessionStream[] | null> {
    if (!projectId) return null

    const data = await callFern("[querySessionStreams]", () =>
        getSessionsClient().querySessionStreams(
            {session_id: sessionId, is_alive: isAlive, is_running: isRunning},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        sessionStreamsResponseSchema,
        data,
        "[querySessionStreams]",
    )
    return validated?.streams ?? null
}

/** Fetch a session's current stream handle (liveness/attach state). Returns `null` if none. */
export async function fetchSessionStream({
    sessionId,
    projectId,
    appId,
    abortSignal,
}: SessionScopedParams): Promise<SessionStream | null> {
    if (!projectId || !sessionId) return null

    const data = await callFern("[fetchSessionStream]", () =>
        getSessionsClient().fetchSessionStream(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        sessionStreamResponseSchema,
        data,
        "[fetchSessionStream]",
    )
    return validated?.stream ?? null
}

export interface CommandSessionStreamParams extends SessionScopedParams {
    prompt?: string
    /** Steal the run lock from whoever holds it. */
    force?: boolean
    /** Fire-and-forget: start the run without holding a connection. */
    detached?: boolean
}

/**
 * CONTROL-PLANE call to start/resume/steer/cancel a run (the prompt × force matrix). Returns
 * a handle (`{mode, turn_id, watcher_id, …}`), NOT the token stream — the v6 chunk stream is
 * delivered out-of-band (see the agent-chat transport). Use `force` to steal the lock,
 * `detached` for fire-and-forget.
 */
export async function commandSessionStream({
    sessionId,
    projectId,
    appId,
    abortSignal,
    prompt,
    force,
    detached,
}: CommandSessionStreamParams): Promise<SessionStreamCommandResponse | null> {
    if (!projectId || !sessionId) return null

    const data = await callFern("[commandSessionStream]", () =>
        getSessionsClient().setSessionStream(
            {session_id: sessionId, prompt, force, detached},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    return (
        safeParseWithLogging(sessionStreamCommandResponseSchema, data, "[commandSessionStream]") ??
        null
    )
}
