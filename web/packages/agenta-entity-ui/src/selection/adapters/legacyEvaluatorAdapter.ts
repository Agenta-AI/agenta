/**
 * LegacyEvaluator Selection Adapter (1-Level Flat List)
 *
 * Adapter for selecting legacy evaluators from a flat list.
 * Uses the SimpleEvaluator facade API (`/preview/simple/evaluators/`)
 * which flattens the Artifact → Variant → Revision hierarchy.
 *
 * This adapter is identical in structure to `evaluatorAdapter` but
 * registered under the `legacyEvaluator` name so both can coexist.
 *
 * ## Configuration
 *
 * This adapter uses **runtime configuration** via `setLegacyEvaluatorAtoms()`.
 * The consuming application must provide the evaluators list atom during initialization.
 *
 * @see {@link setLegacyEvaluatorAtoms} for configuration
 */

import {atom, type Atom} from "jotai"

import type {EntitySelectionResult, SelectionPathItem, ListQueryState} from "../types"

import {createAdapter} from "./createAdapter"

// ============================================================================
// TYPES
// ============================================================================

export interface LegacyEvaluatorSelectionResult extends EntitySelectionResult {
    type: "legacyEvaluator"
    metadata: {
        evaluatorId: string
        evaluatorName: string
    }
}

// ============================================================================
// RUNTIME CONFIGURATION
// ============================================================================

interface LegacyEvaluatorAtomConfig {
    evaluatorsAtom: Atom<unknown[]>
    evaluatorsQueryAtom?: Atom<{isPending?: boolean; isError?: boolean; error?: unknown}>
}

let atomConfig: LegacyEvaluatorAtomConfig | null = null

/**
 * Configure the adapter with actual atoms from the app.
 *
 * This should be called during app initialization, typically in `initializeSelectionSystem()`.
 *
 * @param config - Atom configuration for the legacy evaluator list
 * @param config.evaluatorsAtom - Atom that returns list of legacy evaluators
 *
 * @example
 * ```typescript
 * import { initializeSelectionSystem } from '@agenta/entity-ui/selection'
 * import { legacyEvaluatorSelectionConfig } from '@agenta/entities/legacyEvaluator'
 *
 * initializeSelectionSystem({
 *   legacyEvaluator: legacyEvaluatorSelectionConfig,
 * })
 * ```
 */
export function setLegacyEvaluatorAtoms(config: LegacyEvaluatorAtomConfig): void {
    atomConfig = config
}

/**
 * Legacy evaluators list atom wrapped for selection
 */
const evaluatorsListAtom = atom((get): ListQueryState<unknown> => {
    if (!atomConfig) {
        return {data: [], isPending: false, isError: false, error: null}
    }
    const data = get(atomConfig.evaluatorsAtom)
    const query = atomConfig.evaluatorsQueryAtom ? get(atomConfig.evaluatorsQueryAtom) : null
    return {
        data,
        isPending: query?.isPending ?? false,
        isError: query?.isError ?? false,
        error: (query?.error as Error) ?? null,
    }
})

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * LegacyEvaluator selection adapter (1-level flat list)
 *
 * Items are directly selectable — no hierarchy navigation.
 *
 * @example
 * ```typescript
 * <EntityPicker<LegacyEvaluatorSelectionResult>
 *   variant="breadcrumb"
 *   adapter="legacyEvaluator"
 *   onSelect={(selection) => {
 *     // selection.metadata.evaluatorId
 *     // selection.metadata.evaluatorName
 *   }}
 *   showSearch
 *   rootLabel="Evaluators"
 *   emptyMessage="No evaluators available"
 * />
 * ```
 */
export const legacyEvaluatorAdapter = createAdapter<LegacyEvaluatorSelectionResult>({
    name: "legacyEvaluator",
    entityType: "legacyEvaluator",
    levels: [
        {
            type: "legacyEvaluator",
            label: "Evaluator",
            autoSelectSingle: false,
            listAtom: evaluatorsListAtom,
            getId: (evaluator: unknown) => {
                const e = evaluator as {id?: string; evaluator_id?: string}
                return e.id ?? e.evaluator_id ?? ""
            },
            getLabel: (evaluator: unknown) => {
                const e = evaluator as {name?: string; evaluator_name?: string}
                return e.name ?? e.evaluator_name ?? "Unnamed"
            },
            hasChildren: () => false,
            isSelectable: () => true,
        },
    ],
    selectableLevel: 0,
    toSelection: (
        path: SelectionPathItem[],
        leafEntity: unknown,
    ): LegacyEvaluatorSelectionResult => {
        const evaluator = leafEntity as {id: string; name?: string; evaluator_name?: string}
        const evaluatorPath = path[0]

        return {
            type: "legacyEvaluator",
            id: evaluator.id,
            label:
                evaluatorPath?.label ?? evaluator.name ?? evaluator.evaluator_name ?? "Evaluator",
            path,
            metadata: {
                evaluatorId: evaluator.id,
                evaluatorName:
                    evaluatorPath?.label ??
                    evaluator.name ??
                    evaluator.evaluator_name ??
                    "Evaluator",
            },
        }
    },
    emptyMessage: "No evaluators found",
    loadingMessage: "Loading evaluators...",
})
