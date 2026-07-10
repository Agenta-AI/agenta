/**
 * `@agenta/entities/session` — durable Sessions API surface (PR #4916 + #4937/#4938).
 *
 * Thin Fern-backed accessors for the sessions/records/streams/interactions domain. Message
 * adaptation (record `AgentEvent` → renderer shape) stays in the consuming app, since it is
 * specific to that surface's message model.
 */
export {
    querySessionRecords,
    getSessionState,
    queryInteractions,
    fetchInteraction,
    respondInteraction,
    querySessionStreams,
    fetchSessionStream,
    commandSessionStream,
    type QueryRecordsParams,
    type SessionScopedParams,
    type QueryInteractionsParams,
    type InteractionScopedParams,
    type RespondInteractionParams,
    type CommandSessionStreamParams,
} from "./api/api"
export {
    getSessionsClient,
    getMountsClient,
    projectScopedRequest,
    callFern,
    isAbortError,
} from "./api/client"
export {
    sessionRecordSchema,
    sessionRecordsQueryResponseSchema,
    sessionStateSchema,
    sessionInteractionSchema,
    sessionStreamSchema,
    type SessionRecord,
    type SessionRecordsQueryResponse,
    type SessionState,
    type SessionInteraction,
    type SessionInteractionKind,
    type SessionInteractionStatusCode,
    type SessionStream,
    type SessionStreamCommandResponse,
    type StreamStatusCode,
    type CommandMode,
} from "./core/schema"
