/**
 * LegacyEvaluator Selection Config
 *
 * Pre-built selection config for the entity selection system.
 * Provides a 1-level flat evaluator list (for simple evaluator selection).
 *
 * Since the SimpleEvaluator API flattens the hierarchy, there is no
 * variant/revision level — just a flat list of evaluators.
 */

import {legacyEvaluatorsListQueryAtom, nonArchivedLegacyEvaluatorsAtom} from "./store"

/**
 * Selection config for the 1-level evaluator adapter.
 *
 * @example
 * ```typescript
 * import { legacyEvaluatorSelectionConfig } from '@agenta/entities/legacyEvaluator'
 *
 * initializeSelectionSystem({
 *   legacyEvaluator: legacyEvaluatorSelectionConfig,
 * })
 * ```
 */
export const legacyEvaluatorSelectionConfig = {
    evaluatorsAtom: nonArchivedLegacyEvaluatorsAtom,
    evaluatorsQueryAtom: legacyEvaluatorsListQueryAtom,
}

export type LegacyEvaluatorSelectionConfig = typeof legacyEvaluatorSelectionConfig
