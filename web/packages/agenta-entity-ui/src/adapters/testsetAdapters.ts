/**
 * Testset Modal Adapters
 *
 * Registers testset and revision entity adapters for the unified modal system.
 * These adapters enable EntityDeleteModal, EntityCommitModal, and EntitySaveModal
 * to work with testset entities.
 */

import {derivedColumnChangesAtomFamily} from "@agenta/entities/loadable"
import {testcaseMolecule, type FlattenedTestcase} from "@agenta/entities/testcase"
import {
    type Revision,
    type Testset,
    changesSummaryAtom,
    deleteRevisionsReducer,
    deleteTestsetsReducer,
    saveTestsetAtom,
    revisionMolecule,
    latestRevisionForTestsetAtomFamily,
    testsetMolecule,
} from "@agenta/entities/testset"
import {projectIdAtom} from "@agenta/shared"
import {atom} from "jotai"

import {
    createAndRegisterEntityAdapter,
    type CommitContext,
    type CommitParams,
    type EntityModalAdapter,
} from "../modals"

// ============================================================================
// COMMIT REDUCER
// ============================================================================

/**
 * Commit revision reducer atom
 * Wraps saveTestsetAtom for the unified commit modal
 */
const commitRevisionReducer = atom(null, async (get, set, params: CommitParams): Promise<void> => {
    const {id: revisionId, message} = params

    const projectId = get(projectIdAtom)
    if (!projectId) {
        throw new Error("No project ID available for revision commit")
    }

    // Get testset ID from revision
    const revisionData = revisionMolecule.get.data(revisionId)
    const testsetId = revisionData?.testset_id
    if (!testsetId) {
        throw new Error("Could not determine testset ID from revision")
    }

    const result = await set(saveTestsetAtom, {
        projectId,
        testsetId,
        revisionId,
        commitMessage: message,
    })

    if (!result.success) {
        throw result.error ?? new Error("Commit failed")
    }
})

// ============================================================================
// DATA ATOMS
// ============================================================================

/**
 * Testset data atom factory for modal adapter
 */
const testsetDataAtom = (id: string) =>
    atom((get) => {
        const queryAtom = testsetMolecule.selectors.query(id)
        const query = get(queryAtom)
        return (query?.data as Testset | null) ?? null
    })

/**
 * Revision data atom factory for modal adapter
 */
const revisionDataAtom = (id: string) =>
    atom((get) => {
        const queryAtom = revisionMolecule.selectors.query(id)
        const query = get(queryAtom)
        return (query?.data as Revision | null) ?? null
    })

// ============================================================================
// DIFF DATA HELPERS
// ============================================================================

/**
 * System fields to exclude from diff display
 */
const DIFF_EXCLUDED_FIELDS = new Set([
    "id",
    "key",
    "testset_id",
    "set_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "flags",
    "tags",
    "meta",
    "__isSkeleton",
    "testcase_dedup_id",
])

/**
 * Extract only data fields from testcase (excluding system fields)
 */
function extractDataFields(testcase: FlattenedTestcase | null): Record<string, unknown> {
    if (!testcase) return {}

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(testcase)) {
        if (!DIFF_EXCLUDED_FIELDS.has(key)) {
            data[key] = value
        }
    }
    return data
}

/**
 * Build diff-friendly structure from testcases
 * Groups testcases by index with only their data fields
 */
function buildDiffStructure(
    testcases: {id: string; data: Record<string, unknown>}[],
): Record<string, Record<string, unknown>> {
    const structure: Record<string, Record<string, unknown>> = {}

    for (let i = 0; i < testcases.length; i++) {
        // Use index-based key for consistent ordering and no collisions
        const key = `row_${i + 1}`
        structure[key] = testcases[i].data
    }

    return structure
}

/**
 * Commit context atom factory for revision
 * Provides version info, changes summary, and diff data for the commit modal
 *
 * @param revisionId - The revision ID
 * @param metadata - Optional metadata from EntityReference (may contain loadableId)
 */
const revisionCommitContextAtom = (revisionId: string, metadata?: Record<string, unknown>) =>
    atom((get): CommitContext | null => {
        const revisionData = get(revisionDataAtom(revisionId))
        if (!revisionData) return null

        const currentVersion = revisionData.version ?? 0
        const testsetId = revisionData.testset_id

        // Get latest version from testset's revisions
        let latestVersion = currentVersion
        if (testsetId) {
            const latestRevision = get(latestRevisionForTestsetAtomFamily(testsetId))
            if (latestRevision) {
                latestVersion = latestRevision.version ?? currentVersion
            }
        }

        // Target version is always latest + 1
        const targetVersion = latestVersion + 1

        // Get core changes summary from testcase state (manual ops only)
        const coreChangesSummary = get(changesSummaryAtom)

        // Get loadable-derived column changes (optional - only when loadableId provided)
        // This allows reactive column change detection without explicit sync
        const loadableId = metadata?.loadableId as string | undefined
        const derivedChanges = loadableId
            ? get(derivedColumnChangesAtomFamily(loadableId))
            : {added: [], removed: []}

        // Combine core + derived column changes (avoid double-counting)
        const coreAddedColumns = coreChangesSummary?.addedColumns ?? 0
        const derivedAddedColumns = derivedChanges.added.length
        const totalAddedColumns = coreAddedColumns + derivedAddedColumns

        // Build combined changes summary
        const changesSummary = coreChangesSummary
            ? {
                  updatedTestcases: coreChangesSummary.updatedTestcases,
                  newTestcases: coreChangesSummary.newTestcases,
                  deletedTestcases: coreChangesSummary.deletedTestcases,
                  addedColumns: totalAddedColumns,
                  renamedColumns: coreChangesSummary.renamedColumns,
                  deletedColumns: coreChangesSummary.deletedColumns,
              }
            : null

        // Compute diff data from testcase molecule state
        const serverIds = get(testcaseMolecule.atoms.ids)
        const newIds = get(testcaseMolecule.atoms.newIds)
        const deletedIds = get(testcaseMolecule.atoms.deletedIds)

        // Build original (server) state - only non-deleted server entities
        const originalTestcases: {id: string; data: Record<string, unknown>}[] = []
        for (const id of serverIds) {
            if (deletedIds.has(id)) continue // Skip deleted

            // Get server data (without drafts)
            const serverData = get(testcaseMolecule.selectors.serverData(id))
            if (serverData) {
                originalTestcases.push({
                    id,
                    data: extractDataFields(serverData),
                })
            }
        }

        // Build modified state - server entities with drafts + new entities
        const modifiedTestcases: {id: string; data: Record<string, unknown>}[] = []

        // Add server entities (with drafts applied, excluding deleted)
        for (const id of serverIds) {
            if (deletedIds.has(id)) continue // Skip deleted

            // Get merged data (server + draft)
            const mergedData = get(testcaseMolecule.selectors.data(id))
            if (mergedData) {
                modifiedTestcases.push({
                    id,
                    data: extractDataFields(mergedData),
                })
            }
        }

        // Add new entities
        for (const id of newIds) {
            const newData = get(testcaseMolecule.selectors.data(id))
            if (newData) {
                modifiedTestcases.push({
                    id,
                    data: extractDataFields(newData),
                })
            }
        }

        // Build diff structures
        const originalStructure = buildDiffStructure(originalTestcases)
        const modifiedStructure = buildDiffStructure(modifiedTestcases)

        // Serialize to JSON for diff view
        const original = JSON.stringify(originalStructure, null, 2)
        const modified = JSON.stringify(modifiedStructure, null, 2)

        // Only include diff data if there are actual changes (testcases OR columns)
        const hasChanges =
            changesSummary &&
            (changesSummary.updatedTestcases > 0 ||
                changesSummary.newTestcases > 0 ||
                changesSummary.deletedTestcases > 0 ||
                changesSummary.renamedColumns > 0 ||
                changesSummary.addedColumns > 0 ||
                changesSummary.deletedColumns > 0)

        return {
            versionInfo: {
                currentVersion,
                targetVersion,
                latestVersion,
            },
            changesSummary: changesSummary
                ? {
                      modifiedCount: changesSummary.updatedTestcases,
                      addedCount: changesSummary.newTestcases,
                      deletedCount: changesSummary.deletedTestcases,
                      // Include column changes
                      addedColumns: changesSummary.addedColumns,
                      renamedColumns: changesSummary.renamedColumns,
                      deletedColumns: changesSummary.deletedColumns,
                  }
                : undefined,
            // Include diff data when there are changes
            diffData: hasChanges
                ? {
                      original,
                      modified,
                      language: "json",
                  }
                : undefined,
        }
    })

// ============================================================================
// ADAPTERS
// ============================================================================

/**
 * Testset modal adapter
 */
export const testsetModalAdapter: EntityModalAdapter<Testset> = createAndRegisterEntityAdapter({
    type: "testset",
    getDisplayName: (testset) => testset?.name ?? "Untitled Testset",
    getDisplayLabel: (count) => (count === 1 ? "Testset" : "Testsets"),
    deleteAtom: deleteTestsetsReducer,
    dataAtom: testsetDataAtom,
    canDelete: () => true,
    getDeleteWarning: () => null,
})

/**
 * Revision modal adapter
 * Includes commit support for creating new revisions
 */
export const revisionModalAdapter: EntityModalAdapter<Revision> = createAndRegisterEntityAdapter({
    type: "revision",
    getDisplayName: (revision) => {
        if (!revision) return "Untitled Revision"
        const version = revision.version ?? 0
        return `v${version}`
    },
    getDisplayLabel: (count) => (count === 1 ? "Revision" : "Revisions"),
    deleteAtom: deleteRevisionsReducer,
    dataAtom: revisionDataAtom,
    canDelete: () => true,
    getDeleteWarning: () => null,
    // Commit support
    commitAtom: commitRevisionReducer,
    canCommit: (_revision) => {
        // Commit is allowed if there are unsaved changes
        // Note: This is checked at render time via the atom
        return true
    },
    commitContextAtom: revisionCommitContextAtom,
})

// ============================================================================
// AUTO-REGISTRATION
// ============================================================================

/**
 * Adapters are registered when this module is imported.
 * The createAndRegisterEntityAdapter function handles registration.
 *
 * To ensure adapters are registered, import this module at app startup:
 *
 * @example
 * ```typescript
 * // In app initialization
 * import '@agenta/entities/testset'
 * ```
 */
