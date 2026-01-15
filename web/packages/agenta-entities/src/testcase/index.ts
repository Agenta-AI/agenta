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
 * import {
 *     // Molecule (primary API)
 *     testcaseMolecule,
 *
 *     // API functions
 *     fetchTestcase,
 *     fetchTestcasesBatch,
 *
 *     // Types
 *     type Testcase,
 *     type FlattenedTestcase,
 * } from '@agenta/entities/testcase'
 *
 * // Using the molecule
 * const [state, dispatch] = useAtom(testcaseMolecule.controller(id))
 * const cell = useAtomValue(testcaseMolecule.atoms.cell({id, column}))
 *
 * // Imperative API
 * testcaseMolecule.set.update(id, { name: 'Updated' })
 * ```
 */

// ============================================================================
// CORE - Schemas and Types
// ============================================================================

export {
    // Schemas
    testcaseSchema,
    flattenedTestcaseSchema,
    testcasesQueryRequestSchema,
    testcasesResponseSchema,
    testsetMetadataSchema,
    // Schema set (factory-generated variants)
    testcaseSchemas,
    // Parse utility
    parseTestcase,
    // Types
    type Testcase,
    type FlattenedTestcase,
    type TestcasesQueryRequest,
    type TestcasesResponse,
    type TestsetMetadata,
    // Utilities
    flattenTestcase,
    unflattenTestcase,
    SYSTEM_FIELDS,
    isSystemField,
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
    fetchFlattenedTestcase,
    // Batch testcases
    fetchTestcasesBatch,
    fetchFlattenedTestcasesBatch,
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

/**
 * Low-level store atoms for advanced use cases and OSS layer integration.
 *
 * @internal These atoms are implementation details and may change without notice.
 * Prefer using `testcaseMolecule` API for most use cases.
 *
 * @example
 * ```typescript
 * // Prefer this (stable API):
 * const data = useAtomValue(testcaseMolecule.atoms.data(id))
 *
 * // Over this (internal, may change):
 * const data = useAtomValue(testcaseEntityAtomFamily(id))
 * ```
 */
export {
    // Context
    currentRevisionIdAtom,
    // ID tracking
    testcaseIdsAtom,
    setTestcaseIdsAtom,
    resetTestcaseIdsAtom,
    newEntityIdsAtom,
    addNewEntityIdAtom,
    removeNewEntityIdAtom,
    clearNewEntityIdsAtom,
    deletedEntityIdsAtom,
    markDeletedAtom,
    unmarkDeletedAtom,
    clearDeletedIdsAtom,
    // Query atoms
    testcaseQueryAtomFamily,
    // Draft atoms
    testcaseDraftAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIsDirtyAtomFamily,
    // Entity atoms
    testcaseEntityAtomFamily,
    // Cell atoms
    testcaseCellAtomFamily,
    // Mutations
    updateTestcaseAtom,
    discardDraftAtom,
    discardAllDraftsAtom,
    batchUpdateTestcasesSyncAtom,
    // Paginated store
    testcasePaginatedStore,
    testcasesPaginatedMetaAtom,
    testcasesRevisionIdAtom,
    testcasesSearchTermAtom,
    setDebouncedSearchTermAtom,
    testcaseFilters,
    initializeEmptyRevisionAtom,
} from "./state"

export type {TestcaseTableRow, TestcasePaginatedMeta} from "./state"
