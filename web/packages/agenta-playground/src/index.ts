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
    setRunnableBridge,
} from "./state"

// Displayed entities & initialization (consumed by OSS layout/URL sync)
export {displayedEntityIdsAtom, playgroundInitializedAtom} from "./state"

// Testset import mutation (consumed by OSS testset integration)
export {loadTestsetNormalizedMutationAtom} from "./state"

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
