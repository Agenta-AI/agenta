/**
 * LegacyEvaluator Core - Schemas and Types
 *
 * Pure types and schemas with no external dependencies.
 */

// Schemas and entity types
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
} from "./schema"

// API parameter types
export type {
    LegacyEvaluatorListParams,
    LegacyEvaluatorDetailParams,
    LegacyEvaluatorReference,
} from "./types"
