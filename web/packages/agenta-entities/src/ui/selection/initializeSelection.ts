/**
 * Selection System Initialization
 *
 * Unified initialization for the entity selection system.
 * Call this during app initialization to configure all adapters.
 *
 * @example
 * ```typescript
 * import { initializeSelectionSystem } from '@agenta/entities/ui/selection'
 *
 * // In your app's initialization (e.g., Providers.tsx)
 * initializeSelectionSystem({
 *   user: {
 *     membersAtom: workspaceMembersAtom,
 *     currentUserAtom: userAtom,
 *   },
 *   testset: {
 *     testsetsListAtom: testsetMolecule.atoms.list(null),
 *     revisionsListFamily: (id) => revisionMolecule.atoms.list(id),
 *     enableRevisionsQuery: (id) => enableQuery(id),
 *   },
 *   appRevision: {
 *     appsAtom: appRevisionMolecule.selectors.apps,
 *     variantsByAppFamily: appRevisionMolecule.selectors.variantsByApp,
 *     revisionsByVariantFamily: appRevisionMolecule.selectors.revisions,
 *   },
 *   evaluatorRevision: {
 *     evaluatorsAtom: evaluatorRevision.selectors.evaluators,
 *     variantsByEvaluatorFamily: evaluatorRevision.selectors.variantsByEvaluator,
 *     revisionsByVariantFamily: evaluatorRevision.selectors.revisions,
 *   },
 * })
 * ```
 */

import type {Atom} from "jotai"

import {setUserAtoms, type UserAtomConfig} from "../../shared/user"

import {registerSelectionAdapter} from "./adapters"
import {appRevisionAdapter, setAppRevisionAtoms} from "./adapters/appRevisionAdapter"
import {
    evaluatorRevisionAdapter,
    setEvaluatorRevisionAtoms,
} from "./adapters/evaluatorRevisionAdapter"
import {setTestsetAtoms, testsetAdapter} from "./adapters/testsetAdapter"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for testset selection adapter
 */
export interface TestsetSelectionConfig {
    /**
     * Atom that provides the list of testsets.
     * Should return query state with { data: testsets[], isPending, isError }
     */
    testsetsListAtom: Atom<unknown>

    /**
     * Factory function that returns an atom for revisions given a testset ID.
     */
    revisionsListFamily: (testsetId: string) => Atom<unknown>

    /**
     * Optional callback to enable revisions query for a testset.
     * Called when user navigates into a testset to load its revisions.
     */
    enableRevisionsQuery?: (testsetId: string) => void
}

/**
 * Configuration for app revision selection adapter
 */
export interface AppRevisionSelectionConfig {
    /**
     * Atom that provides the list of apps.
     */
    appsAtom: Atom<unknown[]>

    /**
     * Factory function that returns an atom for variants given an app ID.
     */
    variantsByAppFamily: (appId: string) => Atom<unknown[]>

    /**
     * Factory function that returns an atom for revisions given a variant ID.
     */
    revisionsByVariantFamily: (variantId: string) => Atom<unknown[]>
}

/**
 * Configuration for evaluator revision selection adapter
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
     * Testset selection adapter configuration.
     */
    testset?: TestsetSelectionConfig

    /**
     * App revision selection adapter configuration.
     */
    appRevision?: AppRevisionSelectionConfig

    /**
     * Evaluator revision selection adapter configuration.
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
 * This function configures all selection adapters with the provided atoms
 * and registers them for use with selection components.
 *
 * Safe to call multiple times - subsequent calls are no-ops.
 *
 * @param config - Configuration for all selection adapters
 */
export function initializeSelectionSystem(config: SelectionSystemConfig): void {
    if (initialized) return
    initialized = true

    // Configure user resolution (if provided)
    if (config.user) {
        setUserAtoms(config.user)
    }

    // Configure testset adapter (if provided)
    if (config.testset) {
        setTestsetAtoms(config.testset)
        registerSelectionAdapter(testsetAdapter)
    }

    // Configure app revision adapter (if provided)
    if (config.appRevision) {
        setAppRevisionAtoms(config.appRevision)
        registerSelectionAdapter(appRevisionAdapter)
    }

    // Configure evaluator revision adapter (if provided)
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
