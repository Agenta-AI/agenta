/**
 * Workflow Selection Config
 *
 * Pre-built selection configs for the entity selection system.
 * - `workflowSelectionConfig`: 1-level flat list (for simple workflow selection)
 * - `workflowRevisionSelectionConfig`: 3-level hierarchy (Workflow → Variant → Revision)
 */

import {
    workflowsListQueryAtom,
    nonArchivedWorkflowsAtom,
    workflowVariantsListDataAtomFamily,
    workflowRevisionsListDataAtomFamily,
} from "./store"

/**
 * Selection config for the 1-level workflow adapter.
 */
export const workflowSelectionConfig = {
    workflowsAtom: nonArchivedWorkflowsAtom,
    workflowsQueryAtom: workflowsListQueryAtom,
}

export type WorkflowSelectionConfig = typeof workflowSelectionConfig

/**
 * Selection config for the 3-level workflowRevision adapter.
 * Provides atoms for: Workflow → Variant → Revision hierarchy.
 *
 * @example
 * ```typescript
 * import { workflowRevisionSelectionConfig } from '@agenta/entities/workflow'
 *
 * initializeSelectionSystem({
 *   workflowRevision: workflowRevisionSelectionConfig,
 * })
 * ```
 */
export const workflowRevisionSelectionConfig = {
    workflowsAtom: nonArchivedWorkflowsAtom,
    variantsByWorkflowFamily: (workflowId: string) =>
        workflowVariantsListDataAtomFamily(workflowId),
    revisionsByVariantFamily: (variantId: string) => workflowRevisionsListDataAtomFamily(variantId),
}

export type WorkflowRevisionSelectionConfig = typeof workflowRevisionSelectionConfig
