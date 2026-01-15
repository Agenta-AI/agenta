/**
 * Evaluator Revision Selection Adapter
 *
 * Adapter for selecting evaluator revisions through the hierarchy:
 * Evaluator → Variant → Revision
 *
 * Uses the evaluatorRevision controller from @/oss/state/entities/evaluatorRevision
 */

import {atom, type Atom} from "jotai"

import type {EntitySelectionResult, SelectionPathItem, ListQueryState} from "../types"

import {createAdapter} from "./createAdapter"
import {createRevisionLevel} from "./revisionLevelFactory"

// ============================================================================
// TYPES
// ============================================================================

export interface EvaluatorRevisionSelectionResult extends EntitySelectionResult {
    type: "evaluatorRevision"
    metadata: {
        evaluatorId: string
        evaluatorName: string
        variantId: string
        variantName: string
        revision: number
    }
}

// ============================================================================
// WRAPPER ATOMS
// ============================================================================

interface EvaluatorRevisionAtomConfig {
    evaluatorsAtom: Atom<unknown[]>
    variantsByEvaluatorFamily: (evaluatorId: string) => Atom<unknown[]>
    revisionsByVariantFamily: (variantId: string) => Atom<unknown[]>
}

let atomConfig: EvaluatorRevisionAtomConfig | null = null

/**
 * Configure the adapter with actual atoms from the app.
 * This should be called during app initialization.
 *
 * @example
 * ```typescript
 * import { evaluatorRevision } from '@/oss/state/entities/evaluatorRevision'
 *
 * setEvaluatorRevisionAtoms({
 *   evaluatorsAtom: evaluatorRevision.selectors.evaluators,
 *   variantsByEvaluatorFamily: evaluatorRevision.selectors.variantsByEvaluator,
 *   revisionsByVariantFamily: evaluatorRevision.selectors.revisions,
 * })
 * ```
 */
export function setEvaluatorRevisionAtoms(config: EvaluatorRevisionAtomConfig): void {
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
    return {data, isPending: false, isError: false, error: null}
})

/**
 * Variants by evaluator atom family wrapped for selection
 */
function variantsByEvaluatorListAtom(evaluatorId: string): Atom<ListQueryState<unknown>> {
    return atom((get) => {
        if (!atomConfig) {
            return {data: [], isPending: false, isError: false, error: null}
        }
        const data = get(atomConfig.variantsByEvaluatorFamily(evaluatorId))
        return {data, isPending: false, isError: false, error: null}
    })
}

/**
 * Revisions by variant atom family wrapped for selection
 */
function revisionsByVariantListAtom(variantId: string): Atom<ListQueryState<unknown>> {
    return atom((get) => {
        if (!atomConfig) {
            return {data: [], isPending: false, isError: false, error: null}
        }
        const data = get(atomConfig.revisionsByVariantFamily(variantId))
        return {data, isPending: false, isError: false, error: null}
    })
}

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * Evaluator Revision selection adapter
 *
 * Hierarchy: Evaluator → Variant → Revision
 *
 * @example
 * ```typescript
 * import { evaluatorRevisionAdapter } from '@agenta/entities/ui/selection'
 * import { useHierarchicalSelection } from '@agenta/entities/ui/selection'
 *
 * const { items, navigateDown, select } = useHierarchicalSelection({
 *   adapter: evaluatorRevisionAdapter,
 *   instanceId: 'my-selector',
 *   onSelect: (selection) => console.log('Selected evaluator revision:', selection),
 * })
 * ```
 */
export const evaluatorRevisionAdapter = createAdapter<EvaluatorRevisionSelectionResult>({
    name: "evaluatorRevision",
    entityType: "evaluatorRevision",
    levels: [
        {
            type: "evaluator",
            listAtom: evaluatorsListAtom,
            getId: (evaluator: unknown) => {
                const e = evaluator as {id?: string; evaluator_id?: string}
                return e.id ?? e.evaluator_id ?? ""
            },
            getLabel: (evaluator: unknown) => {
                const e = evaluator as {name?: string; evaluator_name?: string}
                return e.name ?? e.evaluator_name ?? "Unnamed"
            },
            hasChildren: () => true,
            isSelectable: () => false,
        },
        {
            type: "evaluatorVariant",
            listAtomFamily: variantsByEvaluatorListAtom,
            getId: (variant: unknown) => {
                const v = variant as {id?: string; variantId?: string; variant_id?: string}
                return v.id ?? v.variantId ?? v.variant_id ?? ""
            },
            getLabel: (variant: unknown) => {
                const v = variant as {
                    name?: string
                    variantName?: string
                    variant_name?: string
                    slug?: string
                }
                return v.name ?? v.variantName ?? v.variant_name ?? v.slug ?? "Unnamed"
            },
            hasChildren: () => true,
            isSelectable: () => false,
        },
        // Use shared revision level factory for git-based entity display
        createRevisionLevel({
            type: "evaluatorRevision",
            listAtomFamily: revisionsByVariantListAtom,
            fieldMappings: {
                version: "revision", // Evaluator revisions use 'revision' field
            },
        }),
    ],
    selectableLevel: 2,
    toSelection: (
        path: SelectionPathItem[],
        leafEntity: unknown,
    ): EvaluatorRevisionSelectionResult => {
        const revision = leafEntity as {id: string; revision?: number; version?: number}
        const evaluator = path[0]
        const variant = path[1]
        const revisionItem = path[2]

        return {
            type: "evaluatorRevision",
            id: revision.id,
            label: `${evaluator?.label ?? "Evaluator"} / ${variant?.label ?? "Variant"} / ${revisionItem?.label ?? "Revision"}`,
            path,
            metadata: {
                evaluatorId: evaluator?.id ?? "",
                evaluatorName: evaluator?.label ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.label ?? "",
                revision: revision.revision ?? revision.version ?? 0,
            },
        }
    },
    emptyMessage: "No evaluators found",
    loadingMessage: "Loading evaluators...",
})
