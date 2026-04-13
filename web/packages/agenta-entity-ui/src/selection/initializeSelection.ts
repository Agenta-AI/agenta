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
 * })
 * ```
 */

import {setUserAtoms, type UserAtomConfig} from "@agenta/entities/shared"
import type {Atom} from "jotai"

import {registerSelectionAdapter} from "./adapters"
// 1-level evaluator adapter (flat list, runtime configuration)
import {evaluatorAdapter, setEvaluatorAtoms} from "./adapters/evaluatorAdapter"
import {testsetAdapter} from "./adapters/testsetRelationAdapter"
import {workflowRevisionAdapter} from "./adapters/workflowRevisionRelationAdapter"

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

    // Register workflow revision adapter (auto-configured from @agenta/entities/workflow)
    registerSelectionAdapter(workflowRevisionAdapter)

    // Configure and register evaluator adapter (1-level flat list, if provided)
    if (config.evaluator) {
        setEvaluatorAtoms(config.evaluator)
        registerSelectionAdapter(evaluatorAdapter)
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
