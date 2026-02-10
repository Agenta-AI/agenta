/**
 * Testset Entity Relations
 *
 * Defines the parent-child relationships for testset entities:
 * - testset → revision
 * - revision → testcase
 *
 * These relations enable:
 * - Selection adapter generation (EntityPicker)
 * - Automatic child data fetching
 * - Hierarchy navigation
 *
 * ## Import constraint
 *
 * This file imports molecules (`revisionMolecule`, `testcaseMolecule`) to populate
 * `childMolecule` in relation definitions. This dependency is one-way:
 *
 *   relations.ts  ──imports──▶  state/molecule.ts
 *   state/molecule.ts  ✗  relations.ts  (would create circular dependency)
 *
 * Molecule files must NEVER import from this file. If a molecule needs child IDs,
 * it should inline the extraction logic rather than importing a relation object.
 *
 * @example
 * ```typescript
 * import { testsetToRevisionRelation, revisionToTestcaseRelation } from '@agenta/entities/testset'
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 *
 * // Relations are auto-registered when this module is imported
 * const path = entityRelationRegistry.getPath("testset", "testcase")
 * // Returns: ["testset", "revision", "testcase"]
 * ```
 */

import {atom} from "jotai"

import type {EntityRelation, ListQueryState} from "../shared/molecule/types"
import {entityRelationRegistry} from "../shared/relations/registry"
import type {Testcase} from "../testcase/core"
import {testcaseMolecule} from "../testcase/state"

import type {Revision, RevisionListItem, Testset} from "./core"
import {revisionMolecule} from "./state/revisionMolecule"
import {revisionsListQueryAtomFamily, testsetsListQueryAtomFamily} from "./state/store"

// ============================================================================
// TESTSETS LIST ATOM (ROOT LEVEL)
// ============================================================================

/**
 * Wraps the testsets query to provide a ListQueryState for the root level.
 * This is a static atom (no parent ID) since testsets are at the root.
 *
 * The query returns {testsets: [...], count: N}, so we extract the testsets array.
 * Used by selection adapters for the first level of hierarchy.
 */
export const testsetsListAtom = atom<ListQueryState<Testset>>((get) => {
    const query = get(testsetsListQueryAtomFamily(null))

    // Extract testsets from the response
    const data = query.data?.testsets ?? []
    const isPending = query.isPending ?? false
    const isError = query.isError ?? false
    const error = query.error ?? null

    return {
        data,
        isPending,
        isError,
        error,
    }
})

// ============================================================================
// TESTSET → REVISION RELATION
// ============================================================================

/**
 * Creates a ListQueryState from the revisions list query.
 * Adapts the existing revisionsListQueryAtomFamily to the ListQueryState interface.
 *
 * Note: Uses RevisionListItem (lightweight) instead of full Revision for performance.
 * The full Revision is fetched via revisionMolecule when actually selected.
 */
const revisionListAtomFamily = (testsetId: string) =>
    atom<ListQueryState<RevisionListItem>>((get) => {
        const query = get(revisionsListQueryAtomFamily(testsetId))

        // Extract data from query result
        const data = query.data ?? []
        const isPending = query.isPending ?? false
        const isError = query.isError ?? false
        const error = query.error ?? null

        return {
            data,
            isPending,
            isError,
            error,
        }
    })

/**
 * Relation from testset to its revisions.
 *
 * Uses reference mode since revisions are fetched via their own queries.
 * The selection UI uses the listAtomFamily to populate the dropdown.
 *
 * Note: The listAtomFamily returns RevisionListItem (lightweight list type),
 * while childMolecule is used to fetch the full Revision when selected.
 * Type assertion is used because molecule data type (Revision) differs
 * from list item type (RevisionListItem).
 */
export const testsetToRevisionRelation: EntityRelation<Testset, RevisionListItem> = {
    name: "revisions",
    parentType: "testset",
    childType: "revision",

    // Testset doesn't embed revision IDs - they're fetched via API
    // Using a function that returns empty array since we rely on listAtomFamily
    childIdsPath: () => [],

    // No embedded data
    childDataPath: undefined,

    // Reference mode - fetch via molecule
    mode: "reference",

    // Child molecule for fetching individual revisions
    // Note: Type assertion used because molecule data type (Revision)
    // differs from list item type (RevisionListItem)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childMolecule: revisionMolecule as any,

    // List atom for selection UI (returns RevisionListItem[])
    listAtomFamily: revisionListAtomFamily,

    // Selection UI config
    selection: {
        label: "Revision",
        autoSelectLatest: true,
        displayName: (entity: unknown) => {
            const revision = entity as RevisionListItem
            return revision.message || `v${revision.version ?? 0}`
        },
    },
}

// ============================================================================
// REVISION → TESTCASE RELATION
// ============================================================================

/**
 * Relation from revision to its testcases.
 *
 * Uses reference mode because testcases are typically NOT embedded in revisions.
 * When fetching revisions, we normally use `include_testcases: false` for performance.
 * Testcases are fetched separately via their own paginated queries.
 *
 * The relation supports both:
 * 1. Embedded testcases (when available via data.testcases)
 * 2. Reference by IDs (data.testcase_ids) with fetch via testcaseMolecule
 */
export const revisionToTestcaseRelation: EntityRelation<Revision, Testcase> = {
    name: "testcases",
    parentType: "revision",
    childType: "testcase",

    // Extract testcase IDs from revision data
    childIdsPath: (revision: Revision) => revision.data?.testcase_ids ?? [],

    // Embedded testcase data path (when fetched with include_testcases: true)
    // Note: Most queries use include_testcases: false, so this is rarely populated
    childDataPath: (revision: Revision) => {
        const testcases = revision.data?.testcases
        return testcases as unknown as Testcase[] | undefined
    },

    // Reference mode - testcases are fetched separately
    // Even though we have childDataPath, mode: "reference" means we prefer
    // fetching via the testcaseMolecule for consistency and freshness
    mode: "reference",

    // Child molecule for fetching individual testcases
    // Note: Type assertion used because testcaseMolecule uses a specific draft type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childMolecule: testcaseMolecule as any,

    // Selection UI config (if testcases are ever selected in hierarchy)
    selection: {
        label: "Testcase",
        autoSelectSingle: false,
        displayName: (entity: unknown) => {
            const testcase = entity as Testcase
            return testcase.id.slice(0, 8) // Short ID display
        },
    },
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register all testset relations.
 * Called automatically when this module is imported.
 */
export function registerTestsetRelations(): void {
    entityRelationRegistry.register(testsetToRevisionRelation)
    entityRelationRegistry.register(revisionToTestcaseRelation)
}

// Auto-register on import
registerTestsetRelations()
