import {atom} from "jotai"

import {revisionsListQueryAtomFamily, type RevisionListItem} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {
    availableRevisionsAtom as sharedAvailableRevisionsAtom,
    isNewTestsetAtom as sharedIsNewTestsetAtom,
    loadedRevisionsMapAtom,
    loadingRevisionsAtom as sharedLoadingRevisionsAtom,
    loadingTestsetMapAtom,
    resetSelectionAtom,
    selectedTestsetInfoAtom as sharedSelectedTestsetInfoAtom,
} from "@/oss/state/testsetSelection"

import {buildRevisionLabel, buildSelectedRevisionLabel} from "../components/RevisionLabel"

import {cascaderOptionsAtom} from "./testsetQueries"

/**
 * Cascader State Atoms
 *
 * Manages the cascader UI state for testset/revision selection.
 * Re-exports shared selection atoms and adds cascader-specific UI state.
 */

// ============================================================================
// RE-EXPORT SHARED SELECTION ATOMS
// ============================================================================

/** Re-export: Loading state for revision fetching */
export const loadingRevisionsAtom = sharedLoadingRevisionsAtom

/** Re-export: Selected testset info */
export const selectedTestsetInfoAtom = sharedSelectedTestsetInfoAtom

/** Re-export: Available revisions for the selected testset */
export const availableRevisionsAtom = sharedAvailableRevisionsAtom

/** Re-export: Is the current selection a "Create New" testset? */
export const isNewTestsetAtom = sharedIsNewTestsetAtom

// ============================================================================
// CASCADER-SPECIFIC UI STATE
// ============================================================================

/** Currently selected cascader value path [testsetId] or [testsetId, revisionId] */
export const cascaderValueAtom = atom<string[]>([])

/** New testset name input (for create mode) */
export const newTestsetNameAtom = atom<string>("")

/**
 * Loaded children state - maps testsetId to loaded revision children
 * This is the mutable state that stores loaded revisions per testset
 */
export const loadedChildrenAtom = atom<Map<string, any[]>>(new Map())

/**
 * Loading state per testset - maps testsetId to loading boolean
 * Re-export from shared module
 */
export const loadingTestsetAtom = loadingTestsetMapAtom

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
const buildRevisionOption = (revision: RevisionListItem) => ({
    value: revision.id,
    label: buildRevisionLabel(revision),
    isLeaf: true,
    revisionMeta: revision,
})

/** Load revisions for a testset (cascader loadData) */
export const loadRevisionsAtom = atom(null, (get, set, testsetId: string): RevisionListItem[] => {
    if (!testsetId || testsetId === "create") {
        return []
    }

    // Use centralized entity store query instead of manual fetch
    const revisionsQuery = get(revisionsListQueryAtomFamily(testsetId))

    // Update loading state for this testset
    const currentLoading = get(loadingTestsetAtom)
    const newLoadingMap = new Map(currentLoading)
    newLoadingMap.set(testsetId, revisionsQuery.isPending)
    set(loadingTestsetAtom, newLoadingMap)
    set(loadingRevisionsAtom, revisionsQuery.isPending)

    if (revisionsQuery.isError) {
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
        return []
    }

    const revisions = revisionsQuery.data || []
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

    // Update shared revisions cache for cross-component access
    const currentCache = get(loadedRevisionsMapAtom)
    const newCache = new Map(currentCache)
    newCache.set(testsetId, revisions)
    set(loadedRevisionsMapAtom, newCache)

    return revisions
})

/** Reset cascader state */
export const resetCascaderStateAtom = atom(null, (_get, set) => {
    // Reset cascader-specific UI state
    set(cascaderValueAtom, [])
    set(newTestsetNameAtom, "")
    // Clear loaded children via the derived atom's write function
    set(cascaderOptionsWithChildrenAtom, "clear")
    // Reset shared selection state
    set(resetSelectionAtom)
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
