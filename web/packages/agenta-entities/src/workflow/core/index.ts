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
    // URI utilities
    parseWorkflowKeyFromUri,
    buildWorkflowUri,
    generateSlug,
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
