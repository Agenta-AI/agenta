/**
 * `@agenta/entities/session` — durable Sessions API surface (PR #4916 + #4937/#4938).
 *
 * Thin Fern-backed accessors for the sessions/records/streams/interactions domain. Message
 * adaptation (record `AgentEvent` → renderer shape) stays in the consuming app, since it is
 * specific to that surface's message model.
 */
export {
    querySessionRecords,
    queryInteractions,
    fetchInteraction,
    respondInteraction,
    transitionInteraction,
    isInteractionConflict,
    querySessionStreams,
    querySessions,
    setSessionHeader,
    fetchSessionStream,
    commandSessionStream,
    killSession,
    deleteSession as deleteSessionRemote,
    archiveSession as archiveSessionRemote,
    unarchiveSession as unarchiveSessionRemote,
    querySessionMounts,
    queryAgentMounts,
    queryMountFiles,
    queryLatestMountFiles,
    readMountFile,
    type MountFilesPage,
    type LatestMountFilesParams,
    type QueryRecordsParams,
    type QuerySessionsParams,
    type SessionScopedParams,
    type QueryInteractionsParams,
    type InteractionScopedParams,
    type RespondInteractionParams,
    type TransitionInteractionParams,
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
    sessionInteractionSchema,
    sessionStreamSchema,
    type SessionRecord,
    type SessionRecordsQueryResponse,
    type SessionInteraction,
    type SessionInteractionKind,
    type SessionInteractionStatusCode,
    type SessionStream,
    type SessionStreamCommandResponse,
    type StreamStatusCode,
    type CommandMode,
    mountFileSchema,
    mountSchema,
    type MountFile,
    type Mount,
} from "./core/schema"
export {
    deriveStreamNest,
    deriveSessionLifecycle,
    refineLifecycleWithSandbox,
    type SessionLifecycle,
    type SessionStreamNest,
    type SandboxLiveness,
} from "./core/liveness"
export {deriveSessionRowStatus, type SessionRowStatus} from "./core/rowStatus"
export {
    sessionListQueryOptions,
    nextSessionCursor,
    sessionRowsFromPages,
    SESSIONS_PAGE_SIZE,
    type SessionListCursor,
    type SessionListFilters,
} from "./state/listOptions"
export {shouldAdoptServerTranscript, type TranscriptAdoptionInput} from "./core/transcriptAdoption"
export {deriveMountRows, mountBreadcrumbs, type MountRow} from "./core/mountBrowser"
export {pickCwdMount} from "./core/mountSelection"
export {
    sessionRecordsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    revalidateSessionRecordsAtom,
    fetchSessionRecordsAtom,
    sessionRecordsQueryKey,
    type SessionRecordsFetchResult,
} from "./state/records"
export {
    fetchSessionInteractionStatesAtom,
    revalidateSessionInteractionsAtom,
    type SessionInteractionRowState,
    type SessionInteractionRowStates,
} from "./state/interactionStatus"
export {recordInteractionAnswerAtom} from "./state/interactionAnswer"
export {
    sessionMountsQueryFamily,
    mountFilesQueryFamily,
    latestMountFilesQueryFamily,
    mountRootQueryFamily,
    mountDirQueryFamily,
    mountFileContentQueryFamily,
    revalidateSessionMountsAtom,
    sessionMountsQueryKey,
    mountFilesQueryKey,
    latestMountFilesQueryKey,
    mountFileContentQueryKey,
} from "./state/mounts"
export {
    detectFileActivity,
    fileRecencyFromRecords,
    mountPathMatchesToolPath,
    type FileActivity,
    type FileActivityOp,
} from "./core/fileActivity"
export {
    sessionFileActivityAtomFamily,
    latestSessionFileActivityAtomFamily,
    recordFileActivityAtom,
    clearSessionFileActivityAtom,
    type SessionFileActivityEntry,
    type FileActivityEffect,
} from "./state/fileActivity"
