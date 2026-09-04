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
import {z} from "zod"

import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {
    mountFileContentResponseSchema,
    mountFileListResponseSchema,
    sessionInteractionResponseSchema,
    sessionInteractionsResponseSchema,
    sessionRecordsQueryResponseSchema,
    sessionCancelExecutionResponseSchema,
    sessionsQueryResponseSchema,
    sessionStreamCommandResponseSchema,
    sessionStreamSchema,
    sessionMountsResponseSchema,
    sessionStreamResponseSchema,
    sessionStreamsResponseSchema,
    type MountFile,
    type Mount,
    type SessionInteraction,
    type SessionInteractionKind,
    type SessionInteractionStatusCode,
    type SessionRecord,
    type SessionExpansion,
    type SessionOrigin,
    type SessionStream,
    type SessionStreamCommandResponse,
    type SessionsQueryResponse,
    type SessionWindowing,
} from "../core/schema"

import {
    callFern,
    getLowPriorityMountsClient,
    getLowPrioritySessionsClient,
    getMountsClient,
    getSessionsClient,
    isAbortError,
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

export interface QueryInteractionsParams extends Omit<SessionScopedParams, "sessionId"> {
    /** Omit for a PROJECT-WIDE query — the backend treats `session_id` as optional, so one call
     * returns every matching interaction across the project (the pending-approvals badge
     * primitive). */
    sessionId?: string
    kind?: SessionInteractionKind
    status?: SessionInteractionStatusCode
    /** Only requests still awaiting an answer. */
    actionableOnly?: boolean
}

/**
 * List HITL interactions (pending approvals etc.) — one session's, or the whole project's when
 * `sessionId` is omitted. Used to know whether a record-rendered request is still actionable —
 * NOT as the render source (the record renders the question; interactions hold the answer-state).
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
    if (!projectId) return null

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

/** True for the backend's `409 Interaction is no longer pending` (someone already answered).
 * Fern stashes the HTTP status on the thrown `AgentaApiError` as `statusCode`. */
export const isInteractionConflict = (error: unknown): boolean =>
    (error as {statusCode?: number} | null)?.statusCode === 409

/** True for the backend's `404 No such file or folder`. */
const isNotFound = (error: unknown): boolean =>
    (error as {statusCode?: number} | null)?.statusCode === 404

export interface TransitionInteractionParams extends SessionScopedParams {
    token: string
    status: SessionInteractionStatusCode
    resolution?: Record<string, unknown>
}

/**
 * Write a row lifecycle transition by `session_id` + `token`, not row id.
 * Status and resolution stay atomic so the stale sweep cannot win between writes.
 */
export async function transitionInteraction({
    sessionId,
    token,
    status,
    resolution,
    projectId,
    appId,
    abortSignal,
}: TransitionInteractionParams): Promise<SessionInteraction | null> {
    if (!projectId || !sessionId || !token) return null

    const data = await getSessionsClient().transitionInteraction(
        {
            session_id: sessionId,
            token,
            status,
            resolution,
        },
        projectScopedRequest(projectId, appId, abortSignal),
    )

    const validated = safeParseWithLogging(
        sessionInteractionResponseSchema,
        data,
        "[transitionInteraction]",
    )
    return validated?.interaction ?? null
}

/**
 * Resolve a HITL interaction (approve/deny/input) — the detached respond dispatcher.
 *
 * The backend CAS-flips the row to `responded` and enqueues the resume invoke, which rebuilds
 * the turn's history from the durable records and replays the gate's stamped effective config.
 * A caller must NOT hand-build an `/invoke` resume instead: that lands as a fresh turn and
 * leaves the row `pending`.
 *
 * Unlike the read wrappers here this THROWS on failure rather than returning `null` — it is a
 * mutation, and the caller has to tell a real failure from an already-answered gate
 * (`isInteractionConflict`). Identify the row by its `id`, not its `token`.
 */
export async function respondInteraction({
    interactionId,
    projectId,
    appId,
    abortSignal,
    answer,
}: RespondInteractionParams): Promise<SessionInteraction | null> {
    if (!projectId || !interactionId) return null

    const data = await getSessionsClient().respondInteraction(
        {interaction_id: interactionId, answer},
        projectScopedRequest(projectId, appId, abortSignal),
    )

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

interface SessionPredicatesParams {
    search?: string
    liveness?: {is_alive?: boolean; is_running?: boolean; is_attached?: boolean}
    origins?: SessionOrigin[]
}

interface SessionExcludeParams {
    sessionIds?: string[]
    origins?: SessionOrigin[]
}

type SessionWindowingParams = Pick<
    SessionWindowing,
    "limit" | "next" | "newest" | "oldest" | "order"
>

export interface QuerySessionsPageParams {
    projectId: string
    session?: SessionPredicatesParams
    sessionIds?: string[]
    exclude?: SessionExcludeParams
    turnReferences?: {id?: string; slug?: string; version?: string}[]
    includeEnded?: boolean
    includeArchived?: boolean
    /** Only archived sessions. Wins over `includeArchived` server-side. */
    archivedOnly?: boolean
    includeTotal?: boolean
    expand?: SessionExpansion[]
    windowing?: SessionWindowingParams
    appId?: string
    abortSignal?: AbortSignal
    lowPriority?: boolean
}

/** Temporary flat options retained for list-only callers that have not migrated. */
export interface QuerySessionsParams {
    projectId: string
    references?: {id?: string; slug?: string; version?: string}[]
    includeEnded?: boolean
    includeArchived?: boolean
    /** Only archived sessions. Wins over `includeArchived` server-side. */
    archivedOnly?: boolean
    search?: string
    flags?: {is_alive?: boolean; is_running?: boolean; is_attached?: boolean}
    sessionIds?: string[]
    excludeSessionIds?: string[]
    origin?: SessionOrigin
    excludeOrigin?: SessionOrigin
    appId?: string
    abortSignal?: AbortSignal
    lowPriority?: boolean
    limit?: number
    next?: string
    newest?: string
    oldest?: string
    order?: "ascending" | "descending"
}

/** `sessionsQueryResponseSchema` with `sessions` loosened to `unknown[]` — the envelope
 * (`count`/`total`/`windowing`) still validates as a whole, but each row is parsed
 * individually below so one bad row can't fail the page (P2-9). */
const sessionsQueryEnvelopeSchema = sessionsQueryResponseSchema.extend({
    sessions: z.array(z.unknown()),
})

/**
 * Validates a `/sessions/query` response per row instead of as one array: a single
 * malformed row (a schema drift, a value the frontend enum doesn't know yet) is dropped and
 * logged, not treated as a reason to empty the whole page. Logs unconditionally — including
 * production — since a silently shrinking session list is worse than a noisy console.
 */
function parseSessionsQueryResponse(data: unknown, context: string): SessionsQueryResponse | null {
    const envelope = sessionsQueryEnvelopeSchema.safeParse(data)
    if (!envelope.success) {
        console.error(`${context} Invalid response envelope:`, envelope.error.flatten())
        return null
    }
    const sessions: SessionStream[] = []
    envelope.data.sessions.forEach((row, index) => {
        const parsed = sessionStreamSchema.safeParse(row)
        if (parsed.success) {
            sessions.push(parsed.data)
        } else {
            console.error(
                `${context} Dropping invalid session row at index ${index}:`,
                parsed.error.flatten(),
            )
        }
    })
    return {...envelope.data, sessions}
}

/**
 * The durable session list for the project: merged stream rows (id, `name` title, flags,
 * `created_at`, `deleted_at`=ended), filtered by the turns' workflow `references`. This is the
 * server source the reconciling sidebar merges over its localStorage cache. Ordered by last
 * activity (`updated_at`) server-side. Returns `null` on failure / missing project scope.
 */
export async function querySessionsPage({
    projectId,
    session,
    exclude,
    turnReferences,
    includeEnded,
    includeArchived,
    archivedOnly,
    includeTotal,
    expand,
    windowing,
    sessionIds,
    appId,
    abortSignal,
    lowPriority,
}: QuerySessionsPageParams): Promise<SessionsQueryResponse | null> {
    if (!projectId) return null

    const client = lowPriority ? getLowPrioritySessionsClient() : getSessionsClient()
    const data = await callFern("[querySessionsPage]", () =>
        client.querySessions(
            {
                session,
                session_ids: sessionIds,
                exclude: exclude
                    ? {session_ids: exclude.sessionIds, origins: exclude.origins}
                    : undefined,
                turn_references: turnReferences,
                include_ended: includeEnded,
                include_archived: includeArchived,
                archived_only: archivedOnly,
                include_total: includeTotal,
                expand,
                windowing,
            },
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    if (!data) return null

    return parseSessionsQueryResponse(data, "[querySessionsPage]")
}

/** Temporary list-only adapter for callers that have not migrated to the page envelope. */
export async function querySessions({
    projectId,
    references,
    includeEnded = true,
    includeArchived = true,
    archivedOnly,
    search,
    flags,
    sessionIds,
    excludeSessionIds,
    origin,
    excludeOrigin,
    appId,
    abortSignal,
    lowPriority,
    limit,
    next,
    newest,
    oldest,
    order,
}: QuerySessionsParams): Promise<SessionStream[] | null> {
    const page = await querySessionsPage({
        projectId,
        session:
            search !== undefined || flags !== undefined || origin !== undefined
                ? {search, liveness: flags, origins: origin ? [origin] : undefined}
                : undefined,
        sessionIds,
        exclude:
            excludeSessionIds !== undefined || excludeOrigin !== undefined
                ? {
                      sessionIds: excludeSessionIds,
                      origins: excludeOrigin ? [excludeOrigin] : undefined,
                  }
                : undefined,
        turnReferences: references,
        includeEnded,
        includeArchived,
        archivedOnly,
        windowing:
            limit !== undefined ||
            next !== undefined ||
            newest !== undefined ||
            oldest !== undefined ||
            order !== undefined
                ? {limit, next, newest, oldest, order}
                : undefined,
        appId,
        abortSignal,
        lowPriority,
    })
    return page?.sessions ?? null
}

export interface SetSessionHeaderParams {
    sessionId: string
    projectId: string
    name?: string
    description?: string
    appId?: string
    abortSignal?: AbortSignal
}

/**
 * Write a session's durable title/description (the stream `header`) so a rename syncs across
 * devices and survives a localStorage wipe. Partial: only the fields passed are sent. Creates the
 * stream row if a rename lands before the session's first run. Best-effort — `false` on failure.
 */
export async function setSessionHeader({
    sessionId,
    projectId,
    name,
    description,
    appId,
    abortSignal,
}: SetSessionHeaderParams): Promise<boolean> {
    if (!projectId || !sessionId) return false

    const body: {name?: string; description?: string} = {}
    if (name !== undefined) body.name = name
    if (description !== undefined) body.description = description

    const data = await callFern("[setSessionHeader]", () =>
        getSessionsClient().setSessionStreamHeader(
            {session_id: sessionId, body},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    return data !== null
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
 * FOLLOWUP(sessions,lifecycle): steer/attach remain unwired in the user-facing desktop chat;
 * cancel IS consumed by the mobile StopButton (cooperative ≤30s; clean "cancelled" settle
 * arrives with the agent-cancel-steer runner work). There's still no live-turn re-watch.
 * See docs/designs/sessions/frontend-integration.md.
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

/**
 * DELETE — permanently remove a session (root hard-delete fan-out across turns/streams/
 * interactions/mounts). Distinct from `killSession` (a soft end that stays resumable). Propagates
 * the deletion to every device: the reconciler drops a session absent from the server list.
 * Returns `true` on success, `false` on failure/missing scope.
 */
export async function deleteSession({
    sessionId,
    projectId,
    appId,
    abortSignal,
}: SessionScopedParams): Promise<boolean> {
    if (!projectId || !sessionId) return false

    const data = await callFern("[deleteSession]", () =>
        getSessionsClient().deleteSession(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    return data !== null
}

/**
 * ARCHIVE — hide a session from the default list without ending or deleting it. Sets the stream's
 * `archived_at` (distinct from `deleted_at`, which kill uses and which stays resumable), so an
 * archived session is fully recoverable via `unarchiveSession`. Surfaced only by an archived view
 * (`querySessions({includeArchived})`). Returns `true` on success, `false` on failure/missing scope.
 */
export async function archiveSession({
    sessionId,
    projectId,
    appId,
    abortSignal,
}: SessionScopedParams): Promise<boolean> {
    if (!projectId || !sessionId) return false

    const data = await callFern("[archiveSession]", () =>
        getSessionsClient().archiveSession(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal),
        ),
    )
    return data !== null
}

/** UNARCHIVE — reverse of `archiveSession`: clears `archived_at` so the session returns to the
 * default list. Returns `true` on success, `false` on failure/missing scope. */
export async function unarchiveSession({
    sessionId,
    projectId,
    appId,
    abortSignal,
}: SessionScopedParams): Promise<boolean> {
    if (!projectId || !sessionId) return false

    const data = await callFern("[unarchiveSession]", () =>
        getSessionsClient().unarchiveSession(
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
    // maxRetries 1: a small query; recover a transient blip once, but never a long retry pit.
    const data = await callFern("[querySessionMounts]", () =>
        client.querySessionMounts(
            {session_id: sessionId},
            projectScopedRequest(projectId, appId, abortSignal, 1),
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

/**
 * The durable drive bound to an AGENT rather than to a session — the files an agent carries
 * between runs (its brief, its reference material) as opposed to a session's scratch mount.
 *
 * Backed by `POST /mounts/agents/query`, which takes the workflow ARTIFACT id and resolves the
 * canonical agent id server-side, so callers pass the same id the rest of the app calls `appId`.
 * Returns at most one mount; the list shape mirrors the session endpoint.
 */
export async function queryAgentMounts({
    artifactId,
    projectId,
    appId,
    abortSignal,
    lowPriority,
}: {
    artifactId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
    lowPriority?: boolean
}): Promise<Mount[] | null> {
    if (!projectId || !artifactId) return null

    const client = lowPriority ? getLowPriorityMountsClient() : getMountsClient()
    // maxRetries 1: a small query; recover a transient blip once, but never a long retry pit.
    const data = await callFern("[queryAgentMounts]", () =>
        client.queryAgentMount(
            {artifact_id: artifactId},
            projectScopedRequest(projectId, appId, abortSignal, 1),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(sessionMountsResponseSchema, data, "[queryAgentMounts]")
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
    includeGitignored,
    lowPriority,
}: MountFilesParams & {includeGitignored?: boolean}): Promise<MountFile[] | null> {
    if (!projectId || !mountId) return null

    const client = lowPriority ? getLowPriorityMountsClient() : getMountsClient()
    // git_aware: the curated developer view (prune `.git` + `.gitignore`d output). It's OFF by
    // default on the endpoint so a raw `list_files` keeps its "list everything" contract for other
    // consumers — the playground explicitly opts in on every one of its listing queries.
    // `includeGitignored` (the drawer's search under a "show git-ignored" toggle) surfaces ignored
    // files again — but then the WHOLE ignored tree (node_modules, …) is enumerated, hence opt-in.
    // maxRetries 0: this is the WHOLE-tree object-store LIST; if it times out, a retry just
    // re-times-out and hammers the store. Fail once, degrade to null (the UI shows unavailable).
    const data = await callFern("[queryMountFiles]", () =>
        client.getMountFiles(
            {mount_id: mountId, path, git_aware: true, include_gitignored: includeGitignored},
            projectScopedRequest(projectId, appId, abortSignal, 0),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(mountFileListResponseSchema, data, "[queryMountFiles]")
    return validated?.files ?? null
}

/** A bounded, sorted slice of a mount's files plus the true total count. */
export interface MountFilesPage {
    files: MountFile[]
    /** Full file count before the limit — the UI badge shows this, not `files.length`. */
    total: number
    /** `total` is a floor (the count-only scan hit its cap) — show "N+". */
    totalCapped: boolean
}

export interface LatestMountFilesParams extends MountFilesParams {
    /** `recent` = newest first (object-store mtime); also `name` / `path`. */
    order?: "recent" | "name" | "path"
    limit?: number
}

/**
 * Fetch only the latest `limit` files of a mount (sorted by `order`), NOT the whole tree — the
 * summary surfaces (rail, config, runtime) need a handful of recent files + the total count, so the
 * backend does the sort/limit and ships just those. `total` keeps the file-count badge accurate.
 */
export async function queryLatestMountFiles({
    mountId,
    projectId,
    appId,
    abortSignal,
    order,
    limit,
    lowPriority,
}: LatestMountFilesParams): Promise<MountFilesPage | null> {
    if (!projectId || !mountId) return null

    const client = lowPriority ? getLowPriorityMountsClient() : getMountsClient()
    // git_aware: opt into the curated view (see queryMountFiles) — the endpoint defaults to a raw
    // listing so the pruning never surprises other API consumers.
    // maxRetries 0: the backend must scan the whole listing to produce this slice; a timeout won't
    // recover on retry. Fail once and let the summary settle to unavailable/empty.
    const data = await callFern("[queryLatestMountFiles]", () =>
        client.getMountFiles(
            {mount_id: mountId, order, limit, git_aware: true},
            projectScopedRequest(projectId, appId, abortSignal, 0),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(
        mountFileListResponseSchema,
        data,
        "[queryLatestMountFiles]",
    )
    if (!validated) return null
    const files = validated.files ?? []
    return {
        files,
        total: validated.total ?? files.length,
        totalCapped: validated.total_capped ?? false,
    }
}

export interface MountDirParams extends MountFilesParams {
    /** Attach `item_count` (immediate-child count) to each folder — the lazy drawer wants it on the
     * tiles; the summary root doesn't and skips the extra per-subdir counting. */
    withCounts?: boolean
    /** Surface `.gitignore`-matched files too (still hides `.git`/internal) — the drawer's "show
     * git-ignored files" toggle. Default (omitted) keeps them pruned. */
    includeGitignored?: boolean
}

/**
 * ONE directory level (`?depth=1`): the immediate files + folders under `path` (root when omitted),
 * via a single server-side delimiter listing — never the subtree. This is the unit the lazy drawer
 * loads as you navigate, and the summary's "what's in this drive" fallback, so opening a huge mount
 * never blocks on enumerating it. `git_aware` prunes `.git`/gitignored/internal; `withCounts` adds
 * each folder's immediate-child count. Returns `null` on failure/missing scope.
 */
export async function queryMountDir({
    mountId,
    projectId,
    appId,
    abortSignal,
    path,
    withCounts,
    includeGitignored,
    lowPriority,
}: MountDirParams): Promise<MountFile[] | null> {
    if (!projectId || !mountId) return null

    const client = lowPriority ? getLowPriorityMountsClient() : getMountsClient()
    // maxRetries 0: an object-store listing that times out won't recover on retry — fail once and let
    // the caller settle (the summary keeps its record-log recents / count; the drawer shows empty).
    const data = await callFern("[queryMountDir]", () =>
        client.getMountFiles(
            {
                mount_id: mountId,
                path,
                depth: 1,
                with_counts: withCounts,
                git_aware: true,
                include_gitignored: includeGitignored,
            },
            projectScopedRequest(projectId, appId, abortSignal, 0),
        ),
    )
    if (!data) return null

    const validated = safeParseWithLogging(mountFileListResponseSchema, data, "[queryMountDir]")
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

    // maxRetries 1: a single small file read; one transient-recovery, no pit. Also keeps the git
    // repo probe (`.git/HEAD` on a non-repo folder → 404) from retrying — 404 isn't retryable anyway.
    // 404 is silent: "not there" is this call's answer, not a failure (#6349).
    const data = await callFern(
        "[readMountFile]",
        () =>
            getMountsClient().getMountFiles(
                {mount_id: mountId, read: path},
                projectScopedRequest(projectId, appId, abortSignal, 1),
            ),
        isNotFound,
    )
    if (!data) return null

    const validated = safeParseWithLogging(mountFileContentResponseSchema, data, "[readMountFile]")
    return validated?.content ?? null
}

export interface CancelSessionExecutionParams extends SessionScopedParams {
    /** Fence Stop to the execution the caller observed. */
    expectedExecutionId?: string
    /** Retry identity for this request. Two sends of the same key are one command. */
    idempotencyKey?: string
}

export interface CancelSessionExecutionResult {
    /** The durable command's id and DELIVERY state — never the execution's state. */
    command: {id: string; state: string}
    /** What to render: the execution being stopped, or nothing. */
    execution: {id: string | null; state: "stopping" | "idle"}
    /** True when the API accepted the Stop (202); false when there was nothing to stop (200). */
    accepted: boolean
    /** True when the API refused because another execution is running (409). */
    conflict: boolean
}

/** Cancel current work through Fern while keeping the session warm. */
export async function cancelSessionExecution({
    sessionId,
    projectId,
    appId,
    abortSignal,
    expectedExecutionId,
    idempotencyKey,
}: CancelSessionExecutionParams): Promise<CancelSessionExecutionResult | null> {
    if (!projectId || !sessionId) return null

    try {
        const requestOptions = {
            ...projectScopedRequest(projectId, appId, abortSignal),
            ...(idempotencyKey ? {headers: {"Idempotency-Key": idempotencyKey}} : {}),
        }
        const {data, rawResponse} = await getSessionsClient()
            .cancelSessionExecution(
                {
                    session_id: sessionId,
                    body: expectedExecutionId ? {expected_execution_id: expectedExecutionId} : null,
                },
                requestOptions,
            )
            .withRawResponse()
        const validated = safeParseWithLogging(
            sessionCancelExecutionResponseSchema,
            data,
            "[cancelSessionExecution]",
        )
        if (!validated) return null
        return {
            command: validated.command,
            execution: {...validated.execution, id: validated.execution.id ?? null},
            accepted: rawResponse.status === 202,
            conflict: false,
        }
    } catch (error) {
        if (isAbortError(error)) throw error
        if ((error as {statusCode?: number} | null)?.statusCode === 409) {
            return {
                command: {id: "", state: "obsolete"},
                execution: {id: null, state: "idle"},
                accepted: false,
                conflict: true,
            }
        }
        console.error(
            "[cancelSessionExecution] failed:",
            error instanceof Error ? error.message : String(error),
        )
        return null
    }
}
