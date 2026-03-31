/**
 * Testset Core - Schemas and Types
 *
 * Pure types and schemas with no external dependencies.
 */

// Schemas and entity types
export {
    // Revision
    revisionSchema,
    revisionSchemas,
    type Revision,
    type CreateRevision,
    type UpdateRevision,
    type LocalRevision,
    revisionListItemSchema,
    type RevisionListItem,
    revisionsResponseSchema,
    type RevisionsResponse,
    // Testset
    testsetSchema,
    testsetSchemas,
    type Testset,
    type CreateTestset,
    type UpdateTestset,
    type LocalTestset,
    testsetsResponseSchema,
    type TestsetsResponse,
    // Variant
    variantSchema,
    type Variant,
    // Utilities
    normalizeRevision,
    isV0Revision,
    getVersionDisplay,
    NEW_TESTSET_ID,
    isNewTestsetId,
} from "./schema"

// API parameter types
export type {
    RevisionListParams,
    RevisionDetailParams,
    TestsetListParams,
    TestsetDetailParams,
    VariantDetailParams,
    LatestRevisionInfo,
    TestsetRevisionDelta,
    TestsetRevisionDeltaColumns,
    TestsetRevisionDeltaRows,
    QueryResult,
    // Table row types
    TestsetApiRow,
    TestsetTableRow,
    TestsetDateRange,
    TestsetPaginatedMeta,
    TestsetQueryMeta,
} from "./types"
