/**
 * LegacyEvaluator API - HTTP functions
 */

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
