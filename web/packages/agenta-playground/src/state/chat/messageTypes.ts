/**
 * Flat Message Model Types
 *
 * Replaces the turn-based chat state with a flat ordered message list.
 * Messages are pure data (identical to API payloads + minimal metadata).
 * Execution lifecycle lives in a separate map keyed by messageId.
 *
 * ## Key concepts:
 * - Messages are ordered in `messageIds[]`
 * - User/system messages have `sessionId: "shared"` (visible to all sessions)
 * - Assistant/tool responses have `sessionId: "sess:{revisionId}"` (per-entity)
 * - Assistant messages link to the user message via `parentId`
 * - Tool messages link to the assistant via `tool_call_id` (already in SimpleChatMessage)
 * - UI "turns" are derived at render time by grouping on `parentId`
 *
 * ## Threading chain:
 * ```
 * user (sessionId: "shared")
 *   ← assistant (parentId → user.id, sessionId: "sess:revA")
 *     ← tool (tool_call_id → assistant.tool_calls[n].id, sessionId: "sess:revA")
 * ```
 *
 * @module chat/messageTypes
 */

import type {SimpleChatMessage} from "@agenta/shared/types"

// ============================================================================
// SHARED SESSION ID
// ============================================================================

/**
 * Sentinel sessionId for messages visible to all sessions (user input, system prompts).
 */
export const SHARED_SESSION_ID = "shared" as const

// ============================================================================
// MESSAGE
// ============================================================================

/**
 * A chat message with minimal metadata for ownership and threading.
 *
 * Extends `SimpleChatMessage` (the standard OpenAI/Anthropic format) with:
 * - `sessionId` — which session owns this message
 * - `parentId` — links assistant responses to the user message that triggered them
 *
 * When building API payloads, strip `sessionId` and `parentId` — the rest
 * is already in the correct format.
 */
export interface ChatMessage extends SimpleChatMessage {
    /**
     * Which session owns this message.
     * - `"shared"` for user/system messages (visible to all sessions)
     * - `"sess:{revisionId}"` for assistant/tool responses (per-entity)
     */
    sessionId: string

    /**
     * Links an assistant response to the user message that triggered it.
     * Tool messages don't need this — they link via `tool_call_id` to the assistant.
     * User/system messages don't set this.
     */
    parentId?: string
}

// ============================================================================
// EXECUTION STATE
// ============================================================================

/**
 * Execution lifecycle status for a message.
 */
export type MessageExecutionStatus = "idle" | "running" | "complete" | "error" | "cancelled"

/**
 * Execution state for a response message.
 *
 * Stored separately from the message itself in `executionByMessageId`.
 * Only response messages (assistant) have execution state — user messages don't.
 */
export interface MessageExecution {
    /** Current lifecycle status */
    status: MessageExecutionStatus
    /** Run ID linking to the web worker invocation */
    runId?: string
    /** Observability trace ID */
    traceId?: string
    /** Content hash for dedup / change detection */
    resultHash?: string | null
    /** Raw execution output (the full API response) */
    output?: unknown
    /** Error message when status === "error" */
    error?: string
    /** Timestamp when execution started (ms) */
    startedAt?: number
    /** Timestamp when execution completed/failed (ms) */
    completedAt?: number
}

// ============================================================================
// STATE SHAPE
// ============================================================================

/**
 * Flat message-based chat state for a single loadable instance.
 *
 * Replaces the turn-based `ChatState` with:
 * - An ordered message list (messages are the atoms, not turns)
 * - A separate execution map (keeps messages pure/serializable)
 */
export interface FlatChatState {
    /** Message IDs in conversation order */
    messageIds: string[]
    /** All messages by ID */
    messagesById: Record<string, ChatMessage>
    /** Execution state per response message ID */
    executionByMessageId: Record<string, MessageExecution>
}

/**
 * Initial flat chat state factory
 */
export function createInitialFlatChatState(): FlatChatState {
    return {
        messageIds: [],
        messagesById: {},
        executionByMessageId: {},
    }
}

// ============================================================================
// DERIVED TURN (UI-only, not stored)
// ============================================================================

/**
 * A derived turn for UI rendering.
 *
 * Computed from the flat message list by grouping on `parentId`.
 * This is NOT stored — it's derived at render time via selectors.
 */
export interface DerivedTurn {
    /** ID of the user message (or a synthetic ID for orphan responses) */
    id: string
    /** The user message, or null if this is a pending-input slot */
    userMessage: ChatMessage | null
    /** Per-session responses grouped for side-by-side rendering in compare mode */
    responses: Record<
        string,
        {
            assistant: ChatMessage | null
            tools: ChatMessage[]
            execution: MessageExecution | null
        }
    >
}

// ============================================================================
// ACTION PAYLOADS
// ============================================================================

/**
 * Payload for adding a message to the conversation.
 */
export interface AddMessagePayload {
    /** The message to add */
    message: ChatMessage
    /** Insert after this message ID (appends to end if omitted) */
    afterMessageId?: string
}

/**
 * Payload for updating a message's content.
 */
export interface UpdateMessagePayload {
    /** Message ID to update */
    messageId: string
    /** Partial update (merged with existing message) */
    updates: Partial<ChatMessage>
}

/**
 * Payload for removing messages.
 */
export interface RemoveMessagesPayload {
    /** Message IDs to remove */
    messageIds: string[]
}

/**
 * Payload for removing all response messages for a session after a given user message.
 * Used for re-runs: clear old responses, then execute again.
 */
export interface ClearSessionResponsesPayload {
    /** Session ID whose responses to remove */
    sessionId: string
    /** Remove responses after this user message ID (inclusive of responses to this message) */
    afterUserMessageId: string
}

/**
 * Payload for starting execution on a response message.
 */
export interface StartExecutionPayload {
    /** Message ID of the response being executed */
    messageId: string
    /** Run ID from the web worker */
    runId: string
}

/**
 * Payload for completing execution on a response message.
 */
export interface CompleteExecutionPayload {
    /** Message ID of the response */
    messageId: string
    /** Execution result */
    result: {
        output?: unknown
        traceId?: string
        resultHash?: string | null
    }
}

/**
 * Payload for failing execution on a response message.
 */
export interface FailExecutionPayload {
    /** Message ID of the response */
    messageId: string
    /** Error details */
    error: string
}

// ============================================================================
// DOMAIN-LEVEL ACTION PAYLOADS
// ============================================================================

export type {SimpleChatMessage}

/**
 * @deprecated Use `SimpleChatMessage` from `@agenta/shared/types` instead.
 */
export type ChatMessageNode = SimpleChatMessage

/**
 * Payload for adding a user message.
 */
export interface AddUserMessagePayload {
    /** User message (null creates a pending-input placeholder) */
    userMessage: SimpleChatMessage | null
    /** Custom message ID (auto-generated if not provided) */
    id?: string
    /** Optional metadata */
    meta?: Record<string, unknown>
}

/**
 * Payload for truncating chat after a turn (for re-run)
 */
export interface TruncateChatPayload {
    /** Turn ID to truncate after (inclusive — this turn is kept) */
    afterTurnId: string
}

/**
 * Identifies a specific message within a turn.
 *
 * - `user`: the turn's `userMessage`
 * - `assistant`: `assistantBySession[sessionId]`
 * - `tool`: `toolsBySession[sessionId][toolIndex]`
 */
export interface MessageTarget {
    /** Turn ID */
    turnId: string
    /** Which message kind to target */
    kind: "user" | "assistant" | "tool"
    /** Session ID (required for assistant/tool) */
    sessionId?: string
    /** Tool index within the session's tool array (required for tool) */
    toolIndex?: number
}

/**
 * Payload for patching a specific message by target.
 */
export interface PatchMessagePayload {
    /** Which message to target */
    target: MessageTarget
    /** Pure updater: receives current message, returns updated message */
    updater: (message: SimpleChatMessage | null) => SimpleChatMessage | null
}

/**
 * Payload for deleting a specific message by target.
 */
export interface DeleteMessagePayload {
    /** Which message to delete */
    target: MessageTarget
}
