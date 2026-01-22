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
    // Local testcase factory (accepts flat input)
    createLocalTestcase,
    type CreateLocalTestcaseResult,
    type CreateLocalTestcaseSuccess,
    type CreateLocalTestcaseFailure,
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

// Column grouping utilities
export {
    groupColumns,
    isGroupedColumnKey,
    parseGroupedColumnKey,
    getLeafColumnName,
    type GroupColumnsOptions,
} from "./groupColumns"
