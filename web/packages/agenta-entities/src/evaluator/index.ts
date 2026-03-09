/**
 * Evaluator Entity Module
 *
 * Provides molecules and utilities for managing SimpleEvaluator entities.
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
 * ## Quick Start
 *
 * ```typescript
 * import { evaluatorMolecule } from '@agenta/entities/evaluator'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(evaluatorMolecule.selectors.data(evaluatorId))
 * const isDirty = useAtomValue(evaluatorMolecule.selectors.isDirty(evaluatorId))
 * const uri = useAtomValue(evaluatorMolecule.selectors.uri(evaluatorId))
 * const params = useAtomValue(evaluatorMolecule.selectors.parameters(evaluatorId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(evaluatorMolecule.actions.update, evaluatorId, { data: { parameters: newParams } })
 * set(evaluatorMolecule.actions.discard, evaluatorId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = evaluatorMolecule.get.data(evaluatorId)
 * evaluatorMolecule.set.update(evaluatorId, { data: { parameters: newParams } })
 * ```
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {evaluatorMolecule, type EvaluatorMolecule} from "./state/molecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Sub-schemas
    jsonSchemasSchema,
    type JsonSchemas,
    evaluatorFlagsSchema,
    type EvaluatorFlags,
    evaluatorDataSchema,
    type EvaluatorData,
    // Evaluator
    evaluatorSchema,
    evaluatorSchemas,
    type Evaluator,
    type CreateEvaluator,
    type UpdateEvaluator,
    type LocalEvaluator,
    // Response schemas
    evaluatorResponseSchema,
    type EvaluatorResponse,
    evaluatorsResponseSchema,
    type EvaluatorsResponse,
    // URI utilities
    parseEvaluatorKeyFromUri,
    buildEvaluatorUri,
    generateSlug,
    // Color utilities
    getEvaluatorColor,
    type EvaluatorColor,
} from "./core"

export type {
    // API parameter types
    EvaluatorListParams,
    EvaluatorDetailParams,
    EvaluatorReference,
    QueryResult,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {
    // Query / List
    queryEvaluators,
    // Fetch (single)
    fetchEvaluator,
    // Create
    createEvaluator,
    type CreateEvaluatorPayload,
    // Update
    updateEvaluator,
    type UpdateEvaluatorPayload,
    // Archive / Unarchive
    archiveEvaluator,
    unarchiveEvaluator,
    // Templates
    fetchEvaluatorTemplates,
    type EvaluatorTemplate,
    // Batch
    fetchEvaluatorsBatch,
} from "./api"

// ============================================================================
// STATE ATOMS
// ============================================================================

export {
    // Project ID
    evaluatorProjectIdAtom,
    // List query
    evaluatorsListQueryAtom,
    evaluatorsListDataAtom,
    nonArchivedEvaluatorsAtom,
    // Single entity
    evaluatorQueryAtomFamily,
    evaluatorDraftAtomFamily,
    evaluatorEntityAtomFamily,
    evaluatorIsDirtyAtomFamily,
    // Mutations
    updateEvaluatorDraftAtom,
    discardEvaluatorDraftAtom,
    // Cache invalidation
    invalidateEvaluatorsListCache,
    invalidateEvaluatorCache,
    // Enrichment maps
    evaluatorKeyMapAtom,
    evaluatorTemplatesMapAtom,
} from "./state"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

export {
    evaluatorSelectionConfig,
    type EvaluatorSelectionConfig,
    evaluatorRevisionSelectionConfig,
    type EvaluatorRevisionSelectionConfig,
} from "./state"

// ============================================================================
// RELATIONS
// ============================================================================

export {
    evaluatorToRevisionRelation,
    evaluatorsListAtom,
    registerEvaluatorRelations,
} from "./relations"

// ============================================================================
// RUNNABLE EXTENSION
// ============================================================================

export {evaluatorRunnableExtension, runnableAtoms, runnableGet} from "./state"
