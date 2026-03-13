// Import workflow to ensure the snapshot adapter is registered
import "@agenta/entities/workflow"

import {
    cleanupStalePersistedDrafts,
    initializeLocalDrafts,
} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {getRunnableTypeHint, registerRunnableTypeHint} from "@agenta/entities/shared"
import {workflowRevisionsByWorkflowListDataAtomFamily} from "@agenta/entities/workflow"
import {
    applyPendingHydrationsForRevision,
    displayedEntityIdsAtom,
    getRunnableTypeResolver,
    isPlaceholderId,
    pendingHydrations,
    pendingHydrationsAtom,
    playgroundController,
    playgroundInitializedAtom,
    setRunnableTypeResolver,
    setSelectionUpdateCallback,
    urlSnapshotController,
} from "@agenta/playground"
import type {PlaygroundSnapshot} from "@agenta/playground/snapshot"
import {playgroundSnapshotController} from "@agenta/playground/state"
import {atom, getDefaultStore} from "jotai"
import type {Store} from "jotai/vanilla/store"

import {routerAppIdAtom, selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {appStateSnapshotAtom} from "@/oss/state/appState"

// ============================================================================
// ENTITY MODE
// ============================================================================

/**
 * Determines which entity system the current playground uses.
 * Currently always "workflow" (modern /preview/workflows/ API).
 */
export const playgroundEntityModeAtom = atom<"workflow">("workflow")

// ============================================================================
// OSS RUNNABLE TYPE RESOLVER
// ============================================================================

/**
 * Register the OSS runnable type resolver.
 * Reads from playgroundEntityModeAtom to determine the entity type.
 */
setRunnableTypeResolver({
    getType: (entityId: string) => {
        // Check type hints first — ephemeral entities (e.g. baseRunnable) register hints
        // during URL hydration before setEntityIds is called.
        const hint = getRunnableTypeHint(entityId)
        if (hint) return hint as RunnableType
        const store = getDefaultStore()
        return store.get(playgroundEntityModeAtom)
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

/**
 * Track the last URL we wrote to prevent re-processing our own changes.
 * Stored in a Jotai atom so the value survives HMR (module re-execution
 * resets plain `let` variables, but atom state lives in the default store).
 */
const _lastWrittenUrlAtom = atom<string | null>(null)

/** Track whether URL encoding has failed to suppress repeated warnings */
let lastEncodingFailed = false

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
 * Stored in a Jotai atom so the value survives HMR.
 */
const _lastWrittenSnapshotHashAtom = atom<string | null>(null)

// Flag to skip URL revision processing after ephemeral entity hydration
// until the URL is updated with the new entity IDs
let skipUrlRevisionsUntilUpdate = false

// Convenience helpers for the HMR-safe atoms
const _store = () => getDefaultStore()
const getLastWrittenUrl = () => _store().get(_lastWrittenUrlAtom)
const setLastWrittenUrl = (v: string | null) => _store().set(_lastWrittenUrlAtom, v)
const getLastWrittenSnapshotHash = () => _store().get(_lastWrittenSnapshotHashAtom)
const setLastWrittenSnapshotHash = (v: string | null) =>
    _store().set(_lastWrittenSnapshotHashAtom, v)

/**
 * Track the current selection in memory to survive HMR.
 * Replaces the old OSS selectedVariantsAtom bridge.
 */
const _selectedVariantsAtom = atom<string[]>([])

/**
 * Track the last processed URL revisions to prevent loops.
 */
const _urlRevisionsAtom = atom<string[]>([])

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
    | "evaluator"
    | "legacyEvaluator"
    | "evaluatorRevision"
    | "legacyAppRevision"
    | "workflow"
    | "baseRunnable"

type PlaygroundEntityType =
    | "evaluator"
    | "legacyEvaluator"
    | "evaluatorRevision"
    | "legacyAppRevision"
    | "workflow"
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
        case "evaluator":
            return "evaluator"
        case "legacyEvaluator":
            return "legacyEvaluator"
        case "evaluatorRevision":
            return "evaluatorRevision"
        case "workflow":
            return "workflow"
        case "baseRunnable":
            return "baseRunnable"
        default:
            return null
    }
}

const runnableTypeToEntityType = (runnableType: RunnableType): PlaygroundEntityType | null => {
    switch (runnableType) {
        case "evaluator":
            return "evaluator"
        case "legacyEvaluator":
            return "legacyEvaluator"
        case "evaluatorRevision":
            return "evaluatorRevision"
        case "workflow":
            return "workflow"
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
        const runnableType =
            entityTypeToRunnableType(node?.entityType) ?? resolver.getType(rootEntityId)
        snapshotInputs.push({
            id: rootEntityId,
            runnableType,
            ...(node?.entityType ? {entityType: node.entityType as PlaygroundEntityType} : {}),
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
            entityType: node.entityType as PlaygroundEntityType,
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
 * Synchronously build URL components and write to browser history.
 * This is the core URL-writing logic extracted so it can be called
 * both synchronously (for initial sync) and via RAF (for coalescing).
 */
const writeUrlNow = (selection: string[]): boolean => {
    if (!isBrowser) return false

    try {
        const sanitized = sanitizeRevisionList(selection)
        const store = getDefaultStore()

        // Build the new URL with query params and hash
        const url = new URL(window.location.href)

        // Use package controller to build URL components
        const urlComponents = store.set(urlSnapshotController.actions.buildUrlComponents, sanitized)

        if (!urlComponents.ok) {
            return false
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
            setLastWrittenSnapshotHash(urlComponents.hashParam)
        } else {
            url.hash = ""
            setLastWrittenSnapshotHash(null)
        }

        const newUrl = `${url.pathname}${url.search}${url.hash}`

        // Only update if URL actually changed and we didn't just write this URL
        if (newUrl !== getLastWrittenUrl()) {
            setLastWrittenUrl(newUrl)
            window.history.replaceState(window.history.state, "", newUrl)
        }

        return true
    } catch {
        return false
    }
}

/**
 * Write the current playground selection to the URL.
 * Uses RAF to coalesce rapid updates (e.g., draft edits).
 * Uses urlSnapshotController.buildUrlComponents for entity-agnostic snapshot building.
 */
export const writePlaygroundSelectionToQuery = (selection: string[]) => {
    if (!isBrowser) return

    // Cancel any pending RAF to coalesce rapid updates
    if (urlUpdateRafId !== null) {
        cancelAnimationFrame(urlUpdateRafId)
        urlUpdateRafId = null
    }

    // RAF coalesces multiple calls within the same frame into one URL write.
    urlUpdateRafId = requestAnimationFrame(() => {
        urlUpdateRafId = null
        try {
            const sanitized = sanitizeRevisionList(selection)
            const store = getDefaultStore()
            const nodes = store.get(playgroundController.selectors.nodes())
            const snapshotSelection = buildSnapshotSelectionInputs(sanitized, nodes)

            const urlComponents = store.set(
                urlSnapshotController.actions.buildUrlComponents,
                snapshotSelection,
            )

            // Build the full URL (query params + hash)
            const url = new URL(window.location.href)

            const queryParam = urlComponents.queryParam ?? sanitized.join(",")
            if (queryParam) {
                url.searchParams.set(REVISIONS_QUERY_PARAM, queryParam)
            } else {
                url.searchParams.delete(REVISIONS_QUERY_PARAM)
            }

            if (urlComponents.ok && urlComponents.hashParam) {
                url.hash = `${SNAPSHOT_HASH_PARAM}=${urlComponents.hashParam}`
                setLastWrittenSnapshotHash(urlComponents.hashParam)
            } else {
                url.hash = ""
                setLastWrittenSnapshotHash(null)
            }

            if (!urlComponents.ok && !lastEncodingFailed) {
                console.warn(
                    "[Playground] Draft state too large for URL — persisted to localStorage only.",
                    urlComponents.error,
                )
                lastEncodingFailed = true
            } else if (urlComponents.ok) {
                lastEncodingFailed = false
            }

            const newUrl = `${url.pathname}${url.search}${url.hash}`
            if (newUrl !== getLastWrittenUrl()) {
                setLastWrittenUrl(newUrl)
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

/**
 * Apply a playground selection from URL hydration or defaults.
 * Returns `true` if the selection was actually changed, `false` if it was a no-op
 * (e.g. the selection already matched). Callers should skip side-effects like
 * loadable/localTestset restore when this returns `false`.
 */
const applyPlaygroundSelection = (
    store: Store,
    next: string[],
    hydratedEntities?: HydratedEntityDescriptor[],
    options?: {skipInitialRow?: boolean},
): boolean => {
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
            .filter((entity) => entity.runnableType === "workflow")
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
        return false
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
            "workflow"

        // No nodes yet — use addPrimaryNode for the first entity so the
        // loadable is linked to the runnable and an initial testcase row
        // is created with proper input variables.
        // When skipInitialRow is set, the default empty row is deferred
        // because a loadable/localTestset restore will populate rows afterwards.
        store.set(
            playgroundController.actions.addPrimaryNode,
            {
                type: primaryEntityType,
                id: rootEntityIds[0],
                label: primaryHydratedEntity?.label ?? rootEntityIds[0],
            },
            options?.skipInitialRow ? {skipInitialRow: true} : undefined,
        )

        // If there are additional entities (comparison mode from URL),
        // add them via setEntityIds which preserves the first node.
        if (rootEntityIds.length > 1) {
            store.set(playgroundController.actions.setEntityIds, rootEntityIds)
        }
    } else {
        // Pre-register type hints from hydrated entities so the resolver
        // returns the correct entity type (e.g. "baseRunnable") when
        // setEntityIds creates new nodes for regenerated ephemeral IDs.
        for (const entity of rootHydratedEntities) {
            const entityType =
                (entity.entityType as PlaygroundEntityType | undefined) ??
                runnableTypeToEntityType(entity.runnableType)
            if (entityType) {
                registerRunnableTypeHint(entity.id, entityType)
            }
        }
        store.set(playgroundController.actions.setEntityIds, rootEntityIds)
    }

    if (!hasHydratedDownstream) return true

    const downstreamHydratedEntities = normalizedHydratedEntities
        .filter((entity) => (entity.depth ?? 0) > 0)
        .sort((a, b) => (a.depth ?? 1) - (b.depth ?? 1))

    if (downstreamHydratedEntities.length === 0) return true

    const nodesAfterRoots = store.get(playgroundController.selectors.nodes())
    const rootNode = nodesAfterRoots.find((node) => node.depth === 0)
    if (!rootNode) return true

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

    return true
}

let lastPlaygroundAppId: string | null = null
/** Whether playgroundSyncAtom has been mounted at least once in this page session. */
let playgroundSyncMountedOnce = false

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

    const rawAppId = store.get(selectedAppIdAtom)
    const appId = typeof rawAppId === "string" ? rawAppId : null

    if (!appId) {
        return true // Mark as "applied" so we don't keep retrying
    }

    const revisions = store.get(workflowRevisionsByWorkflowListDataAtomFamily(appId))
    const latest = revisions[0]
    if (latest) {
        applyPlaygroundSelection(store, [latest.id])
        return true
    }

    return false
}

/**
 * Sync playground state from URL.
 * Uses urlSnapshotController.hydrateFromUrl for entity-agnostic hydration.
 */
export const syncPlaygroundStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    const fullUrl = nextUrl ? new URL(nextUrl, window.location.origin).href : window.location.href
    const normalizedUrl = `${new URL(fullUrl).pathname}${new URL(fullUrl).search}${new URL(fullUrl).hash}`
    if (normalizedUrl === getLastWrittenUrl()) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const isPlaygroundRoute =
            url.pathname.includes("/playground") && !url.pathname.includes("/playground-test")

        const revisionsParam = url.searchParams.get(REVISIONS_QUERY_PARAM)
        const urlRevisions = revisionsParam ? sanitizeRevisionList(revisionsParam.split(",")) : []

        const snapshotEncoded = extractSnapshotFromHash(url)

        // Use package controller for hydration
        if (
            snapshotEncoded &&
            snapshotEncoded !== getLastWrittenSnapshotHash() &&
            isPlaygroundRoute
        ) {
            setLastWrittenSnapshotHash(snapshotEncoded)

            const hydrateResult = store.set(
                urlSnapshotController.actions.hydrateFromUrl,
                snapshotEncoded,
            )

            if (hydrateResult.ok && hydrateResult.selection) {
                // Determine if a loadable restore will follow — skip initial row to avoid flash
                const hasLoadableRestore = Boolean(
                    hydrateResult.loadable || hydrateResult.localTestset,
                )

                const selectionChanged = applyPlaygroundSelection(
                    store,
                    hydrateResult.selection,
                    hydrateResult.entities as HydratedEntityDescriptor[] | undefined,
                    hasLoadableRestore ? {skipInitialRow: true} : undefined,
                )

                // If selection didn't actually change (e.g. HMR re-processed the same
                // snapshot), skip the loadable/localTestset restore to avoid duplicating
                // testcase rows.
                if (!selectionChanged) {
                    return
                }

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
                    void store
                        .set(
                            playgroundController.actions.restoreLoadableConnection,
                            hydrateResult.loadable,
                        )
                        .catch((err) => {
                            console.warn(
                                "[Playground URL] Failed to restore testset connection, falling back to empty row:",
                                err,
                            )
                            // Fall back to creating an empty row so the user isn't stuck
                            const loadableId = store.get(
                                playgroundController.selectors.loadableId(),
                            )
                            if (loadableId) {
                                store.set(playgroundController.actions.addRowWithInit, {loadableId})
                            }
                        })
                } else if (hydrateResult.localTestset) {
                    // Restore local testcase data (synchronous)
                    store.set(
                        playgroundController.actions.restoreLocalTestset,
                        hydrateResult.localTestset,
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

        if (isPlaygroundRoute) {
            ensurePlaygroundDefaults(store)
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
        const isDirty = get(runnableBridge.isDirty(revisionId))
        const draft = get(runnableBridge.draft(revisionId))
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
            const dataAtom = runnableBridge.data(sourceId)

            const tryApplyHydrations = () => {
                const query = store.get(queryAtom)
                if (!query.isPending && query.data) {
                    // Apply all pending hydrations for this source via the
                    // ordered helper — it processes createLocalDraft entries
                    // before applyDraftPatch entries so local copies are
                    // cloned from clean server data.
                    applyPendingHydrationsForRevision(sourceId)
                }
            }

            // Subscribe to both the base query AND the merged entity data.
            // The query sub fires when server data loads; the data sub fires
            // when secondary schema resolution completes (e.g. OpenAPI fetch
            // for app workflows). This ensures local draft cloning retries
            // once schemas are available.
            const unsubQuery = store.sub(queryAtom, tryApplyHydrations)
            const unsubData = store.sub(dataAtom, tryApplyHydrations)
            sourceIdSubs.set(sourceId, () => {
                unsubQuery()
                unsubData()
            })

            // Immediately check if data is already available.
            // store.sub() only fires on FUTURE changes — if the query was
            // already resolved (e.g. cache-primed by another query via
            // initialData) before this subscription was set up, the sub
            // would never fire and the draft would never be applied.
            tryApplyHydrations()
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
        for (const hydration of pending.values()) {
            const query = store.get(runnableBridge.query(hydration.sourceRevisionId)) as {
                isPending: boolean
                data: any
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
        if (hasAppliedDefaults) return
        if (!isReady) return

        // Bump the revision cache version so that revisionListItemFromCacheAtomFamily
        // re-evaluates now that revision list queries have completed and populated the
        // React Query cache. This unlocks the fast enriched query path for entity data.
        runnableBridge.invalidateAllCaches()

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
        const currentAppId = store.get(routerAppIdAtom) as string | null
        let currentSelected = sanitizeRevisionList(
            store.get(playgroundController.selectors.entityIds()),
        )
        const appState = store.get(appStateSnapshotAtom) as {pathname?: string}
        const isPlaygroundRoute =
            appState.pathname?.includes("/playground") &&
            !appState.pathname?.includes("/playground-test")

        // Detect app changes during in-page navigation. Declared before the
        // if/else so it's accessible in the post-block early-return check.
        const appChanged =
            isPlaygroundRoute &&
            playgroundSyncMountedOnce &&
            currentAppId &&
            currentSelected.length > 0 &&
            lastPlaygroundAppId !== currentAppId

        if (isPlaygroundRoute) {
            if (appChanged) {
                store.set(playgroundController.actions.setEntityIds, [])
                currentSelected = []
            }
            lastPlaygroundAppId = currentAppId
        } else {
            // Keep lastPlaygroundAppId so that returning to the same app's
            // playground does not mistakenly clear the selection.
            // It was previously nullified here, causing the "appChanged" check
            // on re-entry to clear the valid selection.

            // Clean up existing subscriptions and skip re-binding since
            // we're not on a playground route.
            currentRevReadyUnsub?.()
            currentLatestRevUnsub?.()
            return
        }

        currentRevReadyUnsub?.()
        currentLatestRevUnsub?.()

        // When returning to the same app with a valid selection that's already
        // initialized, skip resetting playgroundInitializedAtom to avoid a
        // false→true transition that causes unnecessary re-renders (which can
        // trigger editor re-hydration and cursor jumps).
        if (!appChanged && currentSelected.length > 0 && store.get(playgroundInitializedAtom)) {
            hasAppliedDefaults = true
            return
        }

        hasAppliedDefaults = false
        store.set(playgroundInitializedAtom, false)

        // Check if URL already provided a selection
        const existingSelection = currentSelected
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
            // Subscribe to entity data so we retry when it finishes loading.
            // Only needed when no URL selection exists and we must find a default.
            if (currentAppId) {
                currentLatestRevUnsub = store.sub(
                    workflowRevisionsByWorkflowListDataAtomFamily(currentAppId),
                    () => tryApplyDefaults(),
                )
            }
            // Immediate check in case already ready
            tryApplyDefaults()
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
    // SUB 6: Update URL when testcase visibility changes
    // -----------------------------------------------------------------------
    // When the user removes/hides testcase rows, hiddenTestcaseIds changes
    // in the loadable state. Re-encode the URL so the hidden IDs are captured
    // in the #pgSnapshot hash and persist across page reloads.
    const unsubHiddenTestcases = store.sub(
        playgroundController.selectors.hiddenTestcaseCount(),
        () => {
            const currentSelected = sanitizeRevisionList(
                store.get(playgroundController.selectors.entityIds()),
            )
            if (currentSelected.length > 0) {
                writePlaygroundSelectionToQuery(currentSelected)
            }
        },
    )
    unsubs.push(unsubHiddenTestcases)

    // -----------------------------------------------------------------------
    // SUB 7: Update URL when new testcase rows are added/removed
    // -----------------------------------------------------------------------
    // When the user adds a new testcase row (locally-created, not yet committed),
    // the snapshot must be re-encoded so the new row data is captured in draftRows
    // and persists across page reloads.
    const unsubNewTestcases = store.sub(playgroundController.selectors.newTestcaseCount(), () => {
        store.get(playgroundController.selectors.newTestcaseCount())
        const currentSelected = sanitizeRevisionList(
            store.get(playgroundController.selectors.entityIds()),
        )
        if (currentSelected.length > 0) {
            writePlaygroundSelectionToQuery(currentSelected)
        }
    })
    unsubs.push(unsubNewTestcases)

    // -----------------------------------------------------------------------
    // SUB 8: Update URL when new testcase row DATA changes
    // -----------------------------------------------------------------------
    // When the user edits the content of a locally-created testcase row,
    // the snapshot must be re-encoded so the updated data is captured in
    // draftRows and persists across page reloads.
    let prevNewTestcaseDataHash = store.get(playgroundController.selectors.newTestcaseDataHash())
    const unsubNewTestcaseData = store.sub(
        playgroundController.selectors.newTestcaseDataHash(),
        () => {
            const hash = store.get(playgroundController.selectors.newTestcaseDataHash())
            if (hash !== prevNewTestcaseDataHash) {
                prevNewTestcaseDataHash = hash
                const currentSelected = sanitizeRevisionList(
                    store.get(playgroundController.selectors.entityIds()),
                )
                if (currentSelected.length > 0) {
                    writePlaygroundSelectionToQuery(currentSelected)
                }
            }
        },
    )
    unsubs.push(unsubNewTestcaseData)

    // -----------------------------------------------------------------------
    // SUB 9: Persist full playground snapshot to localStorage (debounced 1s)
    // -----------------------------------------------------------------------
    // Subscribes to the same selectedDraftHashAtom as SUB 3 (URL sync).
    // When the URL encoding fails for large entities (>8KB), this ensures
    // draft state is still persisted to localStorage as a fallback.
    // Uses playgroundSnapshotController.createSnapshot for entity-type-agnostic
    // snapshot building (works for workflow, legacyAppRevision, etc.)
    const DRAFT_SNAPSHOT_KEY = "agenta:playground-draft-snapshot"

    let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null

    const persistSnapshot = () => {
        try {
            const entityIds = store.get(playgroundController.selectors.entityIds())
            if (entityIds.length === 0) {
                localStorage.removeItem(DRAFT_SNAPSHOT_KEY)
                return
            }

            const nodes = store.get(playgroundController.selectors.nodes())
            const snapshotInputs = buildSnapshotSelectionInputs(entityIds, nodes)

            const result = store.set(
                playgroundSnapshotController.actions.createSnapshot,
                snapshotInputs,
            ) as {snapshot?: PlaygroundSnapshot}

            if (result.snapshot) {
                const hasDraftChanges =
                    result.snapshot.drafts.length > 0 ||
                    result.snapshot.selection.some((s: any) => s.kind === "ephemeral")

                if (hasDraftChanges) {
                    localStorage.setItem(
                        DRAFT_SNAPSHOT_KEY,
                        JSON.stringify({
                            snapshot: result.snapshot,
                            timestamp: Date.now(),
                        }),
                    )
                } else {
                    localStorage.removeItem(DRAFT_SNAPSHOT_KEY)
                }
            }
        } catch (err) {
            console.warn("[SUB 9] Error persisting snapshot:", err)
        }
    }

    const unsubPersist = store.sub(selectedDraftHashAtom, () => {
        if (persistDebounceTimer) clearTimeout(persistDebounceTimer)

        // Check if any entity has an active draft. When no drafts exist
        // (e.g. after discard/commit), clear localStorage IMMEDIATELY
        // so a page reload within the debounce window won't re-apply stale drafts.
        const entityIds = store.get(playgroundController.selectors.entityIds())
        const hasAnyDraft = entityIds.some((id) => {
            const isDirty = store.get(runnableBridge.isDirty(id))
            return isDirty
        })

        if (!hasAnyDraft) {
            // Don't clear localStorage while pending hydrations exist.
            // Hydrations are queued by SUB 10 (localStorage restore) or URL snapshot
            // and haven't been applied yet. Clearing localStorage now would lose the
            // draft data before it can be applied by SUB 1.
            if (pendingHydrations.size > 0) return

            persistDebounceTimer = null
            persistSnapshot()
            return
        }

        // Debounce writes when drafts are active (reduces I/O during rapid editing)
        persistDebounceTimer = setTimeout(() => {
            persistDebounceTimer = null
            persistSnapshot()
        }, 1000)
    })
    unsubs.push(unsubPersist)
    unsubs.push(() => {
        if (persistDebounceTimer) {
            // Flush the pending snapshot write before unmounting.
            // Without this, navigating away within the 1s debounce window
            // would lose draft state — the timer is cleared but the
            // snapshot is never written to localStorage.
            clearTimeout(persistDebounceTimer)
            persistDebounceTimer = null
            persistSnapshot()
        }
    })

    // -----------------------------------------------------------------------
    // SUB 10: Restore persisted snapshot from localStorage (one-time on mount)
    // -----------------------------------------------------------------------
    // Initialize local draft data from localStorage FIRST (before SUB 4 validation)
    initializeLocalDrafts()

    // Clean up stale persisted drafts older than 7 days
    cleanupStalePersistedDrafts()

    // Check if URL had a snapshot — if so, skip localStorage restoration
    // (URL snapshot takes priority as it's an explicit sharing action)
    const urlHadSnapshot = getLastWrittenSnapshotHash() !== null

    if (!urlHadSnapshot) {
        // Read the persisted full snapshot from localStorage
        let persistedSnapshot: PlaygroundSnapshot | null = null
        try {
            const raw = localStorage.getItem(DRAFT_SNAPSHOT_KEY)
            if (raw) {
                const parsed = JSON.parse(raw)
                const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
                if (parsed?.timestamp && Date.now() - parsed.timestamp > SEVEN_DAYS_MS) {
                    localStorage.removeItem(DRAFT_SNAPSHOT_KEY)
                } else if (parsed?.snapshot) {
                    persistedSnapshot = parsed.snapshot as PlaygroundSnapshot
                }
            }
        } catch (err) {
            console.warn("[SUB 10] Parse error:", err)
        }

        if (persistedSnapshot && persistedSnapshot.drafts.length > 0) {
            // Wait for entity IDs to be populated (by URL sync or defaults),
            // then hydrate the snapshot to apply draft patches.
            // The snapshot's selection matches the URL's ?revisions= param,
            // so we only need the pending hydrations mechanism (SUB 1).
            let restoreSetupDone = false
            const entityIdsAtom = playgroundController.selectors.entityIds()

            const tryHydrateSnapshot = () => {
                if (restoreSetupDone) return
                const selected = store.get(entityIdsAtom)
                if (selected.length === 0) return

                restoreSetupDone = true

                // Hydrate the snapshot — this creates pending hydrations
                // that SUB 1 will apply when server data loads.
                // NOTE: We do NOT clear localStorage here. hydrateSnapshot only
                // QUEUES pending hydrations — the actual patches are applied later
                // by SUB 1 when server data loads. If the user reloads before that,
                // we'd lose the drafts. SUB 9 manages the localStorage lifecycle:
                // once drafts are applied, it re-persists; when committed/discarded,
                // it removes from localStorage.
                store.set(playgroundSnapshotController.actions.hydrateSnapshot, persistedSnapshot!)
            }

            const unsubRestoreSetup = store.sub(entityIdsAtom, tryHydrateSnapshot)
            unsubs.push(unsubRestoreSetup)

            // Also try immediately in case selection is already populated
            tryHydrateSnapshot()
        }
    }

    // -----------------------------------------------------------------------
    // INITIAL URL SYNC: ensure URL reflects in-memory selection
    // -----------------------------------------------------------------------
    // When navigating away from the playground, urlRevisionsAtom is cleared but
    // selectedVariantsAtom persists in memory. On return, the URL has no
    // ?revisions param even though a selection exists. Write synchronously
    // (bypassing RAF) so a subsequent RAF-based call cannot cancel this write.
    {
        const initialSelection = sanitizeRevisionList(store.get(_selectedVariantsAtom))
        const initialUrlRevisions = sanitizeRevisionList(store.get(_urlRevisionsAtom))
        if (initialSelection.length > 0 && initialUrlRevisions.length === 0) {
            store.set(_urlRevisionsAtom, initialSelection)
            writeUrlNow(initialSelection)
        }
    }

    playgroundSyncMountedOnce = true

    // -----------------------------------------------------------------------
    // CLEANUP
    // -----------------------------------------------------------------------
    return () => {
        for (const unsub of unsubs) unsub()
        for (const [, unsub] of sourceIdSubs) unsub()
        sourceIdSubs.clear()
    }
}
