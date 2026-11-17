import {isLocalDraftId, isPlaceholderId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    applyPendingHydrationsForRevision,
    executionController,
    pendingHydrationsAtom,
    playgroundController,
    setSelectionUpdateCallback,
    urlSnapshotController,
    type PlaygroundNode,
} from "@agenta/playground"
import type {SnapshotSelectionInput} from "@agenta/playground/state"
import {atom, type useStore} from "jotai"

type Store = ReturnType<typeof useStore>

/**
 * What the snapshot records: the selected revisions in order and, after them, the evaluators
 * that run on the app's output with their depth. Depth and type are written only when such
 * evaluators exist: they are what a restore needs to connect them again.
 */
const snapshotSelection = (
    rootIds: readonly string[],
    nodes: readonly PlaygroundNode[],
): SnapshotSelectionInput[] => {
    const downstream = nodes.filter((node) => node.depth > 0)
    const graph = downstream.length > 0
    return [
        ...rootIds.map((id) => ({
            id,
            runnableType: "workflow" as const,
            ...(graph ? {depth: 0, entityType: "workflow"} : {}),
        })),
        ...downstream.map((node) => ({
            id: node.entityId,
            runnableType: "workflow" as const,
            entityType: node.entityType,
            depth: node.depth,
            ...(node.label ? {label: node.label} : {}),
        })),
    ]
}

/** A selected id a link can name: not a local copy and not a restore placeholder. */
export const isSavedRevisionId = (id: string) => !isLocalDraftId(id) && !isPlaceholderId(id)

/**
 * The address for the playground as it stands: `revisions` for `?revisions=` (a local copy names
 * the revision it copies) and `snapshot` for `#pgSnapshot=` when there is work to keep (drafts,
 * evaluators, test cases). A snapshot too large for an address is left out.
 */
export const playgroundAddress = (store: Store): {revisions: string; snapshot: string | null} => {
    const ids = store.get(playgroundController.selectors.entityIds())
    const components = store.set(
        urlSnapshotController.actions.buildUrlComponents,
        snapshotSelection(ids, store.get(playgroundController.selectors.nodes())),
    )
    const named = components.ok && components.queryParam ? components.queryParam.split(",") : ids
    return {
        revisions: [...new Set(named.filter(isSavedRevisionId))].join(","),
        snapshot: components.ok ? components.hashParam : null,
    }
}

/**
 * Changes whenever the snapshot would: the selection and its evaluators, the drafts, and the
 * test set and its rows. Its value is only a trigger.
 */
export const snapshotTriggerAtom = atom((get) => [
    get(playgroundController.selectors.entityIds()),
    // Every node's draft: the evaluators after the app are in the snapshot too.
    ...get(playgroundController.selectors.nodes()).map((node) =>
        get(workflowMolecule.atoms.draft(node.entityId)),
    ),
    get(playgroundController.selectors.connectedTestset()),
    get(playgroundController.selectors.hiddenTestcaseCount()),
    get(playgroundController.selectors.newTestcaseCount()),
    get(playgroundController.selectors.newTestcaseDataHash()),
])

/**
 * Whether drafts from a restored snapshot still wait for their revision on screen. Writing the
 * address then would replace the hash with one that has lost them.
 */
export const hasPendingRestore = (store: Store): boolean => {
    // Every node: the evaluators after the app have drafts in the snapshot too.
    const ids = new Set(
        store.get(playgroundController.selectors.nodes()).map((node) => node.entityId),
    )
    for (const pending of store.get(pendingHydrationsAtom).values()) {
        if (ids.has(pending.sourceRevisionId)) return true
        if (pending.placeholderId && ids.has(pending.placeholderId)) return true
    }
    return false
}

/**
 * Restores a playground from an encoded snapshot: its revisions in order, the evaluators after
 * the app, and its test set or rows. The drafts wait for their revision data (see
 * `syncSnapshotDrafts`). Returns null when the snapshot cannot be read, so the caller opens the
 * address's revisions instead; otherwise a promise that settles when the test cases are back, or
 * when `isWanted` turns false (the page was left or set up again) and they are dropped.
 */
export const restoreSnapshot = (
    store: Store,
    encoded: string,
    isWanted: () => boolean,
): Promise<void> | null => {
    const result = store.set(urlSnapshotController.actions.hydrateFromUrl, encoded)
    const entities = result.entities ?? []
    const rootIds = entities.filter((entity) => !entity.depth).map((entity) => entity.id)
    if (!result.ok || rootIds.length === 0) return null

    const restoresRows = !!(result.loadable || result.localTestset)
    store.set(
        playgroundController.actions.addPrimaryNode,
        {type: "workflow", id: rootIds[0], label: rootIds[0]},
        restoresRows ? {skipInitialRow: true} : undefined,
    )
    if (rootIds.length > 1) store.set(playgroundController.actions.setEntityIds, rootIds)

    // Each evaluator runs on the node one level up.
    const nodeAtDepth = new Map<number, string>()
    const rootNode = store.get(playgroundController.selectors.nodes())[0]
    if (rootNode) nodeAtDepth.set(0, rootNode.id)
    const downstream = entities
        .filter((entity) => (entity.depth ?? 0) > 0)
        .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))
    for (const entity of downstream) {
        const depth = entity.depth ?? 1
        const sourceNodeId = nodeAtDepth.get(depth - 1) ?? rootNode?.id
        if (!sourceNodeId) break
        const connected = store.set(playgroundController.actions.connectDownstreamNode, {
            sourceNodeId,
            entity: {type: "workflow", id: entity.id, label: entity.label ?? entity.id},
        })
        if (connected) nodeAtDepth.set(depth, connected.nodeId)
    }

    const loadableId = store.get(playgroundController.selectors.loadableId())

    const {localTestset, loadable} = result
    if (localTestset) {
        // Chat rows become a conversation only when the revision is known to be a chat app.
        return whenModeKnown(store, isWanted).then((wanted) => {
            if (wanted) store.set(playgroundController.actions.restoreLocalTestset, localTestset)
        })
    }
    if (!loadable) return Promise.resolve()
    return store
        .set(playgroundController.actions.restoreLoadableConnection, loadable, {
            isCurrent: isWanted,
        })
        .then(() => undefined)
        .catch(() => {
            // The test set is gone or unreadable: an empty row, so there is still something to run.
            if (loadableId && isWanted()) {
                store.set(playgroundController.actions.addRowWithInit, {loadableId})
            }
        })
}

/**
 * Whether the primary revision is a chat app, once its data has loaded; undefined until then.
 * The chat flag reads false while the revision still loads, so it alone cannot tell "not chat"
 * from "not known yet".
 */
const primaryChatModeAtom = atom((get) => {
    const primaryId = get(playgroundController.selectors.entityIds())[0]
    if (!primaryId || !get(workflowMolecule.selectors.query(primaryId)).data) return undefined
    return get(executionController.selectors.isChatMode)
})

/**
 * Settles once the primary revision says whether it is a chat app (true), or once the restore is
 * no longer wanted (false). Leaving clears the selection, which wakes the wait up to give up.
 */
const whenModeKnown = (store: Store, isWanted: () => boolean) =>
    new Promise<boolean>((resolve) => {
        const unsubscribes: (() => void)[] = []
        const check = () => {
            const wanted = isWanted()
            if (wanted && store.get(primaryChatModeAtom) === undefined) return
            for (const unsubscribe of unsubscribes) unsubscribe()
            resolve(wanted)
        }
        unsubscribes.push(
            store.sub(primaryChatModeAtom, check),
            store.sub(playgroundController.selectors.loadableId(), check),
        )
        check()
    })

/** The pending drafts whose revision data has loaded. Recomputed whenever that data changes. */
const readyDraftSourcesAtom = atom((get) => {
    const ready = new Set<string>()
    for (const {sourceRevisionId} of get(pendingHydrationsAtom).values()) {
        if (get(workflowMolecule.selectors.query(sourceRevisionId)).data) {
            // Read too, so a copy that waits for the merged data retries when it changes.
            get(workflowMolecule.selectors.data(sourceRevisionId))
            ready.add(sourceRevisionId)
        }
    }
    return [...ready]
})

/**
 * Applies a restored snapshot's drafts as their revisions load, and puts each restored copy in
 * the place its placeholder held. Returns the stop function.
 */
export const syncSnapshotDrafts = (store: Store): (() => void) => {
    const apply = () => {
        for (const id of store.get(readyDraftSourcesAtom)) applyPendingHydrationsForRevision(id)
    }
    setSelectionUpdateCallback((placeholderId, localDraftId) => {
        const ids = store.get(playgroundController.selectors.entityIds())
        if (!ids.includes(placeholderId)) return
        store.set(
            playgroundController.actions.setEntityIds,
            ids.map((id) => (id === placeholderId ? localDraftId : id)),
        )
    })
    // The change arrives during a query notification: applying then would write mid-read.
    const unsubscribe = store.sub(readyDraftSourcesAtom, () => queueMicrotask(apply))
    apply()
    return () => {
        unsubscribe()
        setSelectionUpdateCallback(null)
        store.set(pendingHydrationsAtom, new Map())
    }
}
