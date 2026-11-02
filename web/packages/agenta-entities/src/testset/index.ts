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
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(revisionMolecule.atoms.data(revisionId))
 * const isDirty = useAtomValue(revisionMolecule.atoms.isDirty(revisionId))
 * const columns = useAtomValue(revisionMolecule.atoms.testcaseColumns(revisionId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(revisionMolecule.actions.update, revisionId, { message: 'Updated' })
 * set(revisionMolecule.actions.discard, revisionId)
 *
 * // Imperative API (for callbacks outside React/atom context)
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
    setRevisionsListCache,
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
    revisionListItemSchema,
    type RevisionListItem,
    revisionsResponseSchema,
    type RevisionsResponse,
    // Testset schemas
    testsetSchema,
    testsetSchemas,
    type Testset,
    type CreateTestset,
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
    // File import helpers
    detectTestsetFileType,
    parseCsvRows,
    readTestsetFilePreview,
    type TestsetFileType,
    type TestsetFilePreviewResult,
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
    fetchLatestRevisionWithTestcases,
    fetchRevisionsList,
    fetchLatestRevision,
    fetchLatestRevisionsBatch,
    fetchRevisionsBatch,
    fetchTestsetsBatch,
    fetchTestsetsList,
    queryTestsetsPage,
    fetchTestsetDetail,
    fetchVariantDetail,
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
} from "./api"

// ============================================================================
// ADAPTER UTILITIES
// ============================================================================

/**
 * Atom for fetching the latest revision of a testset.
 * Used by entity adapters for display and selection.
 */
export {latestRevisionForTestsetAtomFamily, testsetQueryAtomFamily} from "./state/store"

/**
 * Save mutation atom for committing testset changes.
 * Used by entity adapters for the commit modal.
 */
export {
    saveTestsetAtom,
    saveNewTestsetAtom,
    changesSummaryAtom,
    hasUnsavedChangesAtom,
    clearChangesAtom,
} from "./state/mutations"

export type {
    SaveTestsetParams,
    SaveTestsetResult,
    SaveNewTestsetParams,
    SaveNewTestsetResult,
    ChangesSummary,
} from "./state/mutations"

export {
    testsetRevisionHeaderAtomFamily,
    type TestsetRevisionHeader,
    type TestsetRevisionHeaderState,
} from "./state/metadata"

// ============================================================================
// SELECTION CONFIG
// ============================================================================

export {testsetSelectionConfig, type TestsetSelectionConfig} from "./state/selectionConfig"

// ============================================================================
// ENTITY RELATIONS
// ============================================================================

/**
 * Entity relations for the testset hierarchy.
 *
 * - testsetToRevisionRelation: testset → revision
 * - revisionToTestcaseRelation: revision → testcase
 *
 * Relations are auto-registered when this module is imported.
 * Use the registry to query hierarchies:
 *
 * ```typescript
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 * const path = entityRelationRegistry.getPath("testset", "testcase")
 * // Returns: ["testset", "revision", "testcase"]
 * ```
 */
export {
    testsetToRevisionRelation,
    revisionToTestcaseRelation,
    registerTestsetRelations,
    // Root-level list atom for selection adapters
    testsetsListAtom,
} from "./relations"
