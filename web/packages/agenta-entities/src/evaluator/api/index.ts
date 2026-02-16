/**
 * Evaluator API - HTTP functions
 */

export {
    // Query / List (Workflows)
    queryEvaluators,
    // Query / List (Variants)
    queryEvaluatorVariants,
    // Query / List (Revisions)
    queryEvaluatorRevisionsByWorkflow,
    queryEvaluatorRevisions,
    // Fetch (single revision by ID)
    fetchEvaluatorRevisionById,
    // Inspect (resolve full schema including inputs)
    inspectWorkflow,
    type InspectWorkflowResponse,
    // Fetch (latest revision by workflow ID)
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
    // Batch
    fetchEvaluatorsBatch,
} from "./api"
