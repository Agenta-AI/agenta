/**
 * Workflow Core - Schemas and Types
 *
 * Pure types and schemas with no external dependencies.
 */

// Schemas and entity types
export {
    // Sub-schemas
    jsonSchemasSchema,
    type JsonSchemas,
    workflowFlagsSchema,
    type WorkflowFlags,
    workflowDataSchema,
    type WorkflowData,
    // Workflow
    workflowSchema,
    workflowSchemas,
    type Workflow,
    type CreateWorkflow,
    type UpdateWorkflow,
    type LocalWorkflow,
    // Variant schema (for 3-level hierarchy)
    workflowVariantSchema,
    type WorkflowVariant,
    workflowVariantResponseSchema,
    type WorkflowVariantResponse,
    workflowVariantsResponseSchema,
    type WorkflowVariantsResponse,
    // Response schemas
    workflowResponseSchema,
    type WorkflowResponse,
    workflowsResponseSchema,
    type WorkflowsResponse,
    workflowRevisionResponseSchema,
    type WorkflowRevisionResponse,
    workflowRevisionsResponseSchema,
    type WorkflowRevisionsResponse,
    // Windowing
    windowingResponseSchema,
    type WindowingResponse,
    // URI utilities
    parseWorkflowKeyFromUri,
    buildWorkflowUri,
    generateSlug,
    // Evaluator-specific utilities (for evaluator-type workflows)
    getEvaluatorColor,
    type EvaluatorColor,
    parseEvaluatorKeyFromUri,
    buildEvaluatorUri,
    isOnlineCapableEvaluator,
    collectEvaluatorCandidates,
    // Output schema utilities
    resolveOutputSchema,
    resolveOutputSchemaProperties,
} from "./schema"

// Flag query type (for filtering)
export type {WorkflowQueryFlags} from "./schema"

// API parameter types
export type {
    WorkflowListParams,
    WorkflowDetailParams,
    WorkflowReference,
    QueryResult,
} from "./types"

// Evaluator resolution utilities
export {
    extractEvaluatorRef,
    deduplicateRefs,
    extractMetrics,
    toEvaluatorDefinitionFromWorkflow,
    toEvaluatorDefinitionFromRaw,
    type EvaluatorRef,
    type EvaluatorDefinition,
    type MetricColumnDefinition,
} from "./evaluatorResolution"
