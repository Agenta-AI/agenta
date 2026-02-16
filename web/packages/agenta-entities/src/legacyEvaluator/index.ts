/**
 * LegacyEvaluator Entity Module
 *
 * Provides molecules and utilities for managing SimpleEvaluator entities
 * via the `/preview/simple/evaluators/` facade API.
 *
 * ## Overview
 *
 * This module exports:
 * - **Molecule** - Unified state management for evaluator entities
 * - **Schemas** - Zod schemas for validation
 * - **API functions** - HTTP functions for CRUD operations
 * - **Types** - TypeScript interfaces
 * - **Runnable extension** - Atoms for playground integration
 *
 * ## Difference from `evaluator`
 *
 * The `evaluator` entity uses the granular Workflow API (`/preview/workflows/*`)
 * with separate queries for workflows, variants, and revisions.
 *
 * `legacyEvaluator` uses the SimpleEvaluator facade API
 * (`/preview/simple/evaluators/*`) which flattens the hierarchy into a
 * single entity — no variant/revision queries needed.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { legacyEvaluatorMolecule } from '@agenta/entities/legacyEvaluator'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(legacyEvaluatorMolecule.selectors.data(evaluatorId))
 * const isDirty = useAtomValue(legacyEvaluatorMolecule.selectors.isDirty(evaluatorId))
 * const uri = useAtomValue(legacyEvaluatorMolecule.selectors.uri(evaluatorId))
 * const params = useAtomValue(legacyEvaluatorMolecule.selectors.parameters(evaluatorId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(legacyEvaluatorMolecule.actions.update, evaluatorId, { data: { parameters: newParams } })
 * set(legacyEvaluatorMolecule.actions.discard, evaluatorId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = legacyEvaluatorMolecule.get.data(evaluatorId)
 * legacyEvaluatorMolecule.set.update(evaluatorId, { data: { parameters: newParams } })
 * ```
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {legacyEvaluatorMolecule, type LegacyEvaluatorMolecule} from "./state/molecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Sub-schemas
    jsonSchemasSchema,
    type JsonSchemas,
    legacyEvaluatorFlagsSchema,
    type LegacyEvaluatorFlags,
    legacyEvaluatorDataSchema,
    type LegacyEvaluatorData,
    // LegacyEvaluator
    legacyEvaluatorSchema,
    legacyEvaluatorSchemas,
    type LegacyEvaluator,
    type CreateLegacyEvaluator,
    type UpdateLegacyEvaluator,
    type LocalLegacyEvaluator,
    // Response schemas
    legacyEvaluatorResponseSchema,
    type LegacyEvaluatorResponse,
    legacyEvaluatorsResponseSchema,
    type LegacyEvaluatorsResponse,
    // URI utilities
    parseEvaluatorKeyFromUri,
    buildEvaluatorUri,
    generateSlug,
    // Color utilities
    getEvaluatorColor,
    type LegacyEvaluatorColor,
} from "./core"

export type {
    // API parameter types
    LegacyEvaluatorListParams,
    LegacyEvaluatorDetailParams,
    LegacyEvaluatorReference,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {
    // Query / List
    queryLegacyEvaluators,
    // Fetch (single)
    fetchLegacyEvaluator,
    // Create
    createLegacyEvaluator,
    type CreateLegacyEvaluatorPayload,
    // Update
    updateLegacyEvaluator,
    type UpdateLegacyEvaluatorPayload,
    // Archive / Unarchive
    archiveLegacyEvaluator,
    unarchiveLegacyEvaluator,
    // Batch
    fetchLegacyEvaluatorsBatch,
} from "./api"

// ============================================================================
// STATE ATOMS
// ============================================================================

export {
    // Project ID
    legacyEvaluatorProjectIdAtom,
    // List query
    legacyEvaluatorsListQueryAtom,
    legacyEvaluatorsListDataAtom,
    nonArchivedLegacyEvaluatorsAtom,
    // Single entity
    legacyEvaluatorQueryAtomFamily,
    legacyEvaluatorDraftAtomFamily,
    legacyEvaluatorEntityAtomFamily,
    legacyEvaluatorIsDirtyAtomFamily,
    // Mutations
    updateLegacyEvaluatorDraftAtom,
    discardLegacyEvaluatorDraftAtom,
    // Cache invalidation
    invalidateLegacyEvaluatorsListCache,
    invalidateLegacyEvaluatorCache,
} from "./state"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

export {legacyEvaluatorSelectionConfig, type LegacyEvaluatorSelectionConfig} from "./state"

// ============================================================================
// RUNNABLE EXTENSION
// ============================================================================

export {legacyEvaluatorRunnableExtension, runnableAtoms, runnableGet} from "./state"
