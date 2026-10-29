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
 * - **Context-aware**: Auto-inject loadableId from primary node
 *
 * @module chat
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
    SimpleChatMessage,
    ChatMessage,
    MessageExecution,
    MessageExecutionStatus,
    AddMessagePayload,
    UpdateMessagePayload,
    RemoveMessagesPayload,
    ClearSessionResponsesPayload,
    CompleteExecutionPayload,
    FailExecutionPayload,
    AddUserMessagePayload,
    TruncateChatPayload,
    MessageTarget,
    PatchMessagePayload,
    DeleteMessagePayload,
} from "./messageTypes"
export {SHARED_SESSION_ID} from "./messageTypes"

// ============================================================================
// ATOMS
// ============================================================================

export {
    messageIdsAtomFamily,
    messagesByIdAtomFamily,
    executionByMessageIdAtomFamily,
} from "./messageAtoms"

// ============================================================================
// REDUCER ACTIONS
// ============================================================================

export {
    generateMessageId,
    // CRUD
    addMessageAtom,
    addMessagesAtom,
    clearSessionResponsesAtom,
    clearAllMessagesAtom,
    // Execution lifecycle
    completeMessageExecutionAtom,
    failMessageExecutionAtom,
    // Domain-level (turn-aware)
    addUserMessageAtom,
    // Context-aware
    addUserMessageWithContextAtom,
    truncateChatWithContextAtom,
    patchMessageWithContextAtom,
    deleteMessageWithContextAtom,
    addMessageWithContextAtom,
    clearSessionResponsesWithContextAtom,
    clearAllMessagesWithContextAtom,
} from "./messageReducer"

// ============================================================================
// SELECTORS
// ============================================================================

export {
    sharedMessageIdsAtomFamily,
    sharedMessageIdsWithContextAtom,
    messageIdsWithContextAtom,
    messagesByIdWithContextAtom,
    childMessageIndexWithContextAtom,
} from "./messageSelectors"
