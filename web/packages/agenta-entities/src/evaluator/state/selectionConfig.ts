/**
 * Evaluator Selection Config
 *
 * Pre-built selection configs for the entity selection system.
 * - `evaluatorSelectionConfig`: 1-level flat list (for simple evaluator selection)
 * - `evaluatorRevisionSelectionConfig`: 3-level hierarchy (Evaluator → Variant → Revision)
 */

import {
    evaluatorsListQueryAtom,
    nonArchivedEvaluatorsAtom,
    evaluatorVariantsListDataAtomFamily,
    evaluatorRevisionsListDataAtomFamily,
} from "./store"

/**
 * Selection config for the 1-level evaluator adapter.
 */
export const evaluatorSelectionConfig = {
    evaluatorsAtom: nonArchivedEvaluatorsAtom,
    evaluatorsQueryAtom: evaluatorsListQueryAtom,
}

export type EvaluatorSelectionConfig = typeof evaluatorSelectionConfig

/**
 * Selection config for the 3-level evaluatorRevision adapter.
 * Provides atoms for: Evaluator (workflow) → Variant → Revision hierarchy.
 *
 * @example
 * ```typescript
 * import { evaluatorRevisionSelectionConfig } from '@agenta/entities/evaluator'
 *
 * initializeSelectionSystem({
 *   evaluatorRevision: evaluatorRevisionSelectionConfig,
 * })
 * ```
 */
export const evaluatorRevisionSelectionConfig = {
    evaluatorsAtom: nonArchivedEvaluatorsAtom,
    variantsByEvaluatorFamily: (evaluatorId: string) =>
        evaluatorVariantsListDataAtomFamily(evaluatorId),
    revisionsByVariantFamily: (variantId: string) =>
        evaluatorRevisionsListDataAtomFamily(variantId),
}

export type EvaluatorRevisionSelectionConfig = typeof evaluatorRevisionSelectionConfig
