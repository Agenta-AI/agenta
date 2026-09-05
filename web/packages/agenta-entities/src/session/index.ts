/**
 * `@agenta/entities/session` — durable Sessions API surface (PR #4916 + #4937/#4938).
 *
 * Thin Fern-backed accessors for the sessions/records/streams/interactions domain. Message
 * adaptation (record `AgentEvent` → renderer shape) stays in the consuming app, since it is
 * specific to that surface's message model.
 */
export {
    querySessionRecords,
    querySessionTranscript,
    fetchSessionSnapshot,
    queryInteractions,
    fetchInteraction,
    respondInteraction,
    transitionInteraction,
    isInteractionConflict,
    querySessionStreams,
    querySessionsPage,
    querySessions,
    setSessionHeader,
    fetchSessionStream,
    fetchSessionDurableApprovalsCapability,
    removePendingSessionInput,
    invalidateSessionDurableApprovalsCapability,
    commandSessionStream,
    cancelSessionExecution,
    cancelSessionStream,
    type CancelSessionOutcome,
    type CancelSessionStreamParams,
    resumeSessionContinuation,
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
    type QuerySessionTranscriptParams,
    type QuerySessionsPageParams,
    type QuerySessionsParams,
    type SessionScopedParams,
    type QueryInteractionsParams,
    type InteractionScopedParams,
    type RespondInteractionParams,
    type TransitionInteractionParams,
    type CommandSessionStreamParams,
    type CancelSessionExecutionParams,
    type CancelSessionExecutionResult,
    type ResumeSessionContinuationParams,
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
    sessionLiveFrameSchema,
    sessionDurableEventSchema,
    sessionDurableEventTypeSchema,
    sessionRecordsReadStateSchema,
    sessionSnapshotSchema,
    pendingSessionInputSchema,
    sessionsQueryResponseSchema,
    type SessionRecord,
    type SessionRecordsQueryResponse,
    type SessionInteraction,
    type SessionInteractionKind,
    type SessionInteractionStatusCode,
    type SessionStream,
    type SessionLiveFrame,
    type SessionDurableEvent,
    type SessionDurableEventType,
    type SessionRecordsReadState,
    type SessionSnapshot,
    type SessionsQueryResponse,
    type SessionReference,
    type SessionReferenceKey,
    type SessionOrigin,
    type SessionTriggerKind,
    type SessionExpansion,
    type SessionTrigger,
    type SessionDelivery,
    type SessionMessagePreview,
    type SessionWindowing,
    type SessionStreamCommandResponse,
    type PendingSessionInput,
    type StreamStatusCode,
    type CommandMode,
    mountFileSchema,
    mountSchema,
    type MountFile,
    type Mount,
} from "./core/schema"
export {fetchSessionSnapshotAtom, removePendingSessionInputAtom} from "./state/pendingInputs"
export {
    deriveStreamNest,
    deriveSessionLifecycle,
    refineLifecycleWithSandbox,
    livenessPollInterval,
    type LivenessPollInterval,
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
export {invalidateSessionListQueries, invalidateSessionLivenessQueries} from "./state/invalidate"
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
    sessionLivePreviewAtomFamily,
    clearSessionLivePreviewAtom,
    createSessionLivePreviewState,
    type SessionLivePreviewExecution,
    type SessionLivePreviewEntityState,
    type SessionLivePreviewState,
} from "./state/livePreview"
export {
    fetchSessionInteractionStatesAtom,
    hasWaitingInteraction,
    interactionStatesFromRows,
    interactionStatesFromWatchEvent,
    revalidateSessionInteractionsAtom,
    type SessionInteractionRowState,
    type SessionInteractionRowStates,
} from "./state/interactionStatus"
export {
    recordInteractionAnswerAtom,
    respondInteractionAnswerAtom,
    respondInteractionAnswersAtom,
    resumeSessionContinuationAtom,
    sessionDurableApprovalsCapabilityAtom,
} from "./state/interactionAnswer"
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
    drivePathFromToolPath,
    PATH_KEYS,
    fileRecencyFromRecords,
    mountPathMatchesToolPath,
    type DriveToolPath,
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
export {
    clearSessionFresh,
    freshSessionIds,
    isSessionFresh,
    markSessionFresh,
} from "./core/freshSessions"
