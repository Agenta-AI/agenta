// Import legacyAppRevision to ensure the snapshot adapter is registered
// This side-effect import must happen before any snapshot operations
import "@agenta/entities/legacyAppRevision"

import {
    urlSnapshotController,
    setRunnableTypeResolver,
    setSelectionUpdateCallback,
    isPlaceholderId,
} from "@agenta/playground"
import {getDefaultStore} from "jotai"
import type {Store} from "jotai/vanilla/store"

import {
    selectedVariantsAtom,
    viewTypeAtom,
    urlRevisionsAtom,
    isSelectionStorageHydrated,
} from "@/oss/components/Playground/state/atoms"
import {appStateSnapshotAtom} from "@/oss/state/appState"
import {latestAppRevisionIdAtom} from "@/oss/state/variant/selectors/variant"

// ============================================================================
// OSS RUNNABLE TYPE RESOLVER
// ============================================================================

/**
 * Register the OSS runnable type resolver.
 * For OSS, all revisions are legacyAppRevision type.
 */
setRunnableTypeResolver({
    getType: () => "legacyAppRevision",
})

// ============================================================================
// SELECTION UPDATE CALLBACK
// ============================================================================

/**
 * Register the selection update callback for pending hydrations.
 * When a local draft is created from a pending hydration, this callback
 * updates the playground selection to replace the placeholder/source ID
 * with the new local draft ID.
 */
setSelectionUpdateCallback((idToReplace, localDraftId, index) => {
    const store = getDefaultStore()
    const currentSelection = store.get(selectedVariantsAtom)

    // For placeholder IDs (compare mode), find by the placeholder ID
    // For source IDs (single mode), find by the source ID at the given index
    let targetIndex = index
    if (isPlaceholderId(idToReplace)) {
        // Find the placeholder in the selection
        targetIndex = currentSelection.findIndex((id) => id === idToReplace)
    }

    // Replace the ID at the target index with the local draft ID
    if (targetIndex >= 0 && targetIndex < currentSelection.length) {
        const newSelection = [...currentSelection]
        newSelection[targetIndex] = localDraftId
        store.set(selectedVariantsAtom, newSelection)

        // Also update URL revisions atom
        const currentUrlRevisions = store.get(urlRevisionsAtom)
        if (targetIndex < currentUrlRevisions.length) {
            const newUrlRevisions = [...currentUrlRevisions]
            newUrlRevisions[targetIndex] = localDraftId
            store.set(urlRevisionsAtom, newUrlRevisions)
        }
    }
})

const isBrowser = typeof window !== "undefined"
const SNAPSHOT_HASH_PARAM = "pgSnapshot"
const REVISIONS_QUERY_PARAM = "revisions"

/** RAF handle for coalescing URL updates */
let urlUpdateRafId: number | null = null

/** Track the last URL we wrote to prevent re-processing our own changes */
let lastWrittenUrl: string | null = null

/**
 * Clear the snapshot hash from the URL.
 * Called after successful patch application.
 */
export const clearSnapshotFromUrl = () => {
    if (!isBrowser) return

    const currentHash = window.location.hash
    if (!currentHash || !currentHash.includes(SNAPSHOT_HASH_PARAM)) return

    const cleanUrl = `${window.location.pathname}${window.location.search}`
    lastWrittenUrl = cleanUrl
    window.history.replaceState(window.history.state, "", cleanUrl)
}

/**
 * Extract snapshot parameter from URL hash.
 * Hash format: #pgSnapshot=<encoded>
 */
const extractSnapshotFromHash = (url: URL): string | null => {
    const hash = url.hash
    if (!hash || !hash.startsWith("#")) return null

    // Parse hash as query params (after removing #)
    const hashParams = new URLSearchParams(hash.slice(1))
    return hashParams.get(SNAPSHOT_HASH_PARAM)
}

/**
 * Track the last snapshot hash we wrote to prevent re-hydration loops.
 */
let lastWrittenSnapshotHash: string | null = null

const sanitizeRevisionList = (values: (string | null | undefined)[]) => {
    const seen = new Set<string>()
    const result: string[] = []
    values.forEach((value) => {
        if (value === null || value === undefined) return
        const str = String(value).trim()
        if (!str || str === "null" || str === "undefined") return
        if (seen.has(str)) return
        seen.add(str)
        result.push(str)
    })
    return result
}

const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

/**
 * Write the current playground selection to the URL.
 * Uses urlSnapshotController.buildUrlComponents for entity-agnostic snapshot building.
 */
export const writePlaygroundSelectionToQuery = (selection: string[]) => {
    if (!isBrowser) return

    // Cancel any pending RAF to coalesce rapid updates
    if (urlUpdateRafId !== null) {
        cancelAnimationFrame(urlUpdateRafId)
        urlUpdateRafId = null
    }

    // Use RAF to coalesce updates within the same frame
    urlUpdateRafId = requestAnimationFrame(() => {
        urlUpdateRafId = null
        try {
            const sanitized = sanitizeRevisionList(selection)
            const store = getDefaultStore()

            // Build the new URL with query params and hash
            const url = new URL(window.location.href)

            // Use package controller to build URL components
            const urlComponents = store.set(
                urlSnapshotController.actions.buildUrlComponents,
                sanitized,
            )

            if (!urlComponents.ok) {
                console.warn("Failed to build URL components:", urlComponents.error)
                return
            }

            // Set query param
            if (urlComponents.queryParam) {
                url.searchParams.set(REVISIONS_QUERY_PARAM, urlComponents.queryParam)
            } else {
                url.searchParams.delete(REVISIONS_QUERY_PARAM)
            }

            // Set hash param
            if (urlComponents.hashParam) {
                url.hash = `${SNAPSHOT_HASH_PARAM}=${urlComponents.hashParam}`
                lastWrittenSnapshotHash = urlComponents.hashParam
            } else {
                url.hash = ""
                lastWrittenSnapshotHash = null
            }

            const newUrl = `${url.pathname}${url.search}${url.hash}`

            // Only update if URL actually changed and we didn't just write this URL
            if (newUrl !== lastWrittenUrl) {
                lastWrittenUrl = newUrl
                window.history.replaceState(window.history.state, "", newUrl)
            }
        } catch (error) {
            console.error("Failed to write playground state to URL:", error)
        }
    })
}

/**
 * Update the URL to reflect current draft state without changing selection.
 * Call this when draft content changes (e.g., prompt edits).
 */
export const updatePlaygroundUrlWithDrafts = () => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const currentSelected = sanitizeRevisionList(store.get(selectedVariantsAtom))

        if (currentSelected.length > 0) {
            writePlaygroundSelectionToQuery(currentSelected)
        }
    } catch (error) {
        console.error("Failed to update playground URL with drafts:", error)
    }
}

const applyPlaygroundSelection = (store: Store, next: string[]) => {
    const sanitized = sanitizeRevisionList(next)
    const currentSelected = sanitizeRevisionList(store.get(selectedVariantsAtom))

    // Preserve local drafts that are in current selection but not in URL
    // (local drafts are filtered out when writing to URL, so we need to keep them)
    const localDraftsInCurrent = currentSelected.filter((id) => isLocalDraftId(id))
    const mergedSelection =
        sanitized.length > 0
            ? [...sanitized, ...localDraftsInCurrent.filter((id) => !sanitized.includes(id))]
            : sanitized

    if (!arraysEqual(currentSelected, mergedSelection)) {
        store.set(selectedVariantsAtom, mergedSelection)
    }

    const currentUrlSelection = sanitizeRevisionList(store.get(urlRevisionsAtom))
    if (!arraysEqual(currentUrlSelection, sanitized)) {
        store.set(urlRevisionsAtom, sanitized)
    }

    const nextViewType = mergedSelection.length > 1 ? "comparison" : "single"
    if (store.get(viewTypeAtom) !== nextViewType) {
        store.set(viewTypeAtom, nextViewType)
    }
}

let lastPlaygroundAppId: string | null = null

export const ensurePlaygroundDefaults = (store: Store) => {
    if (!isBrowser) return

    const appState = store.get(appStateSnapshotAtom)
    if (
        !appState.pathname?.includes("/playground") ||
        appState.pathname?.includes("/playground-test")
    )
        return

    const urlSelection = sanitizeRevisionList(store.get(urlRevisionsAtom))
    if (urlSelection.length > 0) return

    // Don't apply defaults if storage hasn't been hydrated yet
    // This prevents overwriting persisted selections before they're loaded from localStorage
    if (!isSelectionStorageHydrated()) return

    // Check if there's already a valid selection
    const selected = sanitizeRevisionList(store.get(selectedVariantsAtom))

    // If there are valid selected revisions, don't override
    if (selected.length > 0) return

    // Use latestAppRevisionIdAtom - same source as "Last modified" tag
    // This ensures default selection matches the tag shown in the UI
    const latestRevisionId = store.get(latestAppRevisionIdAtom)
    if (!latestRevisionId) return

    applyPlaygroundSelection(store, [latestRevisionId])
}

/**
 * Sync playground state from URL.
 * Uses urlSnapshotController.hydrateFromUrl for entity-agnostic hydration.
 */
export const syncPlaygroundStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    const fullUrl = nextUrl ? new URL(nextUrl, window.location.origin).href : window.location.href
    const normalizedUrl = `${new URL(fullUrl).pathname}${new URL(fullUrl).search}${new URL(fullUrl).hash}`

    if (normalizedUrl === lastWrittenUrl) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const isPlaygroundRoute =
            url.pathname.includes("/playground") && !url.pathname.includes("/playground-test")
        const appState = store.get(appStateSnapshotAtom)
        const currentAppId = appState.appId ?? null

        const revisionsParam = url.searchParams.get(REVISIONS_QUERY_PARAM)
        const urlRevisions = revisionsParam ? sanitizeRevisionList(revisionsParam.split(",")) : []

        const snapshotEncoded = extractSnapshotFromHash(url)

        // Use package controller for hydration
        if (snapshotEncoded && snapshotEncoded !== lastWrittenSnapshotHash && isPlaygroundRoute) {
            lastWrittenSnapshotHash = snapshotEncoded

            const hydrateResult = store.set(
                urlSnapshotController.actions.hydrateFromUrl,
                snapshotEncoded,
            )

            if (hydrateResult.ok && hydrateResult.selection) {
                applyPlaygroundSelection(store, hydrateResult.selection)
                return
            }
        }

        // Skip URL revision processing if there are pending hydrations
        // This happens when we just processed a snapshot and the selection includes placeholder IDs
        // that haven't been resolved yet. We don't want to overwrite them with deduplicated URL revisions.
        const hasPendingHydrations = store.get(
            urlSnapshotController.selectors.pendingHydrationCount,
        )
        if (hasPendingHydrations > 0 && isPlaygroundRoute) {
            return
        }

        if (urlRevisions.length > 0 && isPlaygroundRoute) {
            applyPlaygroundSelection(store, urlRevisions)
            return
        }

        const currentSelected = sanitizeRevisionList(store.get(selectedVariantsAtom))
        const currentUrlSelection = sanitizeRevisionList(store.get(urlRevisionsAtom))

        if (isPlaygroundRoute) {
            if (lastPlaygroundAppId && currentAppId && lastPlaygroundAppId !== currentAppId) {
                if (currentSelected.length > 0) {
                    store.set(selectedVariantsAtom, [])
                }
                if (currentUrlSelection.length > 0) {
                    store.set(urlRevisionsAtom, [])
                }
            }
            lastPlaygroundAppId = currentAppId
            ensurePlaygroundDefaults(store)
        } else {
            lastPlaygroundAppId = null
            if (currentUrlSelection.length > 0) {
                store.set(urlRevisionsAtom, [])
            }
        }
    } catch (err) {
        console.error("Failed to sync playground state from URL:", nextUrl, err)
    }
}
