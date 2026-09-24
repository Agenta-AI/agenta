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
// HOOK FACTORIES
// ============================================================================

export {
    createEntityActionHook,
    type CreateEntityActionHookConfig,
    type UseEntityActionReturn,
} from "./hooks"
