/**
 * Evaluator Selection Adapter (1-Level Flat List)
 *
 * Adapter for selecting evaluators from a flat list.
 * Unlike the evaluatorRevisionAdapter (3-level: Evaluator → Variant → Revision),
 * this adapter provides direct evaluator selection without hierarchy navigation.
 *
 * Used in the playground for chaining evaluators as downstream nodes.
 *
 * ## Configuration
 *
 * This adapter uses **runtime configuration** via `setEvaluatorAtoms()`.
 * The consuming application must provide the evaluators list atom during initialization.
 *
 * @see {@link setEvaluatorAtoms} for configuration
 */

import {atom, type Atom} from "jotai"

import type {EntitySelectionResult, SelectionPathItem, ListQueryState} from "../types"

import {createAdapter} from "./createAdapter"

// ============================================================================
// TYPES
// ============================================================================

export interface EvaluatorSelectionResult extends EntitySelectionResult {
    type: "evaluator"
    metadata: {
        evaluatorId: string
        evaluatorName: string
    }
}

// ============================================================================
// RUNTIME CONFIGURATION
// ============================================================================

interface EvaluatorAtomConfig {
    evaluatorsAtom: Atom<unknown[]>
    evaluatorsQueryAtom?: Atom<{isPending?: boolean; isError?: boolean; error?: unknown}>
}

let atomConfig: EvaluatorAtomConfig | null = null

/**
 * Configure the adapter with actual atoms from the app.
 *
 * This should be called during app initialization, typically in `initializeSelectionSystem()`.
 *
 * @param config - Atom configuration for the evaluator list
 * @param config.evaluatorsAtom - Atom that returns list of evaluators
 *
 * @example
 * ```typescript
 * import { initializeSelectionSystem } from '@agenta/entity-ui/selection'
 *
 * initializeSelectionSystem({
 *   evaluator: {
 *     evaluatorsAtom: nonArchivedEvaluatorsAtom,
 *   },
 * })
 * ```
 */
export function setEvaluatorAtoms(config: EvaluatorAtomConfig): void {
    atomConfig = config
}

/**
 * Evaluators list atom wrapped for selection
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
 * Evaluator selection adapter (1-level flat list)
 *
 * Items are directly selectable — no hierarchy navigation.
 *
 * @example
 * ```typescript
 * <EntityPicker<EvaluatorSelectionResult>
 *   variant="breadcrumb"
 *   adapter="evaluator"
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
export const evaluatorAdapter = createAdapter<EvaluatorSelectionResult>({
    name: "evaluator",
    entityType: "evaluator",
    levels: [
        {
            type: "evaluator",
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
    toSelection: (path: SelectionPathItem[], leafEntity: unknown): EvaluatorSelectionResult => {
        const evaluator = leafEntity as {id: string; name?: string; evaluator_name?: string}
        const evaluatorPath = path[0]

        return {
            type: "evaluator",
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
