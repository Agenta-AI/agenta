/**
 * Testset Selection Adapter
 *
 * Adapter for selecting testset revisions through the hierarchy:
 * Testset → Revision
 *
 * Uses the testsetMolecule and revisionMolecule from @agenta/entities/testset
 */

import {atom, getDefaultStore, type Atom, type WritableAtom} from "jotai"

import type {EntitySelectionResult, SelectionPathItem, ListQueryState} from "../types"

import {createAdapter} from "./createAdapter"
import {createRevisionLevel} from "./revisionLevelFactory"

// ============================================================================
// TYPES
// ============================================================================

export interface TestsetSelectionResult extends EntitySelectionResult {
    type: "revision"
    metadata: {
        testsetId: string
        testsetName: string
        revisionId: string
        version: number
        commitMessage?: string
    }
}

// ============================================================================
// WRAPPER ATOMS
// ============================================================================

interface TestsetAtomConfig {
    testsetsListAtom: Atom<unknown>
    revisionsListFamily: (testsetId: string) => Atom<unknown>
    enableRevisionsQuery?: (testsetId: string) => void
}

// Use a primitive atom to store config so derived atoms re-evaluate when it changes
const atomConfigAtom = atom<TestsetAtomConfig | null>(null) as WritableAtom<
    TestsetAtomConfig | null,
    [TestsetAtomConfig | null],
    void
>

/**
 * Configure the adapter with actual atoms from the app.
 * This should be called during app initialization.
 *
 * @example
 * ```typescript
 * import { testsetMolecule, revisionMolecule } from '@agenta/entities/testset'
 *
 * setTestsetAtoms({
 *   testsetsListAtom: testsetMolecule.atoms.list(null),
 *   revisionsListFamily: (testsetId) => revisionMolecule.atoms.list(testsetId),
 * })
 * ```
 */
export function setTestsetAtoms(config: TestsetAtomConfig): void {
    // Set in the default store so derived atoms re-evaluate
    const store = getDefaultStore()
    store.set(atomConfigAtom, config)
}

/**
 * Extract data from various query state formats
 */
function extractData(queryState: unknown, dataKey?: string): unknown[] {
    if (!queryState) return []

    // Handle TanStack Query state
    if (typeof queryState === "object" && "data" in queryState) {
        const data = (queryState as {data?: unknown}).data

        // Handle direct array
        if (Array.isArray(data)) return data

        // Handle object with specific key (e.g., { testsets: [...] })
        if (dataKey && data && typeof data === "object" && dataKey in data) {
            const nested = (data as Record<string, unknown>)[dataKey]
            if (Array.isArray(nested)) return nested
        }

        return []
    }

    // Handle direct array
    if (Array.isArray(queryState)) return queryState

    return []
}

/**
 * Extract loading state from query state
 */
function extractLoading(queryState: unknown): boolean {
    if (!queryState || typeof queryState !== "object") return false
    return (queryState as {isPending?: boolean}).isPending ?? false
}

/**
 * Testsets list atom wrapped for selection
 */
const testsetsListAtom = atom((get): ListQueryState<unknown> => {
    // Read config from atom so this re-evaluates when config changes
    const atomConfig = get(atomConfigAtom)
    if (!atomConfig) {
        return {data: [], isPending: false, isError: false, error: null}
    }
    const queryState = get(atomConfig.testsetsListAtom)
    return {
        // Testsets query returns { testsets: [...], count: N }
        data: extractData(queryState, "testsets"),
        isPending: extractLoading(queryState),
        isError: false,
        error: null,
    }
})

/**
 * Revisions by testset atom family wrapped for selection
 */
function revisionsByTestsetListAtom(testsetId: string): Atom<ListQueryState<unknown>> {
    return atom((get) => {
        // Read config from atom so this re-evaluates when config changes
        const atomConfig = get(atomConfigAtom)
        if (!atomConfig) {
            return {data: [], isPending: false, isError: false, error: null}
        }
        const queryState = get(atomConfig.revisionsListFamily(testsetId))
        return {
            data: extractData(queryState),
            isPending: extractLoading(queryState),
            isError: false,
            error: null,
        }
    })
}

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * Testset selection adapter
 *
 * Hierarchy: Testset → Revision
 *
 * @example
 * ```typescript
 * import { testsetAdapter } from '@agenta/entities/ui/selection'
 * import { useHierarchicalSelection } from '@agenta/entities/ui/selection'
 *
 * const { items, navigateDown, select } = useHierarchicalSelection({
 *   adapter: testsetAdapter,
 *   instanceId: 'my-selector',
 *   onSelect: (selection) => console.log('Selected testset revision:', selection),
 * })
 * ```
 */
export const testsetAdapter = createAdapter<TestsetSelectionResult>({
    name: "testset",
    entityType: "revision",
    levels: [
        {
            type: "testset",
            label: "Testset",
            autoSelectSingle: false,
            listAtom: testsetsListAtom,
            getId: (testset: unknown) => (testset as {id: string}).id,
            getLabel: (testset: unknown) => (testset as {name: string}).name,
            getDescription: (testset: unknown) => {
                const t = testset as {description?: string}
                return t.description
            },
            hasChildren: () => true,
            isSelectable: () => false,
        },
        // Use shared revision level factory for git-based entity display
        createRevisionLevel({
            type: "revision",
            label: "Revision",
            autoSelectSingle: true,
            listAtomFamily: revisionsByTestsetListAtom,
            onBeforeLoad: (testsetId: string) => {
                // Enable the revisions query for this testset
                const store = getDefaultStore()
                const config = store.get(atomConfigAtom)
                config?.enableRevisionsQuery?.(testsetId)
            },
        }),
    ],
    selectableLevel: 1,
    toSelection: (path: SelectionPathItem[], leafEntity: unknown): TestsetSelectionResult => {
        const revision = leafEntity as {
            id: string
            version?: number
            revision?: number
            message?: string
        }
        const testset = path[0]
        const revisionItem = path[1]

        return {
            type: "revision",
            id: revision.id,
            label: `${testset?.label ?? "Testset"} / ${revisionItem?.label ?? "Revision"}`,
            path,
            metadata: {
                testsetId: testset?.id ?? "",
                testsetName: testset?.label ?? "",
                revisionId: revision.id,
                version: revision.version ?? revision.revision ?? 0,
                commitMessage: revision.message,
            },
        }
    },
    emptyMessage: "No testsets found",
    loadingMessage: "Loading testsets...",
})
