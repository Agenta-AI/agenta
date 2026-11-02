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
    // In-use check
    fetchTestsetsInUse,
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
