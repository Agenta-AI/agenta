import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import type {RevisionListItem} from "@/oss/state/entities/testset"
import {enableRevisionsListQueryAtom} from "@/oss/state/entities/testset/revisionEntity"
import {projectIdAtom} from "@/oss/state/project"
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
 *
 * IMPORTANT: We intentionally DON'T react to loadingTestsetAtom changes here
 * to prevent cascader flickering. The Cascader's loadData handles loading internally.
 * We only update options when actual children data is loaded.
 */
export const cascaderOptionsWithChildrenAtom = atom(
    // Read: merge base options with loaded children only
    (get) => {
        const baseOptions = get(cascaderOptionsAtom)
        const loadedChildren = get(loadedChildrenAtom)

        return baseOptions.map((opt) => {
            const children = loadedChildren.get(opt.value)
            if (children) {
                return {...opt, children}
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

/**
 * Fetch revisions list using the same query key as revisionsListQueryAtomFamily
 * This ensures cache is shared between cascader and entity atoms
 */
async function fetchRevisionsForCascader(
    projectId: string,
    testsetId: string,
): Promise<RevisionListItem[]> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 100, order: "descending"},
            include_testcases: false,
        },
        {params: {project_id: projectId}},
    )

    const revisions = response.data?.testset_revisions ?? []
    // Transform to RevisionListItem format (same as revisionsListQueryAtomFamily)
    return revisions.map((raw: any) => {
        const {data: _data, ...rest} = raw
        return {
            id: rest.id,
            version:
                typeof rest.version === "string"
                    ? parseInt(rest.version, 10)
                    : rest.version !== null && rest.version !== undefined
                      ? rest.version
                      : 0,
            created_at: rest.created_at ?? rest.date ?? rest.commit?.date,
            message: rest.message ?? rest.commit_message ?? rest.commit?.message,
            author:
                rest.author ??
                rest.created_by_id ??
                rest.commit?.author_id ??
                rest.commit?.author?.id ??
                null,
            created_by_id: rest.created_by_id,
        }
    })
}

/** Load revisions for a testset (cascader loadData) - uses query client for cache sharing */
export const loadRevisionsAtom = atom(
    null,
    async (get, set, testsetId: string): Promise<RevisionListItem[]> => {
        if (!testsetId || testsetId === "create") {
            return []
        }

        const projectId = get(projectIdAtom)
        if (!projectId) {
            return []
        }

        // Check if children are already loaded locally - no fetch needed
        const loadedChildren = get(loadedChildrenAtom)
        if (loadedChildren.has(testsetId)) {
            // Already loaded, return cached revisions
            const cachedRevisions = get(loadedRevisionsMapAtom).get(testsetId)
            return cachedRevisions ?? []
        }

        const queryClient = get(queryClientAtom)
        const queryKey = ["revisions-list", projectId, testsetId]

        // Check query cache - if fresh data exists, use it without loading state
        const cachedData = queryClient.getQueryData<RevisionListItem[]>(queryKey)
        const queryState = queryClient.getQueryState(queryKey)
        const isFresh =
            cachedData && queryState && Date.now() - (queryState.dataUpdatedAt || 0) < 30_000

        if (isFresh && cachedData) {
            // Use cached data immediately - no loading state, no flicker
            const revisionChildren = cachedData.map((rev) => buildRevisionOption(rev))
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

            set(cascaderOptionsWithChildrenAtom, {testsetId, children})

            const currentCache = get(loadedRevisionsMapAtom)
            const newCache = new Map(currentCache)
            newCache.set(testsetId, cachedData)
            set(loadedRevisionsMapAtom, newCache)

            return cachedData
        }

        // Enable the entity query (for other components that might subscribe)
        set(enableRevisionsListQueryAtom, testsetId)

        // Only set loading state when actually fetching
        const currentLoading = get(loadingTestsetAtom)
        const newLoadingMap = new Map(currentLoading)
        newLoadingMap.set(testsetId, true)
        set(loadingTestsetAtom, newLoadingMap)
        set(loadingRevisionsAtom, true)

        try {
            // Use queryClient.fetchQuery with the same query key as revisionsListQueryAtomFamily
            const revisions = await queryClient.fetchQuery({
                queryKey,
                queryFn: () => fetchRevisionsForCascader(projectId, testsetId),
                staleTime: 30_000,
            })

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
        } catch (error) {
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
        } finally {
            // Clear loading state
            const updatedLoading = get(loadingTestsetAtom)
            const clearedLoadingMap = new Map(updatedLoading)
            clearedLoadingMap.set(testsetId, false)
            set(loadingTestsetAtom, clearedLoadingMap)
            set(loadingRevisionsAtom, false)
        }
    },
)

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

    // Use textLabel (preserved original string) or fall back to labels array
    const baseLabel =
        typeof selectedOptions[0]?.textLabel === "string"
            ? selectedOptions[0].textLabel
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
