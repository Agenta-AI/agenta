/**
 * Testset API - HTTP functions and helpers
 */

// Fetch API functions
export {
    // Revision
    fetchRevision,
    fetchRevisionWithTestcases,
    fetchRevisionsList,
    fetchLatestRevision,
    fetchLatestRevisionsBatch,
    fetchRevisionsBatch,
    // Testset
    fetchTestsetsList,
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
    // Revision mutations
    patchRevision,
    commitRevision,
    archiveRevision,
    // File upload
    uploadTestsetFile,
    uploadRevisionFile,
    // File download
    downloadTestset,
    downloadRevision,
    // Simple API
    fetchSimpleTestset,
    queryPreviewTestsets,
    // Types
    type ExportFileType,
} from "./mutations"

// Cache helpers
export {findTestsetInCache, findVariantInCache} from "./helpers"
