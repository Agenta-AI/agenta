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
    mountFileContentResponseSchema,
    mountFileListResponseSchema,
    sessionInteractionResponseSchema,
    sessionInteractionsResponseSchema,
    sessionRecordsQueryResponseSchema,
    sessionStreamCommandResponseSchema,
    sessionMountsResponseSchema,
    sessionStreamResponseSchema,
    sessionStreamsResponseSchema,
    type MountFile,
    type Mount,
    type SessionInteraction,
    type SessionInteractionKind,
    type SessionInteractionStatusCode,
    type SessionRecord,
    type SessionStream,
    type SessionStreamCommandResponse,
} from "../core/schema"

import {
    callFern,
    getLowPriorityMountsClient,
    getLowPrioritySessionsClient,
    getMountsClient,
    getSessionsClient,
    projectScopedRequest,
} from "./client"

export interface QueryRecordsParams {
    sessionId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
    /** Send with the `priority: "low"` fetch hint — for replay hydration that must yield to the
     * live conversation stream (Chromium schedules it behind render-critical traffic). */
    lowPriority?: boolean
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
    lowPriority,
}: QueryRecordsParams): Promise<SessionRecord[] | null> {
    if (!projectId || !sessionId) return null

    const client = lowPriority ? getLowPrioritySessionsClient() : getSessionsClient()
    const data = await callFern("[querySessionRecords]", () =>
        client.queryRecords(
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
    lowPriority,
}: Omit<SessionScopedParams, "sessionId"> & {
    sessionId?: string
    isAlive?: boolean
    isRunning?: boolean
    lowPriority?: boolean
}): Promise<SessionStream[] | null> {
    if (!projectId) return null

    const client = lowPriority ? getLowPrioritySessionsClient() : getSessionsClient()
    const data = await callFern("[querySessionStreams]", () =>
        client.querySessionStreams(
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
    lowPriority,
}: SessionScopedParams & {lowPriority?: boolean}): Promise<SessionStream | null> {
    if (!projectId || !sessionId) return null

    const client = lowPriority ? getLowPrioritySessionsClient() : getSessionsClient()
    const data = await callFern("[fetchSessionStream]", () =>
        client.fetchSessionStream(
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
 *
 * FOLLOWUP(sessions,lifecycle): steer/cancel/attach are NOT surfaced in the user-facing chat on
 * purpose — on the product path they only edit Redis locks; the runner doesn't cooperatively
 * cancel/steer, and there's no live-turn re-watch, so wiring them into chat would be a no-op stub.
 * The chat's send/stop (via `/invoke` + useChat abort) and `killSession` are the real ops. Revisit
 * when the runner cooperates. See docs/designs/sessions/frontend-integration.md.
 */
export async function commandSessionStream({
    sessionId,
    projectId,
    appId,
    abortSignal,
    force,
    detached,
}: CommandSessionStreamParams): Promise<SessionStreamCommandResponse | null> {
    if (!projectId || !sessionId) return null

    // The prompt→request.data (inputs) mapping is defined by the sessions feature owner when the send path gets wired (see PR #5375 body).
    const data = await callFern("[commandSessionStream]", () =>
        getSessionsClient().setSessionStream(
            {session_id: sessionId, force, detached},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    return (
        safeParseWithLogging(sessionStreamCommandResponseSchema, data, "[commandSessionStream]") ??
        null
    )
}

/**
 * KILL — end a session: collapse the stream nest, force-clear the runner's alive lock (its
 * existing teardown signal, so the sandbox tears down), mark the row ended, and cancel every
 * pending interaction. Idempotent — a kill on an already-dead session is a no-op success.
 * Returns `true` on success, `false` on failure/missing scope.
 */
export async function killSession({
    sessionId,
    projectId,
    appId,
    abortSignal,
}: SessionScopedParams): Promise<boolean> {
    if (!projectId || !sessionId) return false

    const data = await callFern("[killSession]", () =>
        getSessionsClient().deleteSessionStream(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    return data !== null
}

/** List the mounts (drives) bound to one session. Returns `null` on failure/missing scope. */
export async function querySessionMounts({
    sessionId,
    projectId,
    appId,
    abortSignal,
    lowPriority,
}: {
    sessionId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
    lowPriority?: boolean
}): Promise<Mount[] | null> {
    if (!projectId || !sessionId) return null

    const client = lowPriority ? getLowPrioritySessionsClient() : getSessionsClient()
    const data = await callFern("[querySessionMounts]", () =>
        client.querySessionMounts(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        sessionMountsResponseSchema,
        data,
        "[querySessionMounts]",
    )
    return validated?.mounts ?? null
}

export interface MountFilesParams {
    mountId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
    /** Scope the listing to a sub-path (still recursive under it). Omit for the whole mount. */
    path?: string
    lowPriority?: boolean
}

/**
 * List a mount's durable files. The backend returns the WHOLE tree under the prefix (no server-side
 * one-level delimiter), so `deriveMountRows` folds it into a one-level browse view client-side.
 * Returns `null` on failure/missing scope.
 */
export async function queryMountFiles({
    mountId,
    projectId,
    appId,
    abortSignal,
    path,
    lowPriority,
}: MountFilesParams): Promise<MountFile[] | null> {
    if (!projectId || !mountId) return null

    const client = lowPriority ? getLowPriorityMountsClient() : getMountsClient()
    const data = await callFern("[queryMountFiles]", () =>
        client.getMountFiles(
            {mount_id: mountId, path},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(mountFileListResponseSchema, data, "[queryMountFiles]")
    return validated?.files ?? null
}

/** Read one mount file's text content (`?read=<path>`). Returns `null` on failure/missing scope. */
export async function readMountFile({
    mountId,
    projectId,
    appId,
    abortSignal,
    path,
}: Omit<MountFilesParams, "path" | "lowPriority"> & {path: string}): Promise<string | null> {
    if (!projectId || !mountId || !path) return null

    const data = await callFern("[readMountFile]", () =>
        getMountsClient().getMountFiles(
            {mount_id: mountId, read: path},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(mountFileContentResponseSchema, data, "[readMountFile]")
    return validated?.content ?? null
}
