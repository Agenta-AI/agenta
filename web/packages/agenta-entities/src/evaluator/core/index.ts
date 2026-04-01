/**
 * Evaluator Core - Schemas and Types
 *
 * Pure types and schemas with no external dependencies.
 */

// Schemas and entity types
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
    // Variant schema (for 3-level hierarchy)
    evaluatorVariantSchema,
    type EvaluatorVariant,
    evaluatorVariantsResponseSchema,
    type EvaluatorVariantsResponse,
    // Response schemas
    evaluatorResponseSchema,
    type EvaluatorResponse,
    evaluatorsResponseSchema,
    type EvaluatorsResponse,
    evaluatorRevisionResponseSchema,
    type EvaluatorRevisionResponse,
    evaluatorRevisionsResponseSchema,
    type EvaluatorRevisionsResponse,
    // URI utilities
    parseEvaluatorKeyFromUri,
    buildEvaluatorUri,
    generateSlug,
    // Color utilities
    getEvaluatorColor,
    type EvaluatorColor,
} from "./schema"

// API parameter types
export type {
    EvaluatorListParams,
    EvaluatorDetailParams,
    EvaluatorReference,
    QueryResult,
} from "./types"
