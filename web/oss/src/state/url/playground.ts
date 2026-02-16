// Import legacyAppRevision to ensure the snapshot adapter is registered
// This side-effect import must happen before any snapshot operations
import "@agenta/entities/legacyAppRevision"

import {
    legacyAppRevisionMolecule,
    latestServerRevisionIdAtomFamily,
    appRevisionsWithDraftsAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {
    urlSnapshotController,
    setRunnableTypeResolver,
    getRunnableTypeResolver,
    setSelectionUpdateCallback,
    isPlaceholderId,
    pendingHydrations,
    pendingHydrationsAtom,
    applyPendingHydrationsForRevision,
    displayedEntityIdsAtom,
    playgroundInitializedAtom,
    playgroundController,
} from "@agenta/playground"
import {atom, getDefaultStore} from "jotai"
import type {Store} from "jotai/vanilla/store"

import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
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
    const currentSelection = store.get(playgroundController.selectors.entityIds())

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
        store.set(playgroundController.actions.setEntityIds, newSelection)
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

interface HydratedEntityDescriptor {
    id: string
    runnableType: RunnableType
    entityType?: string
    depth?: number
    label?: string
}

type RunnableType =
    | "appRevision"
    | "legacyAppRevision"
    | "evaluator"
    | "legacyEvaluator"
    | "evaluatorRevision"

type PlaygroundEntityType =
    | "appRevision"
    | "legacyAppRevision"
    | "evaluator"
    | "legacyEvaluator"
    | "evaluatorRevision"

interface SnapshotSelectionInput {
    id: string
    runnableType: RunnableType
    entityType?: PlaygroundEntityType
    depth?: number
    label?: string
}

interface PlaygroundNode {
    id: string
    entityType: string
    entityId: string
    label?: string
    depth: number
}

const entityTypeToRunnableType = (entityType: string | undefined): RunnableType | null => {
    switch (entityType) {
        case "appRevision":
            return "appRevision"
        case "legacyAppRevision":
            return "legacyAppRevision"
        case "evaluator":
            return "evaluator"
        case "legacyEvaluator":
            return "legacyEvaluator"
        case "evaluatorRevision":
            return "evaluatorRevision"
        default:
            return null
    }
}

const runnableTypeToEntityType = (runnableType: RunnableType): PlaygroundEntityType | null => {
    switch (runnableType) {
        case "appRevision":
            return "appRevision"
        case "legacyAppRevision":
            return "legacyAppRevision"
        case "evaluator":
            return "evaluator"
        case "legacyEvaluator":
            return "legacyEvaluator"
        case "evaluatorRevision":
            return "evaluatorRevision"
        default:
            return null
    }
}

const buildSnapshotSelectionInputs = (
    rootEntityIds: string[],
    nodes: PlaygroundNode[],
): SnapshotSelectionInput[] => {
    if (rootEntityIds.length === 0) return []

    const resolver = getRunnableTypeResolver()
    const hasDownstreamNodes = nodes.some((node) => node.depth > 0)
    const rootNodeByEntityId = new Map(
        nodes.filter((node) => node.depth === 0).map((node) => [node.entityId, node] as const),
    )
    const snapshotInputs: SnapshotSelectionInput[] = []

    for (const rootEntityId of rootEntityIds) {
        const node = rootNodeByEntityId.get(rootEntityId)
        const runnableType =
            entityTypeToRunnableType(node?.entityType) ?? resolver.getType(rootEntityId)
        snapshotInputs.push({
            id: rootEntityId,
            runnableType,
            ...(hasDownstreamNodes ? {depth: 0} : {}),
            ...(node?.label ? {label: node.label} : {}),
        })
    }

    for (const node of nodes) {
        if (node.depth <= 0) continue

        const runnableType = entityTypeToRunnableType(node.entityType)
        if (!runnableType) continue

        snapshotInputs.push({
            id: node.entityId,
            runnableType,
            entityType: node.entityType,
            depth: node.depth,
            ...(node.label ? {label: node.label} : {}),
        })
    }

    return snapshotInputs
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
            const nodes = store.get(playgroundController.selectors.nodes())
            const snapshotSelection = buildSnapshotSelectionInputs(sanitized, nodes)

            // Build the new URL with query params and hash
            const url = new URL(window.location.href)

            // Use package controller to build URL components
            const urlComponents = store.set(
                urlSnapshotController.actions.buildUrlComponents,
                snapshotSelection,
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
        const currentSelected = sanitizeRevisionList(
            store.get(playgroundController.selectors.entityIds()),
        )

        if (currentSelected.length > 0) {
            writePlaygroundSelectionToQuery(currentSelected)
        }
    } catch (error) {
        console.error("Failed to update playground URL with drafts:", error)
    }
}

const applyPlaygroundSelection = (
    store: Store,
    next: string[],
    hydratedEntities?: HydratedEntityDescriptor[],
) => {
    const sanitized = sanitizeRevisionList(next)
    const normalizedHydratedEntities = (hydratedEntities ?? []).filter((entity) => {
        const id = String(entity?.id ?? "").trim()
        return Boolean(id && id !== "null" && id !== "undefined")
    })

    const rootHydratedEntities = normalizedHydratedEntities.filter(
        (entity) => (entity.depth ?? 0) === 0,
    )
    const rootEntityIdsFromHydrated = sanitizeRevisionList(
        rootHydratedEntities.map((entity) => entity.id),
    )
    const rootEntityIdsFromRunnableType = sanitizeRevisionList(
        normalizedHydratedEntities
            .filter(
                (entity) =>
                    entity.runnableType === "appRevision" ||
                    entity.runnableType === "legacyAppRevision",
            )
            .map((entity) => entity.id),
    )
    const rootEntityIds =
        rootEntityIdsFromHydrated.length > 0
            ? rootEntityIdsFromHydrated
            : rootEntityIdsFromRunnableType.length > 0
              ? rootEntityIdsFromRunnableType
              : sanitized

    const currentSelected = sanitizeRevisionList(
        store.get(playgroundController.selectors.entityIds()),
    )
    const hasHydratedDownstream = normalizedHydratedEntities.some(
        (entity) => (entity.depth ?? 0) > 0,
    )

    if (arraysEqual(currentSelected, rootEntityIds) && !hasHydratedDownstream) {
        return
    }

    const currentNodes = store.get(playgroundController.selectors.nodes())

    if (currentNodes.length === 0 && rootEntityIds.length > 0) {
        const primaryHydratedEntity =
            rootHydratedEntities.find((entity) => entity.id === rootEntityIds[0]) ??
            rootHydratedEntities[0]
        const primaryEntityType =
            (primaryHydratedEntity?.entityType as PlaygroundEntityType | undefined) ??
            (primaryHydratedEntity
                ? runnableTypeToEntityType(primaryHydratedEntity.runnableType)
                : null) ??
            "legacyAppRevision"

        // No nodes yet — use addPrimaryNode for the first entity so the
        // loadable is linked to the runnable and an initial testcase row
        // is created with proper input variables.
        store.set(playgroundController.actions.addPrimaryNode, {
            type: primaryEntityType,
            id: rootEntityIds[0],
            label: primaryHydratedEntity?.label ?? rootEntityIds[0],
        })

        // If there are additional entities (comparison mode from URL),
        // add them via setEntityIds which preserves the first node.
        if (rootEntityIds.length > 1) {
            store.set(playgroundController.actions.setEntityIds, rootEntityIds)
        }
    } else {
        store.set(playgroundController.actions.setEntityIds, rootEntityIds)
    }

    if (!hasHydratedDownstream) return

    const downstreamHydratedEntities = normalizedHydratedEntities
        .filter((entity) => (entity.depth ?? 0) > 0)
        .sort((a, b) => (a.depth ?? 1) - (b.depth ?? 1))

    if (downstreamHydratedEntities.length === 0) return

    const nodesAfterRoots = store.get(playgroundController.selectors.nodes())
    const rootNode = nodesAfterRoots.find((node) => node.depth === 0)
    if (!rootNode) return

    const sourceNodeByDepth = new Map<number, string>([[0, rootNode.id]])
    for (const node of nodesAfterRoots) {
        sourceNodeByDepth.set(node.depth, node.id)
    }

    for (const downstream of downstreamHydratedEntities) {
        const depth = downstream.depth ?? 1
        const entityType =
            (downstream.entityType as PlaygroundEntityType | undefined) ??
            runnableTypeToEntityType(downstream.runnableType)
        if (!entityType) continue

        const sourceNodeId =
            sourceNodeByDepth.get(Math.max(depth - 1, 0)) ?? sourceNodeByDepth.get(0) ?? rootNode.id

        const result = store.set(playgroundController.actions.connectDownstreamNode, {
            sourceNodeId,
            entity: {
                type: entityType,
                id: downstream.id,
                label: downstream.label ?? downstream.id,
            },
        })

        if (result?.nodeId) {
            sourceNodeByDepth.set(depth, result.nodeId)
        }
    }
}

let lastPlaygroundAppId: string | null = null

export const ensurePlaygroundDefaults = (store: Store): boolean => {
    if (!isBrowser) return false

    const appState = store.get(appStateSnapshotAtom)
    if (
        !appState.pathname?.includes("/playground") ||
        appState.pathname?.includes("/playground-test")
    ) {
        console.log("[ensureDefaults] not on playground page, pathname:", appState.pathname)
        return false
    }

    // Check if there's already a valid selection
    const selected = sanitizeRevisionList(store.get(playgroundController.selectors.entityIds()))

    // If there are valid selected revisions, don't override
    if (selected.length > 0) {
        console.log("[ensureDefaults] already has selection:", selected)
        return true
    }

    // Derives from the same entity store that powers the playground's revision
    // list, so it's always available when the playground's data has loaded.
    const rawAppId = store.get(selectedAppIdAtom)
    const appId = typeof rawAppId === "string" ? rawAppId : null
    const latestRevisionId = appId ? store.get(latestServerRevisionIdAtomFamily(appId)) : null

    // Debug: show all available revisions and which one is picked
    if (appId) {
        const allRevisions = store.get(appRevisionsWithDraftsAtomFamily(appId))
        console.log("[ensureDefaults] appId:", appId, {
            totalRevisions: allRevisions.length,
            revisions: allRevisions.map((r) => ({
                id: r.id,
                revision: r.revision,
                variantName: r.variantName,
                isLocalDraft: r.isLocalDraft,
                updatedAt: r.updatedAtTimestamp,
            })),
            pickedLatestRevisionId: latestRevisionId,
        })
    } else {
        console.log("[ensureDefaults] appId:", appId, "latestRevisionId:", latestRevisionId)
    }
    if (!latestRevisionId) return false

    console.log("[ensureDefaults] applying default selection:", [latestRevisionId])
    applyPlaygroundSelection(store, [latestRevisionId])
    return true
}

/**
 * Sync playground state from URL.
 * Uses urlSnapshotController.hydrateFromUrl for entity-agnostic hydration.
 */
export const syncPlaygroundStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    const fullUrl = nextUrl ? new URL(nextUrl, window.location.origin).href : window.location.href
    const normalizedUrl = `${new URL(fullUrl).pathname}${new URL(fullUrl).search}${new URL(fullUrl).hash}`

    console.log(
        "[syncFromUrl] called, normalizedUrl:",
        normalizedUrl,
        "lastWrittenUrl:",
        lastWrittenUrl,
    )
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
        console.log(
            "[syncFromUrl] isPlaygroundRoute:",
            isPlaygroundRoute,
            "currentAppId:",
            currentAppId,
            "urlRevisions:",
            urlRevisions,
        )

        const snapshotEncoded = extractSnapshotFromHash(url)

        // Use package controller for hydration
        if (snapshotEncoded && snapshotEncoded !== lastWrittenSnapshotHash && isPlaygroundRoute) {
            lastWrittenSnapshotHash = snapshotEncoded

            const hydrateResult = store.set(
                urlSnapshotController.actions.hydrateFromUrl,
                snapshotEncoded,
            )

            if (hydrateResult.ok && hydrateResult.selection) {
                applyPlaygroundSelection(
                    store,
                    hydrateResult.selection,
                    hydrateResult.entities as HydratedEntityDescriptor[] | undefined,
                )
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

        const currentSelected = sanitizeRevisionList(
            store.get(playgroundController.selectors.entityIds()),
        )

        if (isPlaygroundRoute) {
            if (lastPlaygroundAppId && currentAppId && lastPlaygroundAppId !== currentAppId) {
                if (currentSelected.length > 0) {
                    store.set(playgroundController.actions.setEntityIds, [])
                }
            }
            lastPlaygroundAppId = currentAppId
            ensurePlaygroundDefaults(store)
        } else {
            lastPlaygroundAppId = null
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
    const selectedVariants = get(playgroundController.selectors.entityIds())

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

            const queryAtom = runnableBridge.query(sourceId)
            const unsub = store.sub(queryAtom, () => {
                const query = store.get(queryAtom)
                if (!query.isPending && query.data) {
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
        if (process.env.NODE_ENV !== "production" && pending.size > 0) {
            const entries = Array.from(pending.entries()).map(([key, h]) => ({
                key,
                sourceRevisionId: h.sourceRevisionId,
                createLocalDraft: h.createLocalDraft,
                hasPatch: !!h.patch,
            }))
            console.debug("[hydration-sync] pending hydrations at mount", entries)
        }
        // Collect unique source IDs that are ready, then apply via the ordered helper
        const readySourceIds = new Set<string>()
        for (const [key, hydration] of pending.entries()) {
            const query = store.get(runnableBridge.query(hydration.sourceRevisionId))
            if (process.env.NODE_ENV !== "production") {
                console.debug("[hydration-sync] query state for", key, {
                    sourceRevisionId: hydration.sourceRevisionId,
                    isPending: query.isPending,
                    hasData: !!query.data,
                    isError: query.isError,
                })
            }
            if (!query.isPending && query.data) {
                readySourceIds.add(hydration.sourceRevisionId)
            }
        }
        for (const sourceId of readySourceIds) {
            applyPendingHydrationsForRevision(sourceId)
        }
    }

    // -----------------------------------------------------------------------
    // SUB 2: Apply default selection when revisions become ready
    // -----------------------------------------------------------------------
    // Subscribes to playgroundController.selectors.revisionsReady() which checks per-entity query
    // state via runnableBridge. No app-scoped atom needed.
    let hasAppliedDefaults = false
    const tryApplyDefaults = () => {
        const isReady = store.get(playgroundController.selectors.revisionsReady())
        const selected = store.get(playgroundController.selectors.entityIds())
        console.log(
            "[tryApplyDefaults] hasAppliedDefaults:",
            hasAppliedDefaults,
            "isReady:",
            isReady,
            "selected:",
            selected,
        )
        if (hasAppliedDefaults) return
        if (!isReady) return

        // Bump the revision cache version so that revisionListItemFromCacheAtomFamily
        // re-evaluates now that revision list queries have completed and populated the
        // React Query cache. This unlocks the fast enriched query path for entity data.
        legacyAppRevisionMolecule.set.invalidateCache()

        if (selected.length > 0) {
            hasAppliedDefaults = true
            store.set(playgroundInitializedAtom, true)
            console.log("[tryApplyDefaults] already has selection, marking applied")
            return
        }
        console.log("[tryApplyDefaults] no selection, calling ensurePlaygroundDefaults")
        const applied = ensurePlaygroundDefaults(store)
        if (applied) {
            hasAppliedDefaults = true
            store.set(playgroundInitializedAtom, true)
            console.log("[tryApplyDefaults] defaults applied successfully")
        } else {
            console.log("[tryApplyDefaults] defaults not yet available, will retry")
        }
    }
    // Re-bind when the app changes so defaults apply to the new app
    let currentRevReadyUnsub: (() => void) | null = null
    let currentLatestRevUnsub: (() => void) | null = null
    const bindRevisionsReady = () => {
        const rawAppId = store.get(selectedAppIdAtom)
        const currentAppId = typeof rawAppId === "string" ? rawAppId : null
        console.log("[bindRevisionsReady] resetting, appId:", currentAppId)
        hasAppliedDefaults = false
        store.set(playgroundInitializedAtom, false)
        currentRevReadyUnsub?.()
        currentLatestRevUnsub?.()

        // Check if URL already provided a selection
        const existingSelection = sanitizeRevisionList(
            store.get(playgroundController.selectors.entityIds()),
        )
        if (existingSelection.length > 0) {
            console.log("[bindRevisionsReady] URL already provided selection:", existingSelection)
            hasAppliedDefaults = true
            // Subscribe to revisionsReady (per-entity query state)
            // so we can mark initialized once the selected entities load.
            currentRevReadyUnsub = store.sub(
                playgroundController.selectors.revisionsReady(),
                () => {
                    const isReady = store.get(playgroundController.selectors.revisionsReady())
                    if (isReady) {
                        store.set(playgroundInitializedAtom, true)
                    }
                },
            )
            // Immediate check
            if (store.get(playgroundController.selectors.revisionsReady())) {
                store.set(playgroundInitializedAtom, true)
            }
        } else {
            currentRevReadyUnsub = store.sub(
                playgroundController.selectors.revisionsReady(),
                () => {
                    console.log("[SUB2] revisionsReady changed")
                    tryApplyDefaults()
                },
            )
            // Subscribe to latestServerRevisionIdAtomFamily so we retry
            // when entity data finishes loading (now uses lightweight 1-call query).
            // Only needed when no URL selection exists and we must find a default.
            if (currentAppId) {
                currentLatestRevUnsub = store.sub(
                    latestServerRevisionIdAtomFamily(currentAppId),
                    () => {
                        console.log(
                            "[SUB2] latestServerRevisionId changed:",
                            store.get(latestServerRevisionIdAtomFamily(currentAppId)),
                        )
                        tryApplyDefaults()
                    },
                )
            }
            // Immediate check in case already ready
            tryApplyDefaults()
        }

        // Always subscribe to latestServerRevisionIdAtomFamily (cheap: 1 API call)
        // so the "Latest" badge can resolve even when URL already has a selection.
        if (currentAppId && !currentLatestRevUnsub) {
            currentLatestRevUnsub = store.sub(
                latestServerRevisionIdAtomFamily(currentAppId),
                () => {},
            )
        }
    }
    bindRevisionsReady()
    const unsubAppChange = store.sub(selectedAppIdAtom, () => {
        console.log("[SUB2] selectedAppIdAtom changed:", store.get(selectedAppIdAtom))
        bindRevisionsReady()
    })
    unsubs.push(unsubAppChange)
    unsubs.push(() => currentRevReadyUnsub?.())
    unsubs.push(() => currentLatestRevUnsub?.())

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
    // SUB 4: Clean stale IDs from selection via displayedEntityIdsAtom
    // -----------------------------------------------------------------------
    // displayedEntityIdsAtom validates each entity individually via
    // runnableBridge.query() — no app-scoped revision list needed.
    // When it filters out stale IDs, sync entityIdsAtom to match.
    const unsubValidation = store.sub(displayedEntityIdsAtom, () => {
        const displayed = store.get(displayedEntityIdsAtom)
        const selected = store.get(playgroundController.selectors.entityIds())
        if (selected.length === 0) return

        // Don't filter until all revision queries have completed.
        const isReady = store.get(playgroundController.selectors.revisionsReady())
        if (!isReady) return

        if (process.env.NODE_ENV !== "production" && !arraysEqual(displayed, selected)) {
            const removed = selected.filter((id) => !displayed.includes(id))
            console.log("[SUB4] Cleaning stale IDs", {
                selected,
                displayed,
                removed,
            })
        }

        if (displayed.length === 0) {
            ensurePlaygroundDefaults(store)
        } else if (!arraysEqual(displayed, selected)) {
            store.set(playgroundController.actions.setEntityIds, displayed)
            writePlaygroundSelectionToQuery(displayed)
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
