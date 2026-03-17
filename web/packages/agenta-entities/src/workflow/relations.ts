/**
 * Workflow Entity Relations
 *
 * Defines the parent-child relationships for workflow entities:
 * - workflow → workflowRevision (2-level, skips variants)
 * - workflow → workflowVariant → workflowRevision (3-level, full hierarchy)
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
 * import { workflowToRevisionRelation } from '@agenta/entities/workflow'
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 *
 * // Relations are auto-registered when this module is imported
 * const relation = entityRelationRegistry.getByTypes("workflow", "workflowRevision")
 * ```
 */

import {atom} from "jotai"

import type {EntityRelation} from "../shared/molecule/types"
import type {ListQueryState} from "../shared/molecule/types"
import {entityRelationRegistry} from "../shared/relations/registry"

import type {Workflow, WorkflowVariant} from "./core"
import {workflowsListQueryStateAtom} from "./state/allWorkflows"
import {
    workflowRevisionsByWorkflowQueryAtomFamily,
    workflowVariantsListQueryStateAtomFamily,
    workflowRevisionsListQueryStateAtomFamily,
} from "./state/store"

// ============================================================================
// WORKFLOWS LIST ATOM (ROOT LEVEL)
// ============================================================================

/**
 * All workflows (app + evaluator) as ListQueryState for the root level.
 * Filters out archived workflows for selection UI.
 * Delegates to the union atom from allWorkflows.ts.
 */
export const workflowsListAtom = workflowsListQueryStateAtom

// ============================================================================
// WORKFLOW → REVISION RELATION (2-Level, skips Variant)
// ============================================================================

/**
 * Creates a ListQueryState from the revisions-by-workflow query.
 * Adapts the existing workflowRevisionsByWorkflowQueryAtomFamily
 * to the ListQueryState interface required by selection adapters.
 */
const revisionByWorkflowListAtomFamily = (workflowId: string) =>
    atom<ListQueryState<Workflow>>((get) => {
        const query = get(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))

        const revisions = query.data?.workflow_revisions ?? []
        const data = [...revisions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
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
 * Relation from workflow to its revisions (2-level, skipping variants).
 *
 * Uses reference mode since revisions are fetched via their own queries.
 * The selection UI uses the listAtomFamily to populate the dropdown.
 *
 * This relation enables the list-popover EntityPicker variant.
 */
export const workflowToRevisionRelation: EntityRelation<Workflow, Workflow> = {
    name: "workflowRevisions",
    parentType: "workflow",
    childType: "workflowRevision",

    // Workflow doesn't embed revision IDs — fetched via API
    childIdsPath: () => [],

    // No embedded data
    childDataPath: undefined,

    // Reference mode — fetch via API
    mode: "reference",

    // No child molecule (workflowRevision uses its own query)
    childMolecule: undefined as unknown as EntityRelation<Workflow, Workflow>["childMolecule"],

    // List atom for selection UI
    listAtomFamily: revisionByWorkflowListAtomFamily,

    // Selection UI config
    selection: {
        label: "Revision",
        autoSelectLatest: true,
        displayName: (entity: unknown) => {
            const revision = entity as Workflow
            return revision.name || `v${revision.version ?? 0}`
        },
    },
}

// ============================================================================
// WORKFLOW → VARIANT RELATION (for 3-level hierarchy)
// ============================================================================

/**
 * Relation from workflow to its variants.
 * Used in the 3-level selection hierarchy: Workflow → Variant → Revision.
 */
export const workflowToVariantRelation: EntityRelation<Workflow, WorkflowVariant> = {
    name: "workflowVariants",
    parentType: "workflow",
    childType: "workflowVariant",
    childIdsPath: () => [],
    childDataPath: undefined,
    mode: "reference",
    childMolecule: undefined as unknown as EntityRelation<
        Workflow,
        WorkflowVariant
    >["childMolecule"],
    listAtomFamily: workflowVariantsListQueryStateAtomFamily,
    selection: {
        label: "Variant",
        autoSelectSingle: true,
        displayName: (entity: unknown) => {
            const variant = entity as WorkflowVariant
            return variant.name || "Unnamed"
        },
        displayDescription: (entity: unknown) => {
            const variant = entity as WorkflowVariant
            if (variant.description) return variant.description
            const dateStr = variant.updated_at ?? variant.created_at
            if (dateStr) {
                const date = new Date(dateStr)
                if (!isNaN(date.getTime())) {
                    const label = variant.updated_at ? "Updated" : "Created"
                    return `${label} ${date.toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"})}`
                }
            }
            return undefined
        },
    },
}

// ============================================================================
// VARIANT → REVISION RELATION (for 3-level hierarchy)
// ============================================================================

/**
 * Relation from workflow variant to its revisions.
 * Used in the 3-level selection hierarchy: Workflow → Variant → Revision.
 */
export const workflowVariantToRevisionRelation: EntityRelation<WorkflowVariant, Workflow> = {
    name: "workflowVariantRevisions",
    parentType: "workflowVariant",
    childType: "workflowRevision",
    childIdsPath: () => [],
    childDataPath: undefined,
    mode: "reference",
    childMolecule: undefined as unknown as EntityRelation<
        WorkflowVariant,
        Workflow
    >["childMolecule"],
    listAtomFamily: workflowRevisionsListQueryStateAtomFamily,
    selection: {
        label: "Revision",
        autoSelectLatest: true,
        displayName: (entity: unknown) => {
            const revision = entity as Workflow
            return revision.name || `v${revision.version ?? 0}`
        },
    },
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register all workflow relations.
 * Called automatically when this module is imported.
 */
export function registerWorkflowRelations(): void {
    entityRelationRegistry.register(workflowToRevisionRelation)
    entityRelationRegistry.register(workflowToVariantRelation)
    entityRelationRegistry.register(workflowVariantToRevisionRelation)
}

// Auto-register on import
registerWorkflowRelations()
