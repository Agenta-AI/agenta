// Import legacyAppRevision and baseRunnable to ensure snapshot adapters are registered
// These side-effect imports must happen before any snapshot operations
import "@agenta/entities/legacyAppRevision"
import "@agenta/entities/baseRunnable"

import {baseRunnableMolecule} from "@agenta/entities/baseRunnable"
import {
    legacyAppRevisionMolecule,
    latestServerRevisionIdAtomFamily,
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

import {routerAppIdAtom} from "@/oss/state/app/selectors/app"
import {appStateSnapshotAtom} from "@/oss/state/appState"

// ============================================================================
// OSS RUNNABLE TYPE RESOLVER
// ============================================================================

/**
 * Register the OSS runnable type resolver.
 * Detects baseRunnable from ID prefix, otherwise defaults to legacyAppRevision.
 */
setRunnableTypeResolver({
    getType: (id: string) => {
        if (id.startsWith("base-runnable-")) return "baseRunnable"
        return "legacyAppRevision"
    },
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

// Flag to skip URL revision processing after ephemeral entity hydration
// until the URL is updated with the new entity IDs
let skipUrlRevisionsUntilUpdate = false

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
    | "baseRunnable"

type PlaygroundEntityType =
    | "appRevision"
    | "legacyAppRevision"
    | "evaluator"
    | "legacyEvaluator"
    | "evaluatorRevision"
    | "baseRunnable"

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
        case "baseRunnable":
            return "baseRunnable"
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
        case "baseRunnable":
            return "baseRunnable"
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
        // Detect baseRunnable from ID prefix if node doesn't have entityType yet
        const isBaseRunnable = rootEntityId.startsWith("base-runnable-")
        const runnableType = isBaseRunnable
            ? "baseRunnable"
            : (entityTypeToRunnableType(node?.entityType) ?? resolver.getType(rootEntityId))
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
 * Build the playground URL for a given selection synchronously.
 * Returns the full URL path with query params and hash.
 * Used for navigation to playground with proper snapshot state.
 */
export const buildPlaygroundUrl = (selection: string[], basePath: string): string => {
    const store = getDefaultStore()
    const sanitized = sanitizeRevisionList(selection)
    const nodes = store.get(playgroundController.selectors.nodes())
    const snapshotSelection = buildSnapshotSelectionInputs(sanitized, nodes)

    const url = new URL(basePath, window.location.origin)

    const urlComponents = store.set(
        urlSnapshotController.actions.buildUrlComponents,
        snapshotSelection,
    )

    if (urlComponents.ok) {
        if (urlComponents.queryParam) {
            url.searchParams.set(REVISIONS_QUERY_PARAM, urlComponents.queryParam)
        }
        if (urlComponents.hashParam) {
            url.hash = `${SNAPSHOT_HASH_PARAM}=${urlComponents.hashParam}`
        }
    }

    return `${url.pathname}${url.search}${url.hash}`
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
        return false
    }

    // Check if there's already a valid selection
    const selected = sanitizeRevisionList(store.get(playgroundController.selectors.entityIds()))

    // If there are valid selected revisions, don't override
    if (selected.length > 0) return true

    // Use URL-based app ID only — on project-level playground (no app in URL),
    // we don't apply defaults since there's no single app to derive a default from.
    const appId = store.get(routerAppIdAtom)
    if (!appId) {
        return true // Mark as "applied" so we don't keep retrying
    }

    const latestRevisionId = store.get(latestServerRevisionIdAtomFamily(appId))
    if (!latestRevisionId) return false

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
                applyPlaygroundSelection(
                    store,
                    hydrateResult.selection,
                    hydrateResult.entities as HydratedEntityDescriptor[] | undefined,
                )

                // For ephemeral entities, the restored entity ID differs from the URL's query param.
                // Update the URL to reflect the new entity IDs so subsequent syncs don't re-apply stale IDs.
                const hasEphemeralEntities = hydrateResult.entities?.some(
                    (e) => e.runnableType === "baseRunnable",
                )
                if (hasEphemeralEntities) {
                    // Set flag to skip URL revision processing until URL is updated
                    skipUrlRevisionsUntilUpdate = true
                    // Update URL with new selection (deferred to avoid sync loop)
                    requestAnimationFrame(() => {
                        writePlaygroundSelectionToQuery(hydrateResult.selection)
                        skipUrlRevisionsUntilUpdate = false
                    })
                }

                // Restore testset connection after nodes are set up (nodes are now populated)
                if (hydrateResult.loadable) {
                    void store.set(
                        playgroundController.actions.restoreLoadableConnection,
                        hydrateResult.loadable,
                    )
                }
                return
            }
        }

        // Skip URL revision processing if we just hydrated ephemeral entities
        // and haven't updated the URL yet
        if (skipUrlRevisionsUntilUpdate && isPlaygroundRoute) {
            return
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
            // Clear stale selection when the app changes.
            // This covers both direct app→app navigation (lastPlaygroundAppId !== currentAppId)
            // and app→home→app navigation (lastPlaygroundAppId is null because non-playground
            // routes reset it). In the latter case, any existing selection from the previous
            // app would remain and cause ensurePlaygroundDefaults to skip, so we must also
            // clear when re-entering a playground route from a non-playground route.
            const appChanged =
                currentAppId &&
                currentSelected.length > 0 &&
                (lastPlaygroundAppId !== currentAppId || lastPlaygroundAppId === null)
            if (appChanged) {
                store.set(playgroundController.actions.setEntityIds, [])
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
    const nodes = get(playgroundController.selectors.nodes())

    const parts = selectedVariants.map((revisionId) => {
        const node = nodes.find((n) => n.entityId === revisionId)
        const entityType = node?.entityType

        // Handle baseRunnable entities - track their data for URL sync
        if (entityType === "baseRunnable") {
            const data = get(baseRunnableMolecule.selectors.data(revisionId))
            const isDirty = get(baseRunnableMolecule.selectors.isDirty(revisionId))
            // Include parameters hash to detect changes
            const dataHash = data?.parameters ? JSON.stringify(data.parameters) : ""
            return `${revisionId}:${isDirty}:${dataHash}`
        }

        // Skip other non-legacyAppRevision entities (e.g. evaluator)
        if (entityType && entityType !== "legacyAppRevision") {
            return `${revisionId}:false:`
        }

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
        // Collect unique source IDs that are ready, then apply via the ordered helper
        const readySourceIds = new Set<string>()
        for (const [, hydration] of pending.entries()) {
            const query = store.get(runnableBridge.query(hydration.sourceRevisionId))
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
        if (hasAppliedDefaults) return
        if (!isReady) return

        // Bump the revision cache version so that revisionListItemFromCacheAtomFamily
        // re-evaluates now that revision list queries have completed and populated the
        // React Query cache. This unlocks the fast enriched query path for entity data.
        legacyAppRevisionMolecule.set.invalidateCache()

        if (selected.length > 0) {
            hasAppliedDefaults = true
            store.set(playgroundInitializedAtom, true)
            return
        }
        const applied = ensurePlaygroundDefaults(store)
        if (applied) {
            hasAppliedDefaults = true
            store.set(playgroundInitializedAtom, true)
        }
    }
    // Re-bind when the app changes so defaults apply to the new app
    let currentRevReadyUnsub: (() => void) | null = null
    let currentLatestRevUnsub: (() => void) | null = null
    const bindRevisionsReady = () => {
        // Use URL-based app ID only — project-level playground has no app context
        const currentAppId = store.get(routerAppIdAtom)
        hasAppliedDefaults = false
        store.set(playgroundInitializedAtom, false)
        currentRevReadyUnsub?.()
        currentLatestRevUnsub?.()

        // Check if URL already provided a selection
        const existingSelection = sanitizeRevisionList(
            store.get(playgroundController.selectors.entityIds()),
        )
        if (existingSelection.length > 0) {
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
            currentRevReadyUnsub = store.sub(playgroundController.selectors.revisionsReady(), () =>
                tryApplyDefaults(),
            )
            // Subscribe to latestServerRevisionIdAtomFamily so we retry
            // when entity data finishes loading (now uses lightweight 1-call query).
            // Only needed when no URL selection exists and we must find a default.
            if (currentAppId) {
                currentLatestRevUnsub = store.sub(
                    latestServerRevisionIdAtomFamily(currentAppId),
                    () => tryApplyDefaults(),
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
    const unsubAppChange = store.sub(routerAppIdAtom, () => {
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

        if (displayed.length === 0) {
            ensurePlaygroundDefaults(store)
        } else if (!arraysEqual(displayed, selected)) {
            store.set(playgroundController.actions.setEntityIds, displayed)
            writePlaygroundSelectionToQuery(displayed)
        }
    })
    unsubs.push(unsubValidation)

    // -----------------------------------------------------------------------
    // SUB 5: Update URL when testset connection changes
    // -----------------------------------------------------------------------
    // When the user connects/disconnects from an API-backed testset, the
    // loadable state changes. We re-encode the URL so the testset connection
    // is captured in (or removed from) the #pgSnapshot hash.
    const unsubConnectedTestset = store.sub(
        playgroundController.selectors.connectedTestset(),
        () => {
            const currentSelected = sanitizeRevisionList(
                store.get(playgroundController.selectors.entityIds()),
            )
            if (currentSelected.length > 0) {
                writePlaygroundSelectionToQuery(currentSelected)
            }
        },
    )
    unsubs.push(unsubConnectedTestset)

    // -----------------------------------------------------------------------
    // CLEANUP
    // -----------------------------------------------------------------------
    return () => {
        for (const unsub of unsubs) unsub()
        for (const [, unsub] of sourceIdSubs) unsub()
        sourceIdSubs.clear()
    }
}
