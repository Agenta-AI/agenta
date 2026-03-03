/**
 * Selection System Initialization
 *
 * Unified initialization for the entity selection system.
 * Call this during app initialization to register adapters.
 *
 * ## Migration Note
 *
 * The testset adapter now uses relation-based atoms directly
 * from @agenta/entities. It no longer requires runtime configuration.
 * Just call initializeSelectionSystem() to register it.
 *
 * @example Simple initialization (recommended)
 * ```typescript
 * import { initializeSelectionSystem } from '@agenta/entity-ui/selection'
 *
 * // Testset adapter is auto-configured from entities package
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
// 1-level evaluator adapter (flat list, runtime configuration)
import {evaluatorAdapter, setEvaluatorAtoms} from "./adapters/evaluatorAdapter"
// 3-level evaluator revision adapter (legacy runtime configuration)
import {
    evaluatorRevisionAdapter,
    setEvaluatorRevisionAtoms,
} from "./adapters/evaluatorRevisionAdapter"
// 2-level evaluator revision adapter (relation-based, auto-configured)
import {evaluatorRevisionRelationAdapter} from "./adapters/evaluatorRevisionRelationAdapter"
// 1-level legacy evaluator adapter (flat list, SimpleEvaluator facade API)
import {legacyEvaluatorAdapter, setLegacyEvaluatorAtoms} from "./adapters/legacyEvaluatorAdapter"
import {testsetAdapter} from "./adapters/testsetRelationAdapter"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for evaluator selection adapter (1-level flat list)
 */
export interface EvaluatorSelectionConfig {
    /**
     * Atom that provides the list of evaluators.
     */
    evaluatorsAtom: Atom<unknown[]>

    /**
     * Optional query atom for reflecting loading/error state.
     * Should expose `isPending` and `isError` from the underlying tanstack query.
     */
    evaluatorsQueryAtom?: Atom<{isPending?: boolean; isError?: boolean; error?: unknown}>
}

/**
 * Configuration for legacy evaluator selection adapter (1-level flat list)
 *
 * Uses the SimpleEvaluator facade API (`/preview/simple/evaluators/`).
 */
export interface LegacyEvaluatorSelectionConfig {
    /**
     * Atom that provides the list of legacy evaluators.
     */
    evaluatorsAtom: Atom<unknown[]>

    /**
     * Optional query atom for reflecting loading/error state.
     */
    evaluatorsQueryAtom?: Atom<{isPending?: boolean; isError?: boolean; error?: unknown}>
}

/**
 * Configuration for evaluator revision selection adapter (3-level hierarchy)
 *
 * Evaluator → Variant → Revision
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
     * Evaluator selection adapter configuration (1-level flat list).
     * Used in playground for chaining evaluators as downstream nodes.
     */
    evaluator?: EvaluatorSelectionConfig

    /**
     * Legacy evaluator selection adapter configuration (1-level flat list).
     * Uses the SimpleEvaluator facade API (`/preview/simple/evaluators/`).
     */
    legacyEvaluator?: LegacyEvaluatorSelectionConfig

    /**
     * Evaluator revision selection adapter configuration (3-level hierarchy).
     * Required if using the evaluator revision adapter.
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
 * Testset adapter is auto-configured from @agenta/entities.
 * Evaluator requires runtime configuration.
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

    // Register evaluator revision relation adapter (2-level: Evaluator → Revision)
    // Auto-configured from @agenta/entities/evaluator — supports list-popover variant
    registerSelectionAdapter(evaluatorRevisionRelationAdapter)

    // Configure and register evaluator adapter (1-level flat list, if provided)
    if (config.evaluator) {
        setEvaluatorAtoms(config.evaluator)
        registerSelectionAdapter(evaluatorAdapter)
    }

    // Configure and register legacy evaluator adapter (1-level flat list, if provided)
    if (config.legacyEvaluator) {
        setLegacyEvaluatorAtoms(config.legacyEvaluator)
        registerSelectionAdapter(legacyEvaluatorAdapter)
    }

    // Configure and register evaluator revision adapter (3-level hierarchy, if provided)
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
