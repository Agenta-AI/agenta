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
    // Workflow type utilities
    WORKFLOW_TYPE_COLOR_MAP,
    getWorkflowTypeColor,
    getWorkflowTypeLabel,
    normalizeWorkflowTypeKey,
    type WorkflowTypeColor,
    // Evaluator-specific utilities (for evaluator-type workflows)
    parseEvaluatorKeyFromUri,
    buildEvaluatorUri,
    isOnlineCapableEvaluator,
    hasFullPagePlaygroundUX,
    collectEvaluatorCandidates,
    // Output schema utilities
    resolveInputSchema,
    resolveOutputSchema,
    resolveOutputSchemaProperties,
    resolveParameters,
    resolveParametersSchema,
    resolveScript,
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
