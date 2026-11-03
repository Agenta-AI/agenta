import {useCallback, useEffect, useRef} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {clearChangesAtom} from "@agenta/entities/testset"
import {
    discardLocalServerDataAtom,
    workflowDetailQueryAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {
    executionItemController,
    playgroundController,
    playgroundInitializedAtom,
} from "@agenta/playground"
import {atom, useAtomValue, useStore} from "jotai"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"
import {useRouter} from "next/router"

import {playgroundLatestRevisionIdAtomFamily} from "./playgroundLatestRevision"
import {parseRevisionIds} from "./playgroundUrl"

/** How far the app and its selected revisions have loaded. */
export type PlaygroundLoadStatus = "loading" | "ready" | "error" | "not-found"

/** What the app is, from its first selected revision. Null until that revision loads. */
export type PlaygroundAppKind = "prompt" | "agent" | "evaluator"

export interface PlaygroundSelection {
    status: PlaygroundLoadStatus
    appKind: PlaygroundAppKind | null
    /** The app's name, once it has loaded. */
    appName: string | null
    /** The selected revisions, in order. Index 0 anchors the test cases. */
    revisionIds: string[]
    primaryRevisionId: string | null
    /** Fetches this app's failed requests again. */
    retry: () => void
}

/**
 * The selected ids that can stay: ids still loading, ids whose load failed (the screen shows the
 * error), and revisions and local drafts of this app. An id with no data behind it, or one that
 * belongs to another app, goes.
 */
const keptRevisionIdsAtomFamily = atomFamily((appId: string) =>
    atom((get) =>
        get(playgroundController.selectors.entityIds()).filter((id) => {
            const query = get(workflowMolecule.selectors.query(id))
            if (query.isPending || query.isError) return true
            const workflowId = query.data?.workflow_id
            return !!query.data && (!workflowId || workflowId === appId)
        }),
    ),
)

/**
 * The prompt playground's selection for one app, and its lifecycle.
 *
 * On mount it selects the revisions in `?revisions=` (in order), or the app's latest revision.
 * It writes the selection back to `?revisions=`, drops ids that are not revisions of this app,
 * and on unmount it clears the playground nodes, runs and test set connection: the agent session screen uses the same
 * store, so nothing from here may outlive the route.
 */
export const usePlaygroundSelection = ({appId}: {appId: string}): PlaygroundSelection => {
    const router = useRouter()
    const routerRef = useRef(router)
    routerRef.current = router
    const store = useStore()

    const detail = useAtomValue(workflowDetailQueryAtomFamily(appId))
    const latestQuery = useAtomValue(playgroundLatestRevisionIdAtomFamily(appId))
    // A failed reload keeps the previous answer, which can be a revision just deleted: not used.
    const latestId = latestQuery.isError ? null : (latestQuery.data ?? null)
    // The controller calls the selected revisions "entity ids"; this screen calls them revisions.
    const revisionIds = useAtomValue(playgroundController.selectors.entityIds())
    const keptIds = useAtomValue(keptRevisionIdsAtomFamily(appId))
    const primaryId = revisionIds[0] ?? null
    const primaryQuery = useAtomValue(workflowMolecule.selectors.query(primaryId ?? ""))
    const isEvaluator = useAtomValue(workflowMolecule.selectors.isEvaluator(primaryId ?? ""))
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(primaryId ?? ""))

    const appUsable = !!detail.data && !detail.data.deleted_at
    // The app this hook has set up the playground for. Effects read the store, not render values:
    // after an app change they run before the next render.
    const setUpForAppRef = useRef<string | null>(null)

    const select = useCallback(
        (ids: string[]) => {
            if (ids.length === 0) return
            store.set(playgroundController.actions.addPrimaryNode, {
                type: "workflow",
                id: ids[0],
                label: ids[0],
            })
            if (ids.length > 1) store.set(playgroundController.actions.setEntityIds, ids)
        },
        [store],
    )

    useEffect(() => {
        if (!router.isReady || !appUsable) return
        setUpForAppRef.current = appId
        select(parseRevisionIds(routerRef.current.query.revisions))
        store.set(playgroundInitializedAtom, true)
        return () => {
            setUpForAppRef.current = null
            const selected = store.get(playgroundController.selectors.entityIds())
            const loadableId = store.get(playgroundController.selectors.loadableId())
            // Runs first: they are found through the selection that `resetAll` removes.
            store.set(executionItemController.actions.clearAll)
            // The test case store is shared with the test set editor: the connection and the
            // unsaved test case edits go with the page.
            if (loadableId) {
                store.set(clearChangesAtom)
                store.set(loadableController.actions.disconnect, loadableId)
            }
            store.set(playgroundController.actions.resetAll)
            store.set(playgroundInitializedAtom, false)
            // Leaving asked to discard unsaved changes: the drafts go with the page.
            for (const id of selected) {
                if (isLocalDraftId(id)) store.set(discardLocalServerDataAtom, id)
                else store.set(workflowMolecule.actions.discard, id)
            }
        }
    }, [appId, appUsable, router.isReady, select, store])

    // Drop ids that are not revisions of this app; with nothing left, take the latest revision.
    useEffect(() => {
        if (setUpForAppRef.current !== appId) return
        const current = store.get(playgroundController.selectors.entityIds())
        const kept = store.get(keptRevisionIdsAtomFamily(appId))
        if (kept.length !== current.length) {
            store.set(playgroundController.actions.setEntityIds, kept)
        }
        if (kept.length === 0 && latestId) select([latestId])
        // `keptIds` only triggers the effect: in the commit that sets the playground up it is
        // still the value from before, so the store is read instead. `appUsable` and
        // `router.isReady` run it again in the commit that sets the playground up: the latest
        // revision can answer before the app, and nothing else would run it then.
    }, [appId, appUsable, keptIds, latestId, router.isReady, select, store])

    // Write the selection to `?revisions=`. Local drafts stay out until share links exist.
    useEffect(() => {
        if (setUpForAppRef.current !== appId) return
        const saved = store
            .get(playgroundController.selectors.entityIds())
            .filter((id) => !isLocalDraftId(id))
        const {pathname, query} = routerRef.current
        if (saved.length === 0 || saved.join(",") === query.revisions) return
        void routerRef.current
            .replace({pathname, query: {...query, revisions: saved.join(",")}}, undefined, {
                shallow: true,
            })
            .catch(() => undefined)
    }, [appId, revisionIds, store])

    // Only this screen's requests: the app, its latest revision, and the selected revisions.
    const retry = useCallback(() => {
        const queryClient = store.get(queryClientAtom)
        const selected = new Set(store.get(playgroundController.selectors.entityIds()))
        void queryClient.refetchQueries({
            predicate: ({queryKey: [scope, kind, a, b]}) =>
                scope === "workflows" &&
                ((kind === "detail" && b === appId) ||
                    (kind === "playgroundLatest" && a === appId) ||
                    (kind === "revision" && selected.has(String(a)))),
        })
    }, [appId, store])

    const status = ((): PlaygroundLoadStatus => {
        if (detail.isError || latestQuery.isError || (primaryId && primaryQuery.isError)) {
            return "error"
        }
        if (detail.isPending) return "loading"
        if (!appUsable) return "not-found"
        if (!primaryId) {
            // An app with no revision gets the error state, as in the old playground.
            return latestId || latestQuery.isPending ? "loading" : "error"
        }
        // A primary that is not a revision of this app is about to be replaced: wait for that.
        return primaryQuery.isPending || keptIds[0] !== primaryId ? "loading" : "ready"
    })()
    const appKind: PlaygroundAppKind | null =
        status !== "ready" ? null : isEvaluator ? "evaluator" : isAgent ? "agent" : "prompt"

    return {
        status,
        appKind,
        appName: detail.data?.name ?? null,
        revisionIds,
        primaryRevisionId: primaryId,
        retry,
    }
}
