import {useCallback, useEffect, useRef, useState} from "react"

import {isPlaceholderId} from "@agenta/entities/shared"
import {workflowDetailQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    hasPendingHydrationAtomFamily,
    playgroundController,
    playgroundInitializedAtom,
} from "@agenta/playground"
import {atom, useAtomValue, useStore} from "jotai"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"
import {useRouter} from "next/router"

import {clearPlayground} from "./clearPlayground"
import {readLastSelection, writeLastSelection} from "./playgroundLastSelection"
import {playgroundLatestRevisionIdAtomFamily} from "./playgroundLatestRevision"
import {
    hasPendingRestore,
    isSavedRevisionId,
    playgroundAddress,
    restoreSnapshot,
    snapshotTriggerAtom,
    syncSnapshotDrafts,
} from "./playgroundSnapshot"
import {parseRevisionIds, readSnapshotParam, SNAPSHOT_PARAM} from "./playgroundUrl"

/** How long the address waits after the last edit before it is written. */
const ADDRESS_WRITE_DELAY_MS = 300

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
 * error), revisions and local drafts of this app, and the placeholder of a restored copy until
 * the copy replaces it. An id with no data behind it, or one that belongs to another app, goes.
 */
const keptRevisionIdsAtomFamily = atomFamily((appId: string) =>
    atom((get) =>
        get(playgroundController.selectors.entityIds()).filter((id) => {
            if (isPlaceholderId(id)) return get(hasPendingHydrationAtomFamily(id))
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
 * On mount it restores the `#pgSnapshot` hash (revisions, drafts, evaluators, test cases), else
 * selects the revisions in `?revisions=` (in order), else the app's last selection, else its
 * latest revision. It writes the selection back to `?revisions=` and the work to the hash, drops
 * ids that are not revisions of this app, and on unmount it clears the playground nodes, runs and
 * test set connection: the agent session screen uses the same store, so nothing from here may
 * outlive the route.
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

    // While a restored test set loads, the address is not written: it would drop the connection.
    const restoringRef = useRef(false)

    // A link into this open page (the trace drawer's Playground on the same app) keeps the page
    // mounted: count each such visit, so the page sets up again from the new address. The page's
    // own writes are shallow and do not count.
    const [visit, setVisit] = useState(0)
    const setUpAddressRef = useRef("")
    useEffect(() => {
        const events = routerRef.current.events
        const onVisit = (_url: string, {shallow}: {shallow: boolean}) => {
            const {pathname, search, hash} = window.location
            if (shallow || `${pathname}${search}${hash}` === setUpAddressRef.current) return
            setVisit((count) => count + 1)
        }
        events?.on("routeChangeComplete", onVisit)
        return () => events?.off("routeChangeComplete", onVisit)
    }, [])

    useEffect(() => {
        if (!router.isReady || !appUsable) return
        setUpForAppRef.current = appId
        setUpAddressRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`
        const stopDrafts = syncSnapshotDrafts(store)
        const encoded = readSnapshotParam(window.location.hash)
        const restoring = encoded ? restoreSnapshot(store, encoded) : null
        if (restoring) {
            restoringRef.current = true
            void restoring.finally(() => {
                restoringRef.current = false
            })
        } else {
            const requested = parseRevisionIds(routerRef.current.query.revisions)
            select(requested.length > 0 ? requested : readLastSelection(appId))
        }
        store.set(playgroundInitializedAtom, true)
        return () => {
            setUpForAppRef.current = null
            restoringRef.current = false
            stopDrafts()
            clearPlayground(store)
        }
    }, [appId, appUsable, router.isReady, select, store, visit])

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

    // Keep the saved revisions for the next visit.
    useEffect(() => {
        if (setUpForAppRef.current !== appId || keptIds.length !== revisionIds.length) return
        const saved = revisionIds.filter(isSavedRevisionId)
        if (saved.length > 0) writeLastSelection(appId, saved)
    }, [appId, keptIds, revisionIds])

    // Write `?revisions=` and the `#pgSnapshot` hash a moment after the last change: each write
    // re-renders the page. A store subscription, so an edit does not re-render this screen.
    useEffect(() => {
        if (!router.isReady || !appUsable) return
        const write = () => {
            if (setUpForAppRef.current !== appId || restoringRef.current) return
            if (hasPendingRestore(store)) return
            const {revisions, snapshot} = playgroundAddress(store)
            const {pathname, query} = routerRef.current
            if (!revisions) return
            if (
                revisions === query.revisions &&
                snapshot === readSnapshotParam(window.location.hash)
            ) {
                return
            }
            void routerRef.current
                .replace(
                    {
                        pathname,
                        query: {...query, revisions},
                        ...(snapshot ? {hash: `${SNAPSHOT_PARAM}=${snapshot}`} : {}),
                    },
                    undefined,
                    {shallow: true, scroll: false},
                )
                .catch(() => undefined)
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        const schedule = () => {
            clearTimeout(timer)
            timer = setTimeout(write, ADDRESS_WRITE_DELAY_MS)
        }
        const unsubscribe = store.sub(snapshotTriggerAtom, schedule)
        // Another writer of the address (the trace drawer's `?trace=`) drops the hash: put it back.
        const events = routerRef.current.events
        events?.on("routeChangeComplete", schedule)
        schedule()
        return () => {
            unsubscribe()
            events?.off("routeChangeComplete", schedule)
            clearTimeout(timer)
        }
    }, [appId, appUsable, router.isReady, store, visit])

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
