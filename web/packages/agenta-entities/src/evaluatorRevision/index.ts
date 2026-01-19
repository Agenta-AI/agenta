/**
 * EvaluatorRevision Stub Module
 *
 * Placeholder implementation for evaluator revision functionality.
 * The actual implementation can be provided by the consuming application.
 *
 * @example
 * To use evaluators, configure them via the adapter:
 * ```typescript
 * import { setEvaluatorRevisionAtoms } from '@agenta/entities/ui/selection'
 * ```
 */

import {atom} from "jotai"

import {createStubMolecule} from "../shared/stubMolecule"

// ============================================================================
// TYPES
// ============================================================================

export interface EvaluatorRevisionData {
    id: string
    name?: string
    slug?: string
    version?: number
    configuration?: unknown
    invocationUrl?: string
    schemas?: {
        inputSchema?: unknown
        outputSchema?: unknown
    }
}

export interface SettingsPreset {
    name: string
    description?: string
    settings_values: Record<string, unknown>
}

// ============================================================================
// STUB MOLECULE
// ============================================================================

/**
 * Stub evaluator revision molecule.
 *
 * Provides a minimal interface that returns empty/null values.
 * The actual evaluator functionality should be implemented in the
 * consuming application or via dependency injection.
 */
export const evaluatorRevisionMolecule = createStubMolecule({
    name: "evaluatorRevision",
    extraSelectors: {
        /** Returns empty array - no presets available in stub */
        presets: (_id: string) => atom<SettingsPreset[]>(() => []),
    },
    extraActions: {
        /** No-op - preset application not available in stub */
        applyPreset: atom(
            null,
            (_get, _set, _payload: {revisionId: string; preset: SettingsPreset}) => {
                // Stub implementation - no-op
            },
        ),
    },
})
