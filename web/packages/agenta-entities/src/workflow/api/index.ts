/**
 * Workflow API - HTTP functions
 */

export {
    // Query / List (Workflows)
    queryWorkflows,
    // Query / List (Variants)
    queryWorkflowVariants,
    // Query / List (Revisions)
    queryWorkflowRevisionsByWorkflow,
    queryWorkflowRevisions,
    // Fetch (single revision by ID)
    fetchWorkflowRevisionById,
    // Inspect (resolve full schema including inputs)
    inspectWorkflow,
    type InspectWorkflowResponse,
    // OpenAPI schema fetch (app workflow fallback)
    fetchWorkflowAppOpenApiSchema,
    type AppOpenApiSchemas,
    // Fetch (latest revision by workflow ID)
    fetchWorkflow,
    // Create
    createWorkflow,
    type CreateWorkflowPayload,
    // Update
    updateWorkflow,
    type UpdateWorkflowPayload,
    // Archive / Unarchive
    archiveWorkflow,
    unarchiveWorkflow,
    // Batch
    fetchWorkflowsBatch,
} from "./api"
