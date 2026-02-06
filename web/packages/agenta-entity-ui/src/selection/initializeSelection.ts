/**
 * Selection System Initialization
 *
 * Unified initialization for the entity selection system.
 * Call this during app initialization to register adapters.
 *
 * ## Migration Note
 *
 * The testset and appRevision adapters now use relation-based atoms directly
 * from @agenta/entities. They no longer require runtime configuration.
 * Just call initializeSelectionSystem() to register them.
 *
 * @example Simple initialization (recommended)
 * ```typescript
 * import { initializeSelectionSystem } from '@agenta/entity-ui/selection'
 *
 * // Testset and appRevision adapters are auto-configured from entities package
 * initializeSelectionSystem({
 *   user: {
 *     membersAtom: workspaceMembersAtom,
 *     currentUserAtom: userAtom,
 *   },
 *   // Only evaluator needs runtime config (no evaluator relations yet)
 *   evaluatorRevision: {
 *     evaluatorsAtom: evaluatorRevision.selectors.evaluators,
 *     variantsByEvaluatorFamily: evaluatorRevision.selectors.variantsByEvaluator,
 *     revisionsByVariantFamily: evaluatorRevision.selectors.revisions,
 *   },
 * })
 * ```
 */

import {setUserAtoms, type UserAtomConfig} from "@agenta/entities/shared"
import type {Atom} from "jotai"

import {registerSelectionAdapter} from "./adapters"
// New relation-based adapters (auto-configured from @agenta/entities)
import {appRevisionAdapter} from "./adapters/appRevisionRelationAdapter"
// Legacy adapter (still needs runtime configuration)
import {
    evaluatorRevisionAdapter,
    setEvaluatorRevisionAtoms,
} from "./adapters/evaluatorRevisionAdapter"
import {testsetAdapter} from "./adapters/testsetRelationAdapter"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for evaluator revision selection adapter
 *
 * Note: This is the only adapter that still requires runtime configuration.
 * Testset and appRevision adapters use relation-based atoms directly.
 */
export interface EvaluatorRevisionSelectionConfig {
    /**
     * Atom that provides the list of evaluators.
     */
    evaluatorsAtom: Atom<unknown[]>

    /**
     * Factory function that returns an atom for variants given an evaluator ID.
     */
    variantsByEvaluatorFamily: (evaluatorId: string) => Atom<unknown[]>

    /**
     * Factory function that returns an atom for revisions given a variant ID.
     */
    revisionsByVariantFamily: (variantId: string) => Atom<unknown[]>
}

/**
 * Full configuration for the selection system
 */
export interface SelectionSystemConfig {
    /**
     * User resolution configuration.
     * Required for displaying user names in revision history.
     */
    user?: UserAtomConfig

    /**
     * Evaluator revision selection adapter configuration.
     * Required if using the evaluator adapter.
     */
    evaluatorRevision?: EvaluatorRevisionSelectionConfig
}

// ============================================================================
// STATE
// ============================================================================

let initialized = false

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the entity selection system.
 *
 * This function registers all selection adapters for use with selection components.
 * Testset and appRevision adapters are auto-configured from @agenta/entities.
 * Only evaluator requires runtime configuration.
 *
 * Safe to call multiple times - subsequent calls are no-ops.
 *
 * @param config - Optional configuration for user resolution and evaluator adapter
 */
export function initializeSelectionSystem(config: SelectionSystemConfig = {}): void {
    if (initialized) return
    initialized = true

    // Configure user resolution (if provided)
    if (config.user) {
        setUserAtoms(config.user)
    }

    // Register testset adapter (auto-configured from @agenta/entities/testset)
    registerSelectionAdapter(testsetAdapter)

    // Register app revision adapter (auto-configured from @agenta/entities/appRevision)
    registerSelectionAdapter(appRevisionAdapter)

    // Configure and register evaluator revision adapter (if provided)
    if (config.evaluatorRevision) {
        setEvaluatorRevisionAtoms(config.evaluatorRevision)
        registerSelectionAdapter(evaluatorRevisionAdapter)
    }
}

/**
 * Reset the initialization state.
 * Primarily for testing purposes.
 */
export function resetSelectionSystem(): void {
    initialized = false
}

/**
 * Check if the selection system has been initialized.
 */
export function isSelectionSystemInitialized(): boolean {
    return initialized
}
