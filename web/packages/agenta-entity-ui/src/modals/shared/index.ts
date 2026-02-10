/**
 * Shared Modal Utilities
 *
 * Common utilities, types, and factories for entity modals.
 */

// ============================================================================
// COMPONENTS - imported from @agenta/ui
// ============================================================================

export {
    EnhancedModal,
    type EnhancedModalProps,
    type EnhancedModalStyles,
} from "@agenta/ui/components/modal"

// ============================================================================
// TYPES
// ============================================================================

export type {BaseModalState, ResolvedEntityName} from "./types"

// ============================================================================
// HOOK FACTORIES
// ============================================================================

export {
    createEntityActionHook,
    createTypedEntityActionHook,
    type CreateEntityActionHookConfig,
    type UseEntityActionReturn,
    type UseTypedEntityActionReturn,
} from "./hooks"
