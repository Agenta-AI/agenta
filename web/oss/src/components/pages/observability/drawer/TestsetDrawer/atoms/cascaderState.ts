import {atom} from "jotai"

import {
    fetchTestsetRevisions,
    TestsetRevision,
} from "@/oss/components/TestsetsTable/atoms/fetchTestsetRevisions"

import {buildRevisionLabel, buildSelectedRevisionLabel} from "../components/RevisionLabel"

import {cascaderOptionsAtom} from "./testsetQueries"

/**
 * Cascader State Atoms
 *
 * Manages the cascader UI state for testset/revision selection.
 * Uses atoms to prevent prop drilling between components.
 */

// ============================================================================
// CASCADER UI STATE
// ============================================================================

/** Currently selected cascader value path [testsetId] or [testsetId, revisionId] */
export const cascaderValueAtom = atom<string[]>([])

/** Loading state for revision fetching */
export const loadingRevisionsAtom = atom<boolean>(false)

/** New testset name input (for create mode) */
export const newTestsetNameAtom = atom<string>("")

/** Selected testset info */
export const selectedTestsetInfoAtom = atom<{name: string; id: string}>({name: "", id: ""})

/** Available revisions for the selected testset */
export const availableRevisionsAtom = atom<{id: string; version: number | null}[]>([])

/**
 * Loaded children state - maps testsetId to loaded revision children
 * This is the mutable state that stores loaded revisions per testset
 */
export const loadedChildrenAtom = atom<Map<string, any[]>>(new Map())

/**
 * Loading state per testset - maps testsetId to loading boolean
 */
export const loadingTestsetAtom = atom<Map<string, boolean>>(new Map())

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/** Is the current selection a "Create New" testset? */
export const isNewTestsetAtom = atom((get) => {
    const testsetInfo = get(selectedTestsetInfoAtom)
    return testsetInfo.id === "create"
})

/**
 * Cascader options with dynamically loaded revision children
 * This is a DERIVED atom that merges base options with loaded children
 * No useEffect sync needed - it automatically updates when dependencies change
 */
export const cascaderOptionsWithChildrenAtom = atom(
    // Read: merge base options with loaded children
    (get) => {
        const baseOptions = get(cascaderOptionsAtom)
        const loadedChildren = get(loadedChildrenAtom)
        const loadingTestsets = get(loadingTestsetAtom)

        return baseOptions.map((opt) => {
            const children = loadedChildren.get(opt.value)
            const isLoading = loadingTestsets.get(opt.value) || false

            if (children) {
                return {...opt, children, loading: isLoading}
            }
            if (isLoading) {
                return {...opt, loading: true}
            }
            return opt
        })
    },
    // Write: update loaded children for a specific testset
    (get, set, update: {testsetId: string; children: any[]} | "clear") => {
        if (update === "clear") {
            set(loadedChildrenAtom, new Map())
            set(loadingTestsetAtom, new Map())
            return
        }

        const {testsetId, children} = update
        const current = get(loadedChildrenAtom)
        const newMap = new Map(current)
        newMap.set(testsetId, children)
        set(loadedChildrenAtom, newMap)
    },
)

/** Build revision option for cascader with rich label */
const buildRevisionOption = (revision: TestsetRevision) => ({
    value: revision.id,
    label: buildRevisionLabel(revision),
    isLeaf: true,
    revisionMeta: revision,
})

/** Load revisions for a testset (cascader loadData) */
export const loadRevisionsAtom = atom(
    null,
    async (get, set, testsetId: string): Promise<TestsetRevision[]> => {
        if (!testsetId || testsetId === "create") {
            return []
        }

        set(loadingRevisionsAtom, true)

        // Set loading state for this testset
        const currentLoading = get(loadingTestsetAtom)
        const newLoadingMap = new Map(currentLoading)
        newLoadingMap.set(testsetId, true)
        set(loadingTestsetAtom, newLoadingMap)

        try {
            const revisions = await fetchTestsetRevisions({testsetId})
            const revisionChildren = revisions.map((rev) => buildRevisionOption(rev))

            const children =
                revisionChildren.length > 0
                    ? revisionChildren
                    : [
                          {
                              value: "no-revisions",
                              label: "No revisions available",
                              disabled: true,
                              isLeaf: true,
                          },
                      ]

            // Update loaded children via the derived atom's write function
            set(cascaderOptionsWithChildrenAtom, {testsetId, children})

            // Clear loading state for this testset
            const updatedLoading = get(loadingTestsetAtom)
            const clearedLoadingMap = new Map(updatedLoading)
            clearedLoadingMap.set(testsetId, false)
            set(loadingTestsetAtom, clearedLoadingMap)

            // Update available revisions
            set(
                availableRevisionsAtom,
                revisions.map((rev) => ({
                    id: rev.id,
                    version: rev.version != null ? Number(rev.version) : null,
                })),
            )

            return revisions
        } catch (error) {
            console.error("[loadRevisionsAtom] Error:", error)

            // Set error children
            set(cascaderOptionsWithChildrenAtom, {
                testsetId,
                children: [
                    {
                        value: "error",
                        label: "Failed to load revisions",
                        disabled: true,
                        isLeaf: true,
                    },
                ],
            })

            // Clear loading state
            const updatedLoading = get(loadingTestsetAtom)
            const clearedLoadingMap = new Map(updatedLoading)
            clearedLoadingMap.set(testsetId, false)
            set(loadingTestsetAtom, clearedLoadingMap)

            return []
        } finally {
            set(loadingRevisionsAtom, false)
        }
    },
)

/** Reset cascader state */
export const resetCascaderStateAtom = atom(null, (_get, set) => {
    set(cascaderValueAtom, [])
    set(newTestsetNameAtom, "")
    set(selectedTestsetInfoAtom, {name: "", id: ""})
    set(availableRevisionsAtom, [])
    // Clear loaded children via the derived atom's write function
    set(cascaderOptionsWithChildrenAtom, "clear")
})

// ============================================================================
// LABEL RENDERING HELPERS
// ============================================================================

/**
 * Render selected revision label for cascader display
 * Returns a React node with testset name and version in a gray box
 */
export const renderSelectedRevisionLabel = (
    labels: string[],
    selectedOptions?: any[],
): React.ReactNode => {
    if (!selectedOptions || selectedOptions.length === 0) {
        return labels.join(" / ")
    }

    const baseLabel =
        typeof selectedOptions[0]?.label === "string"
            ? selectedOptions[0].label
            : typeof labels?.[0] === "string"
              ? labels[0]
              : "Selected testset"

    const revisionOption = selectedOptions[selectedOptions.length - 1]
    const revisionVersion = revisionOption?.revisionMeta?.version

    if (!revisionVersion) {
        return baseLabel
    }

    return buildSelectedRevisionLabel(baseLabel, revisionVersion)
}
