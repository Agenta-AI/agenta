/**
 * Chat Module
 *
 * Flat message-based chat state management for the playground.
 * Messages are stored in a flat list with sessionId/parentId metadata.
 *
 * ## Features
 *
 * - **Flat message model**: Ordered messages with session ownership
 * - **Multi-session**: Compare mode with per-session responses
 * - **API history builder**: Strips metadata for API payloads
 * - **Context-aware**: Auto-inject loadableId from primary node
 *
 * @module chat
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
    SimpleChatMessage,
    ChatMessageNode,
    ChatMessage,
    MessageExecution,
    MessageExecutionStatus,
    FlatChatState,
    DerivedTurn,
    AddMessagePayload,
    UpdateMessagePayload,
    RemoveMessagesPayload,
    ClearSessionResponsesPayload,
    StartExecutionPayload,
    CompleteExecutionPayload,
    FailExecutionPayload,
    AddUserMessagePayload,
    TruncateChatPayload,
    MessageTarget,
    PatchMessagePayload,
    DeleteMessagePayload,
} from "./messageTypes"
export {SHARED_SESSION_ID, createInitialFlatChatState} from "./messageTypes"

// ============================================================================
// ATOMS
// ============================================================================

export {
    messageIdsAtomFamily,
    messagesByIdAtomFamily,
    executionByMessageIdAtomFamily,
    messageAtomFamily,
    messageExecutionAtomFamily,
    orderedMessagesAtomFamily,
    messageCountAtomFamily,
} from "./messageAtoms"

// ============================================================================
// REDUCER ACTIONS
// ============================================================================

export {
    generateMessageId,
    // CRUD
    addMessageAtom,
    addMessagesAtom,
    updateMessageAtom,
    removeMessagesAtom,
    clearSessionResponsesAtom,
    truncateAfterMessageAtom,
    clearAllMessagesAtom,
    // Execution lifecycle
    startMessageExecutionAtom,
    completeMessageExecutionAtom,
    failMessageExecutionAtom,
    cancelMessageExecutionAtom,
    // Session operations
    duplicateSessionResponsesAtom,
    // Domain-level (turn-aware)
    addUserMessageAtom,
    truncateChatAtom,
    patchMessageAtom,
    deleteMessageAtom,
    // Context-aware
    addUserMessageWithContextAtom,
    truncateChatWithContextAtom,
    patchMessageWithContextAtom,
    deleteMessageWithContextAtom,
    addMessageWithContextAtom,
    addMessagesWithContextAtom,
    updateMessageWithContextAtom,
    removeMessagesWithContextAtom,
    clearSessionResponsesWithContextAtom,
    truncateAfterMessageWithContextAtom,
    clearAllMessagesWithContextAtom,
    duplicateSessionResponsesWithContextAtom,
} from "./messageReducer"

// ============================================================================
// SELECTORS
// ============================================================================

export {
    sharedMessageIdsAtomFamily,
    derivedTurnsAtomFamily,
    groupMessagesIntoTurns,
    apiHistoryForSessionAtomFamily,
    buildApiHistory,
    apiHistoryBeforeMessageAtomFamily,
    messagesForSessionAtomFamily,
    activeSessionIdsFromMessagesAtomFamily,
    isSessionRunningAtomFamily,
    isAnySessionRunningAtomFamily,
    sharedMessageIdsWithContextAtom,
    derivedTurnsWithContextAtom,
    messageIdsWithContextAtom,
    messagesByIdWithContextAtom,
    executionByMessageIdWithContextAtom,
    messageCountWithContextAtom,
    childMessageIndexWithContextAtom,
} from "./messageSelectors"

// ============================================================================
// UTILITIES
// ============================================================================

export {messageHasContent, messageHasToolCalls} from "./utils"
