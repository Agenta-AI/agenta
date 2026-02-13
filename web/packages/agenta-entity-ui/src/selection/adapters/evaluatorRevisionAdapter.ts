/**
 * Evaluator Revision Selection Adapter (Legacy Runtime Configuration)
 *
 * Adapter for selecting evaluator revisions through the hierarchy:
 * Evaluator → Variant → Revision
 *
 * ## Current Implementation
 *
 * This adapter uses **runtime configuration** via `setEvaluatorRevisionAtoms()`
 * because the backend does not yet expose dedicated APIs for:
 * - `GET /evaluators/{evaluatorId}/variants`
 * - `GET /evaluator-variants/{variantId}/revisions`
 *
 * The consuming application must provide the atoms during initialization.
 *
 * ## Migration Plan
 *
 * When the backend APIs are available, this will be migrated to use the
 * relation-based pattern (like testset and appRevision adapters) via
 * `createThreeLevelAdapter()`. See:
 * - `@agenta/entities/evaluatorRevision/README.md` for the migration path
 * - `./appRevisionRelationAdapter.ts` for the target pattern
 *
 * @see {@link setEvaluatorRevisionAtoms} for configuration
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
 *
 * This is a **legacy pattern** required because the backend does not expose
 * dedicated APIs for evaluator variants and revisions. The consuming application
 * must provide atoms that implement the hierarchy.
 *
 * This should be called during app initialization, typically in `initializeSelectionSystem()`.
 *
 * @param config - Atom configuration for the evaluator hierarchy
 * @param config.evaluatorsAtom - Atom that returns list of evaluators
 * @param config.variantsByEvaluatorFamily - Factory returning variants for an evaluator
 * @param config.revisionsByVariantFamily - Factory returning revisions for a variant
 *
 * @example
 * ```typescript
 * import { initializeSelectionSystem } from '@agenta/entity-ui/selection'
 *
 * initializeSelectionSystem({
 *   evaluatorRevision: {
 *     evaluatorsAtom: myEvaluatorsListAtom,
 *     variantsByEvaluatorFamily: (evaluatorId) => myVariantsAtom(evaluatorId),
 *     revisionsByVariantFamily: (variantId) => myRevisionsAtom(variantId),
 *   },
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
 * Evaluator Revision selection adapter (legacy runtime-configured)
 *
 * Hierarchy: Evaluator → Variant → Revision
 *
 * **Note:** This adapter requires runtime configuration via `setEvaluatorRevisionAtoms()`
 * before use. Unlike the relation-based `testsetAdapter` and `appRevisionAdapter`,
 * this adapter cannot be auto-configured because the backend lacks the required APIs.
 *
 * @example
 * ```typescript
 * import { evaluatorRevisionAdapter } from '@agenta/entity-ui/selection'
 * import { useCascadingMode } from '@agenta/entity-ui/selection'
 *
 * // Note: setEvaluatorRevisionAtoms must be called first!
 * const { levels, selection } = useCascadingMode({
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
            hasChildren: () => true,
            isSelectable: () => false,
        },
        {
            type: "evaluatorVariant",
            label: "Variant",
            autoSelectSingle: true,
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
            label: "Revision",
            autoSelectSingle: true,
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
