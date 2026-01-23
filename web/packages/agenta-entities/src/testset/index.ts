/**
 * Testset Entity Module
 *
 * Provides molecules and utilities for managing testset and revision entities.
 *
 * ## Overview
 *
 * This module exports:
 * - **Molecules** - Unified state management for revision and testset entities
 * - **Schemas** - Zod schemas for validation
 * - **API functions** - HTTP functions for fetching data
 * - **Types** - TypeScript interfaces
 *
 * ## Quick Start
 *
 * ```typescript
 * import { revisionMolecule, testsetMolecule } from '@agenta/entities/testset'
 *
 * // In components - use the React hook
 * const [state, dispatch] = revisionMolecule.useController(revisionId)
 * const [testsetState, testsetDispatch] = testsetMolecule.useController(testsetId)
 *
 * // Access state
 * state.data         // Revision | null
 * state.isPending    // boolean
 * state.isDirty      // boolean
 *
 * // Dispatch actions
 * dispatch.update({ message: 'Updated commit message' })
 * dispatch.discard()
 *
 * // In atoms - use atoms directly
 * const dataAtom = revisionMolecule.atoms.data(revisionId)
 * const columnsAtom = revisionMolecule.atoms.testcaseColumns(revisionId)
 *
 * // Imperatively (in callbacks)
 * const data = revisionMolecule.get.data(revisionId)
 * revisionMolecule.set.update(revisionId, { message: 'New message' })
 * ```
 */

// ============================================================================
// MOLECULES (Primary API)
// ============================================================================

export {
    revisionMolecule,
    invalidateRevisionsListCache,
    type RevisionMolecule,
} from "./state/revisionMolecule"

export {
    testsetMolecule,
    invalidateTestsetsListCache,
    invalidateTestsetCache,
    type TestsetMolecule,
} from "./state/testsetMolecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Revision schemas
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
    // Testset schemas
    testsetSchema,
    testsetSchemas,
    type Testset,
    type CreateTestset,
    type UpdateTestset,
    type LocalTestset,
    testsetsResponseSchema,
    type TestsetsResponse,
    // Variant schemas
    variantSchema,
    type Variant,
    // Utilities
    normalizeRevision,
    isV0Revision,
    getVersionDisplay,
    NEW_TESTSET_ID,
    isNewTestsetId,
} from "./core"

export type {
    // API parameter types
    RevisionListParams,
    RevisionDetailParams,
    TestsetListParams,
    TestsetDetailParams,
    VariantDetailParams,
    LatestRevisionInfo,
    // Mutation types
    TestsetRevisionDelta,
    TestsetRevisionDeltaColumns,
    TestsetRevisionDeltaRows,
    // Query types
    QueryResult,
    // Table row types
    TestsetApiRow,
    TestsetTableRow,
    TestsetDateRange,
    TestsetPaginatedMeta,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {
    // Fetch
    fetchRevision,
    fetchRevisionWithTestcases,
    fetchRevisionsList,
    fetchRevisionsBatch,
    fetchTestsetsList,
    fetchTestsetDetail,
    fetchVariantDetail,
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
} from "./api"

// ============================================================================
// LOW-LEVEL STORE (for OSS layer integration)
// ============================================================================

/**
 * Low-level store atoms for advanced use cases and OSS layer integration.
 *
 * @internal These atoms are implementation details and may change without notice.
 * Prefer using `revisionMolecule` or `testsetMolecule` APIs for most use cases.
 *
 * @example
 * ```typescript
 * // Prefer this (stable API):
 * const data = useAtomValue(revisionMolecule.atoms.data(id))
 *
 * // Over this (internal, may change):
 * const data = useAtomValue(revisionQueryAtomFamily(id))
 * ```
 */
export {
    // Revision atoms
    currentTestsetIdForRevisionsAtom,
    revisionIdsAtom,
    setRevisionIdsAtom,
    revisionQueryAtomFamily,
    revisionDraftAtomFamily,
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
    latestRevisionForTestsetAtomFamily,
    // Latest revision helpers (for OSS table cells)
    latestRevisionAtomFamily,
    latestRevisionStatefulAtomFamily,
    requestLatestRevisionAtom,
    // Testset atoms
    testsetQueryAtomFamily,
    testsetDraftAtomFamily,
    testsetsListQueryAtomFamily,
    // Variant atoms
    variantQueryAtomFamily,
    // Revision table state
    revisionTableState,
    pendingColumnOpsAtomFamily,
    pendingRowOpsAtomFamily,
    hasPendingChangesAtomFamily,
    addColumnReducer,
    removeColumnReducer,
    renameColumnReducer,
    addRowReducer,
    removeRowReducer,
    removeRowsReducer,
    clearPendingOpsReducer,
} from "./state"

// Revision table state types
export type {TableColumn, RowRef, PendingColumnOps, PendingRowOps, ColumnRenameOp} from "./state"

// ============================================================================
// MUTATION ATOMS
// ============================================================================

export {
    // Unified save reducer (preferred)
    saveReducer,
    saveStateAtom,
    // Legacy save atoms
    saveTestsetAtom,
    saveNewTestsetAtom,
    // Clone reducers (two-layer: local and backend)
    cloneLocalReducer,
    cloneBackendReducer,
    // Delete reducers
    deleteTestsetsReducer,
    deleteRevisionsReducer,
    // Clear/discard
    clearChangesAtom,
    // Change tracking
    changesSummaryAtom,
    hasUnsavedChangesAtom,
} from "./state"

export type {
    // Unified save types
    SaveState,
    SaveParams,
    // Legacy types
    SaveTestsetParams,
    SaveTestsetResult,
    SaveNewTestsetParams,
    SaveNewTestsetResult,
    // Clone types
    CloneLocalParams,
    CloneLocalResult,
    CloneBackendParams,
    CloneBackendResult,
    ChangesSummary,
} from "./state"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

export {testsetSelectionConfig, type TestsetSelectionConfig} from "./state"
