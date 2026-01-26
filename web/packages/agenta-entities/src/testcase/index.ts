/**
 * Testcase Entity Module
 *
 * Complete testcase entity management with:
 * - Zod schemas for validation
 * - HTTP API functions
 * - Jotai state management (molecule pattern)
 *
 * @example
 * ```typescript
 * import { testcaseMolecule, type Testcase } from '@agenta/entities/testcase'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(testcaseMolecule.atoms.data(id))
 * const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
 * const cell = useAtomValue(testcaseMolecule.atoms.cell({id, column}))
 *
 * // Write atoms (for use in other atoms with set())
 * set(testcaseMolecule.actions.update, id, changes)
 * set(testcaseMolecule.actions.discard, id)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = testcaseMolecule.get.data(id)
 * testcaseMolecule.set.update(id, { data: { name: 'Updated' } })
 * ```
 */

// ============================================================================
// CORE - Schemas and Types
// ============================================================================

export {
    // Schemas
    testcaseSchema,
    testcasesQueryRequestSchema,
    testcasesResponseSchema,
    testsetMetadataSchema,
    // Schema set (factory-generated variants)
    testcaseSchemas,
    // Parse utility
    parseTestcase,
    // Types
    type Testcase,
    type TestcasesQueryRequest,
    type TestcasesResponse,
    type TestsetMetadata,
    // Constants
    SYSTEM_FIELDS,
    isSystemField,
    // Column extraction utilities
    COLUMN_EXTRACTION_MAX_DEPTH,
    DEFAULT_SAMPLE_SIZE,
    collectColumnPaths,
    type ColumnPathInfo,
    extractColumnsFromData,
    extractColumnsWithAccessor,
    type ExtractColumnsOptions,
} from "./core"

export type {
    // API param types
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
} from "./core"

// ============================================================================
// API - HTTP Functions
// ============================================================================

export {
    // Single testcase
    fetchTestcase,
    // Batch testcases
    fetchTestcasesBatch,
    // Paginated testcases
    PAGE_SIZE,
    fetchTestcasesPage,
    // Raw API
    fetchTestcasesRaw,
} from "./api"

// ============================================================================
// STATE - Molecule and Store Atoms
// ============================================================================

export {testcaseMolecule, type TestcaseMolecule, type CreateTestcasesOptions} from "./state"

// ============================================================================
// PAGINATED STORE & DATA CONTROLLER
// ============================================================================

/**
 * Paginated store for testcase table rendering with InfiniteVirtualTable.
 *
 * @example
 * ```typescript
 * import { testcasePaginatedStore } from '@agenta/entities/testcase'
 *
 * const paginatedState = useAtomValue(testcasePaginatedStore.selectors.state(params))
 * ```
 */
export {testcasePaginatedStore} from "./state"

/**
 * Unified data controller for testcase table rendering.
 * Provides rows, columns, selection state, and actions.
 *
 * @example
 * ```typescript
 * import { testcaseDataController } from '@agenta/entities/testcase'
 *
 * const rows = useAtomValue(testcaseDataController.selectors.rows(config))
 * const columns = useAtomValue(testcaseDataController.selectors.columns(config))
 * ```
 */
export {testcaseDataController} from "./state"

export type {TestcaseTableRow, TestcasePaginatedMeta, TestcaseDataConfig} from "./state"
