/**
 * Testset API - HTTP functions and helpers
 */

// Fetch API functions
export {
    // Revision
    fetchRevision,
    fetchRevisionWithTestcases,
    fetchLatestRevisionWithTestcases,
    fetchRevisionsList,
    fetchLatestRevision,
    fetchLatestRevisionsBatch,
    fetchRevisionsBatch,
    // Testset
    fetchTestsetsList,
    queryTestsetsPage,
    fetchTestsetsBatch,
    fetchTestsetDetail,
    // Variant
    fetchVariantDetail,
} from "./api"

// Its own module, so a bundle that never calls it does not carry it.
export {fetchRevisionColumnKeys} from "./columnKeys"

// Mutation API functions
export {
    // Testset CRUD
    createTestset,
    updateTestsetMetadata,
    cloneTestset,
    archiveTestsets,
    unarchiveTestset,
    // Revision mutations
    patchRevision,
    commitRevision,
    archiveRevision,
    // File upload
    uploadTestsetFile,
    uploadTestsetRevisionFile,
    // Evaluation runs that use a Testset
    fetchEvaluationRunIdsUsingTestsets,
    // File download
    downloadTestset,
    downloadRevision,
    // Simple API
    fetchSimpleTestset,
    // Types
    type ExportFileType,
} from "./mutations"

// Cache helpers
export {findTestsetInCache, findVariantInCache} from "./helpers"
