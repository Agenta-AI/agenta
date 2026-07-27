/**
 * @agenta/playground - Playground State Management
 *
 * This package provides state controllers for the playground feature.
 * Internal atoms are NOT exported - use controllers for all state access.
 * For UI components, use @agenta/playground-ui.
 *
 * ## Usage
 *
 * ```typescript
 * import { executionItemController, playgroundController } from '@agenta/playground'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * // Read execution item state
 * const rows = useAtomValue(executionItemController.selectors.executionRowIds)
 * const result = useAtomValue(executionItemController.selectors.resolvedResult({ rowId, entityId }))
 *
 * // Trigger execution
 * const triggerTest = useSetAtom(executionItemController.actions.triggerTest)
 *
 * // Chat messages (chat mode)
 * const addMessage = useSetAtom(executionItemController.actions.addUserMessage)
 * ```
 *
 * ## Architecture
 *
 * - Controllers provide clean API for state access (selectors + actions)
 * - Internal atoms are hidden - use controllers instead
 * - Entity injection via PlaygroundEntityProvider
 * - UI components are in @agenta/playground-ui
 */

// ============================================================================
// CONTROLLERS (Public API)
// ============================================================================

export {
    playgroundController,
    outputConnectionController,
    entitySelectorController,
    executionController,
    executionItemController,
} from "./state"

// ============================================================================
// OSS INTEGRATION (Hydration, URL sync, bridge setup)
// ============================================================================

export {
    applyPendingHydrationsForRevision,
    pendingHydrations,
    pendingHydrationsAtom,
    hasPendingHydrationAtomFamily,
    setSelectionUpdateCallback,
    setOnSelectionChangeCallback,
    isPlaceholderId,
    urlSnapshotController,
    setRunnableTypeResolver,
    getRunnableTypeResolver,
} from "./state"

// Displayed entities & initialization (consumed by OSS layout/URL sync)
export {displayedEntityIdsAtom, playgroundInitializedAtom} from "./state"

// Testset import mutation (consumed by OSS testset integration)
export {loadTestsetNormalizedMutationAtom} from "./state"

export {filterUnreferencedColumnsForSource} from "./state"

// Agent generation lane (consumed by OSS AgentChatPanel): per-entity mode flag
// + the request builder that reuses the playground pipeline but bypasses
// buffered-fetch execution (useChat streams the v6 conversation).
export {
    isAgentModeAtomFamily,
    buildAgentRequest,
    buildAgentReferences,
    agentChannelModeAtomFamily,
    createNegotiatingFetch,
} from "./state"
export type {AgentRequest, AgentChannelMode, NegotiatingFetch} from "./state"
// HITL resume predicate for `useChat`'s `sendAutomaticallyWhen` (approve AND deny resume).
export {agentShouldResumeAfterApproval} from "./state"
// Render-hint map for interaction kinds (sibling `data-render` parts → toolCallId lookup).
export {buildRenderMap, renderKindFor, type RenderHintLike} from "./state"
// Queued-message release gate for the agent chat composer (HITL-safe, one-by-one).
export {canReleaseQueuedMessage, isHitlPending} from "./state"
// Per-turn request capture + correlation helpers (Turn Inspector Context/Raw tabs).
export {
    appendCapped,
    buildTurnCapture,
    capturesForTrigger,
    triggerUserMessageId,
    type TurnRequestCapture,
} from "./state"

// ============================================================================
// ENTITY CONTEXT (Dependency Injection)
// ============================================================================

export {PlaygroundEntityProvider} from "./state"

export type {PlaygroundEntityProviders} from "./state"

// ============================================================================
// TYPES (Only types actually consumed externally)
// ============================================================================

export type {PlaygroundTestResult, PlaygroundNode} from "./state"
export type {ChatMessage, SimpleChatMessage, MessageTarget} from "./state"
export type {ChainExecutionResult, ChainNodeInfo} from "./state"
export type {ConnectToTestsetPayload, OpenFromTraceResult} from "./state"

// ============================================================================
// TRACE REFERENCE RESOLUTION (shared with OSS trace drawer UI gate)
// ============================================================================

export {hasAppReference} from "./state/controllers/traceRefResolution"
export type {SpanWithReferences} from "./state/controllers/traceRefResolution"

// ============================================================================
// STANDALONE EXECUTION (no React context needed)
// ============================================================================

export {executeWorkflowRevision} from "./executeWorkflowRevision"
export type {
    ExecuteWorkflowRevisionParams,
    ExecuteWorkflowRevisionResult,
} from "./executeWorkflowRevision"
