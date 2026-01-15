/**
 * Testcase Core - Schemas and Types
 *
 * Pure definitions with no runtime dependencies.
 */

// Schemas
export {
    // Main schemas
    testcaseSchema,
    type Testcase,
    flattenedTestcaseSchema,
    type FlattenedTestcase,
    // Schema set (factory-generated variants)
    testcaseSchemas,
    // Parse utility
    parseTestcase,
    // Query/Response schemas
    windowingSchema,
    testcasesQueryRequestSchema,
    type TestcasesQueryRequest,
    testcasesResponseSchema,
    type TestcasesResponse,
    // Metadata schema
    testsetMetadataSchema,
    type TestsetMetadata,
    // Transformation utilities
    flattenTestcase,
    unflattenTestcase,
    // Constants
    SYSTEM_FIELDS,
    isSystemField,
} from "./schema"

// Types
export type {
    // API params
    TestcaseDetailParams,
    TestcaseListParams,
    TestcaseBatchParams,
    // Column types
    Column,
    TestcaseColumn,
    ExpandedColumn,
    // Query result types
    QueryResult,
    TestcasesPage,
    // Metadata types
    TestsetMetadataInfo,
    // Internal types
    CellKey,
    BatchUpdateEntry,
    ColumnRenameOperation,
} from "./types"
