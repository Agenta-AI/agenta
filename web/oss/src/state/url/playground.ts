// Import legacyAppRevision to ensure the snapshot adapter is registered
// This side-effect import must happen before any snapshot operations
import "@agenta/entities/legacyAppRevision"

import {
    isLocalDraftId,
    legacyAppRevisionMolecule,
    localDraftIdsAtom,
    revisionCacheVersionAtom,
} from "@agenta/entities/legacyAppRevision"
import {
    urlSnapshotController,
    setRunnableTypeResolver,
    setSelectionUpdateCallback,
    isPlaceholderId,
    pendingHydrations,
    pendingHydrationsAtom,
    applyPendingHydrationsForRevision,
} from "@agenta/playground"
import {atom, getDefaultStore} from "jotai"
import type {Store} from "jotai/vanilla/store"

import {
    selectedVariantsAtom,
    urlRevisionsAtom,
    isSelectionStorageHydrated,
    revisionListAtom,
    playgroundRevisionListAtom,
    playgroundRevisionsReadyAtom,
    playgroundLatestRevisionIdAtom,
} from "@/oss/components/Playground/state/atoms"
import {appStateSnapshotAtom} from "@/oss/state/appState"

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
 * Extract snapshot parameter from URL hash.
 * Hash format: #pgSnapshot=<encoded>
 *
 * NOTE: We manually parse instead of using URLSearchParams because
 * URLSearchParams decodes '+' as space (per x-www-form-urlencoded spec),
 * which corrupts LZ-String's compressToEncodedURIComponent output that
 * legitimately contains '+' characters.
 */
const extractSnapshotFromHash = (url: URL): string | null => {
    const hash = url.hash
    if (!hash || !hash.startsWith("#")) return null

    const raw = hash.slice(1) // remove leading '#'
    const prefix = `${SNAPSHOT_HASH_PARAM}=`
    const startIdx = raw.indexOf(prefix)
    if (startIdx === -1) return null

    const valueStart = startIdx + prefix.length
    const ampIdx = raw.indexOf("&", valueStart)
    return ampIdx === -1 ? raw.slice(valueStart) : raw.slice(valueStart, ampIdx)
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

    // viewTypeAtom was removed - isComparisonViewAtom derives comparison state
    // directly from selectedVariantsAtom, so no manual sync needed.
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

    // Derives from the same entity store that powers the playground's revision
    // list, so it's always available when the playground's data has loaded.
    const latestRevisionId = store.get(playgroundLatestRevisionIdAtom)
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
        // NOTE: Read directly from the pendingHydrations Map instead of the atom selector,
        // because the atom (pendingHydrationCountAtom) has no Jotai dependencies and caches
        // its initial value, making it stale when hydrations are added later.
        if (pendingHydrations.size > 0 && isPlaygroundRoute) {
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

// ============================================================================
// DERIVED ATOM: Draft hash for URL sync
// ============================================================================

/**
 * Derived atom that computes a hash of all selected revisions' draft states.
 * Used by the playgroundSyncAtom subscription to detect draft changes and
 * update the URL accordingly. Moved here from usePlaygroundUrlSync.ts to
 * decouple from React.
 */
const selectedDraftHashAtom = atom((get) => {
    const selectedVariants = get(selectedVariantsAtom)

    const parts = selectedVariants.map((revisionId) => {
        const isDirty = get(legacyAppRevisionMolecule.atoms.isDirty(revisionId))
        const draft = get(legacyAppRevisionMolecule.atoms.draft(revisionId))
        const draftHash = draft ? JSON.stringify(draft) : ""
        return `${revisionId}:${isDirty}:${draftHash}`
    })

    return parts.join("|")
})

// ============================================================================
// PLAYGROUND SYNC ATOM
// ============================================================================

/**
 * Imperative playground state synchronization atom.
 *
 * Uses `onMount` to set up `store.sub()` subscriptions that replace
 * the React useEffect hooks from usePlaygroundUrlSync and MainLayout.
 *
 * Responsibilities:
 * 1. Apply pending hydrations when server data loads (replaces usePlaygroundUrlSync Effect 2)
 * 2. Apply default selection when revisions load (replaces usePlaygroundUrlSync Effect 1)
 * 3. Update URL when draft content changes (replaces usePlaygroundUrlSync Effect 3)
 * 4. Clean stale IDs from selection (replaces MainLayout validation useEffect)
 *
 * Mount this atom via `useAtomValue(playgroundSyncAtom)` at the Playground root.
 */
export const playgroundSyncAtom = atom(0)

playgroundSyncAtom.onMount = (set) => {
    if (!isBrowser) return

    const store = getDefaultStore()
    const unsubs: (() => void)[] = []

    // -----------------------------------------------------------------------
    // SUB 1: Apply pending hydrations when server data loads
    // -----------------------------------------------------------------------
    // Track which source IDs we're subscribed to, so we can add/remove subs dynamically
    const sourceIdSubs = new Map<string, () => void>()

    const reconcilePendingHydrationSubs = () => {
        const pending = store.get(pendingHydrationsAtom)

        // Collect current source IDs
        const currentSourceIds = new Set<string>()
        for (const [, hydration] of pending.entries()) {
            currentSourceIds.add(hydration.sourceRevisionId)
        }

        // Remove subs for source IDs no longer pending
        for (const [sourceId, unsub] of sourceIdSubs.entries()) {
            if (!currentSourceIds.has(sourceId)) {
                unsub()
                sourceIdSubs.delete(sourceId)
            }
        }

        // Add subs for new source IDs
        for (const sourceId of currentSourceIds) {
            if (sourceIdSubs.has(sourceId)) continue

            const serverDataAtom = legacyAppRevisionMolecule.atoms.serverData(sourceId)
            const unsub = store.sub(serverDataAtom, () => {
                const serverData = store.get(serverDataAtom)
                if (serverData && serverData.variantId) {
                    // Apply all pending hydrations for this source via the
                    // ordered helper — it processes createLocalDraft entries
                    // before applyDraftPatch entries so local copies are
                    // cloned from clean server data.
                    applyPendingHydrationsForRevision(sourceId)
                }
            })
            sourceIdSubs.set(sourceId, unsub)
        }
    }

    // Subscribe to pendingHydrationsAtom to manage per-source subscriptions
    const unsubPending = store.sub(pendingHydrationsAtom, () => {
        reconcilePendingHydrationSubs()
        set((prev) => prev + 1)
    })
    unsubs.push(unsubPending)

    // Initial reconciliation for any hydrations already pending at mount time
    reconcilePendingHydrationSubs()

    // Also do an immediate check for any pending hydrations whose source data is already loaded
    {
        const pending = store.get(pendingHydrationsAtom)
        // Collect unique source IDs that are ready, then apply via the ordered helper
        const readySourceIds = new Set<string>()
        for (const [, hydration] of pending.entries()) {
            const serverData = store.get(
                legacyAppRevisionMolecule.atoms.serverData(hydration.sourceRevisionId),
            )
            if (serverData && serverData.variantId) {
                readySourceIds.add(hydration.sourceRevisionId)
            }
        }
        for (const sourceId of readySourceIds) {
            applyPendingHydrationsForRevision(sourceId)
        }
    }

    // -----------------------------------------------------------------------
    // SUB 2: Apply default selection when revisions load
    // -----------------------------------------------------------------------
    // Uses dual subscription: revisionListAtom fires when data arrives,
    // playgroundRevisionsReadyAtom fires when ALL variant revision queries
    // have completed. Both are needed because revisionListAtom may fire
    // before readiness (partial data), and readiness may fire after the
    // revision list has already settled.
    let hasAppliedDefaults = false
    const tryApplyDefaults = () => {
        if (hasAppliedDefaults) return
        const isReady = store.get(playgroundRevisionsReadyAtom)
        if (!isReady) return

        // Bump the revision cache version so that revisionListItemFromCacheAtomFamily
        // re-evaluates now that revision list queries have completed and populated the
        // React Query cache. This unlocks the fast enriched query path for entity data.
        store.set(revisionCacheVersionAtom, (prev: number) => prev + 1)

        const selected = store.get(selectedVariantsAtom)
        if (selected.length > 0) {
            hasAppliedDefaults = true
            return
        }
        hasAppliedDefaults = true
        ensurePlaygroundDefaults(store)
    }
    const unsubRevisions = store.sub(revisionListAtom, tryApplyDefaults)
    const unsubReady = store.sub(playgroundRevisionsReadyAtom, tryApplyDefaults)
    unsubs.push(unsubRevisions)
    unsubs.push(unsubReady)

    // -----------------------------------------------------------------------
    // SUB 3: Update URL when draft content changes
    // -----------------------------------------------------------------------
    let prevDraftHash = store.get(selectedDraftHashAtom)
    const unsubDraftHash = store.sub(selectedDraftHashAtom, () => {
        const hash = store.get(selectedDraftHashAtom)
        if (hash !== prevDraftHash) {
            prevDraftHash = hash
            updatePlaygroundUrlWithDrafts()
        }
    })
    unsubs.push(unsubDraftHash)

    // -----------------------------------------------------------------------
    // SUB 4: Clean stale IDs from selection when revision list changes
    // (replaces MainLayout validation useEffect)
    // -----------------------------------------------------------------------
    const unsubValidation = store.sub(playgroundRevisionListAtom, () => {
        const revisionList = store.get(playgroundRevisionListAtom)
        if (!revisionList || revisionList.length === 0) return

        const selected = store.get(selectedVariantsAtom)
        if (selected.length === 0) return

        // Don't filter until all revision queries have completed.
        // During incremental loading, some variants' revisions may not be
        // in the list yet — filtering now would incorrectly remove them.
        const isReady = store.get(playgroundRevisionsReadyAtom)
        if (!isReady) return

        const revisionIds = new Set(
            revisionList.map((revision: any) => revision?.id).filter(Boolean),
        )

        const trackedLocalDraftIds = new Set(store.get(localDraftIdsAtom) || [])

        const valid = selected.filter((id) => {
            if (revisionIds.has(id) || isPlaceholderId(id)) return true
            if (isLocalDraftId(id)) return trackedLocalDraftIds.has(id)
            return false
        })

        if (process.env.NODE_ENV !== "production" && !arraysEqual(valid, selected)) {
            const removed = selected.filter((id) => !valid.includes(id))
            console.log("[SUB4] Cleaning stale IDs", {
                selected,
                valid,
                removed,
                revisionIdsInList: [...revisionIds],
            })
        }

        if (valid.length === 0) {
            ensurePlaygroundDefaults(store)
        } else if (!arraysEqual(valid, selected)) {
            store.set(selectedVariantsAtom, valid)
            writePlaygroundSelectionToQuery(valid)
        }
    })
    unsubs.push(unsubValidation)

    // -----------------------------------------------------------------------
    // CLEANUP
    // -----------------------------------------------------------------------
    return () => {
        for (const unsub of unsubs) unsub()
        for (const [, unsub] of sourceIdSubs) unsub()
        sourceIdSubs.clear()
    }
}
