/**
 * Evaluator Entity Relations
 *
 * Defines the parent-child relationships for evaluator entities:
 * - evaluator → evaluatorRevision (2-level, skips variants)
 *
 * These relations enable:
 * - Selection adapter generation (EntityPicker)
 * - Automatic child data fetching
 * - Hierarchy navigation (list-popover variant)
 *
 * ## Import constraint
 *
 * This file imports from `state/store.ts` for query atoms. Molecule files
 * must NEVER import from this file to avoid circular dependencies.
 *
 * @example
 * ```typescript
 * import { evaluatorToRevisionRelation } from '@agenta/entities/evaluator'
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 *
 * // Relations are auto-registered when this module is imported
 * const relation = entityRelationRegistry.getByTypes("evaluator", "evaluatorRevision")
 * ```
 */

import {atom} from "jotai"

import type {EntityRelation} from "../shared/molecule/types"
import type {ListQueryState} from "../shared/molecule/types"
import {entityRelationRegistry} from "../shared/relations/registry"

import type {Evaluator} from "./core"
import {evaluatorsListQueryAtom, evaluatorRevisionsByWorkflowQueryAtomFamily} from "./state/store"

// ============================================================================
// EVALUATORS LIST ATOM (ROOT LEVEL)
// ============================================================================

/**
 * Wraps the evaluators query to provide a ListQueryState for the root level.
 * This is a static atom (no parent ID) since evaluators are at the root.
 *
 * Filters out archived and human evaluators for selection UI.
 */
export const evaluatorsListAtom = atom<ListQueryState<Evaluator>>((get) => {
    const query = get(evaluatorsListQueryAtom)

    const data = (query.data?.workflows ?? []).filter(
        (e) => !e.deleted_at && e.flags?.is_human !== true,
    )
    const isPending = query.isPending ?? false
    const isError = query.isError ?? false
    const error = query.error ?? null

    return {
        data,
        isPending,
        isError,
        error,
    }
})

// ============================================================================
// EVALUATOR → REVISION RELATION (2-Level, skips Variant)
// ============================================================================

/**
 * Creates a ListQueryState from the revisions-by-workflow query.
 * Adapts the existing evaluatorRevisionsByWorkflowQueryAtomFamily
 * to the ListQueryState interface required by selection adapters.
 */
const revisionByWorkflowListAtomFamily = (evaluatorId: string) =>
    atom<ListQueryState<Evaluator>>((get) => {
        const query = get(evaluatorRevisionsByWorkflowQueryAtomFamily(evaluatorId))

        const data = query.data?.workflow_revisions ?? []
        const isPending = query.isPending ?? false
        const isError = query.isError ?? false
        const error = query.error ?? null

        return {
            data,
            isPending,
            isError,
            error,
        }
    })

/**
 * Relation from evaluator to its revisions (2-level, skipping variants).
 *
 * Uses reference mode since revisions are fetched via their own queries.
 * The selection UI uses the listAtomFamily to populate the dropdown.
 *
 * This relation enables the list-popover EntityPicker variant.
 */
export const evaluatorToRevisionRelation: EntityRelation<Evaluator, Evaluator> = {
    name: "evaluatorRevisions",
    parentType: "evaluator",
    childType: "evaluatorRevision",

    // Evaluator doesn't embed revision IDs — fetched via API
    childIdsPath: () => [],

    // No embedded data
    childDataPath: undefined,

    // Reference mode — fetch via API
    mode: "reference",

    // No child molecule (evaluatorRevision uses evaluatorRevisionMolecule from separate module)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childMolecule: undefined as any,

    // List atom for selection UI
    listAtomFamily: revisionByWorkflowListAtomFamily,

    // Selection UI config
    selection: {
        label: "Revision",
        autoSelectLatest: true,
        displayName: (entity: unknown) => {
            const revision = entity as Evaluator
            return revision.name || `v${revision.version ?? 0}`
        },
    },
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register all evaluator relations.
 * Called automatically when this module is imported.
 */
export function registerEvaluatorRelations(): void {
    entityRelationRegistry.register(evaluatorToRevisionRelation)
}

// Auto-register on import
registerEvaluatorRelations()
