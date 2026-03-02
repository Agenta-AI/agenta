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
    // Interface schemas fetch (builtin workflow fallback)
    fetchInterfaceSchemas,
    type InterfaceSchemasResponse,
    // OpenAPI schema fetch (app workflow fallback)
    fetchWorkflowAppOpenApiSchema,
    type AppOpenApiSchemas,
    // Fetch (latest revision by workflow ID)
    fetchWorkflow,
    // Create
    createWorkflow,
    type CreateWorkflowPayload,
    // Create Variant
    createWorkflowVariantApi,
    type CreateWorkflowVariantPayload,
    // Update
    updateWorkflow,
    type UpdateWorkflowPayload,
    // Commit revision
    commitWorkflowRevisionApi,
    type CommitWorkflowRevisionPayload,
    // Archive / Unarchive
    archiveWorkflow,
    archiveWorkflowVariant,
    archiveWorkflowRevision,
    unarchiveWorkflow,
    // Batch
    fetchWorkflowsBatch,
} from "./api"
