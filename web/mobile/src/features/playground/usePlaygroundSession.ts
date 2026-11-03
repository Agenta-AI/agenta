import {useCallback, useEffect, useRef} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {
    workflowDetailQueryAtomFamily,
    workflowLatestRevisionIdAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
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

import {parseRevisionIds} from "./playgroundUrl"

export type PlaygroundSessionStatus =
    | "loading"
    | "ready"
    | "error"
    | "not-found"
    | "agent"
    | "evaluator"

export interface PlaygroundSession {
    status: PlaygroundSessionStatus
    /** The first selected revision. It anchors the test cases. */
    primaryId: string | null
    entityIds: string[]
    /** Fetches the failed app and revision requests again. */
    retry: () => void
}

/**
 * The selected ids that can stay: local drafts, ids still loading, ids whose load failed (the
 * screen shows the error), and loaded revisions of this app. An id that loaded with no data, or
 * that belongs to another app, goes.
 */
const keptEntityIdsAtomFamily = atomFamily((appId: string) =>
    atom((get) =>
        get(playgroundController.selectors.entityIds()).filter((id) => {
            if (isLocalDraftId(id)) return true
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
 * and on unmount it clears the playground nodes and runs: the agent session screen uses the same
 * store, so nothing from here may outlive the route.
 */
export const usePlaygroundSession = ({appId}: {appId: string}): PlaygroundSession => {
    const router = useRouter()
    const routerRef = useRef(router)
    routerRef.current = router
    const store = useStore()

    const detail = useAtomValue(workflowDetailQueryAtomFamily(appId))
    const latestQuery = useAtomValue(workflowLatestRevisionQueryAtomFamily(appId))
    const latestId = useAtomValue(workflowLatestRevisionIdAtomFamily(appId))
    const entityIds = useAtomValue(playgroundController.selectors.entityIds())
    const keptIds = useAtomValue(keptEntityIdsAtomFamily(appId))
    const primaryId = entityIds[0] ?? null
    const primaryQuery = useAtomValue(workflowMolecule.selectors.query(primaryId ?? ""))
    const isEvaluator = useAtomValue(workflowMolecule.selectors.isEvaluator(primaryId ?? ""))
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(primaryId ?? ""))

    const appUsable = !!detail.data && !detail.data.deleted_at
    // The app this hook has set up the playground for. Effects read the store, not render values:
    // after an app change they run before the next render.
    const sessionAppRef = useRef<string | null>(null)

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
        sessionAppRef.current = appId
        select(parseRevisionIds(routerRef.current.query.revisions))
        store.set(playgroundInitializedAtom, true)
        return () => {
            sessionAppRef.current = null
            store.set(playgroundController.actions.resetAll)
            store.set(executionItemController.actions.clearAll)
            store.set(playgroundInitializedAtom, false)
        }
    }, [appId, appUsable, router.isReady, select, store])

    // Drop ids that are not revisions of this app; with nothing left, take the latest revision.
    useEffect(() => {
        if (sessionAppRef.current !== appId) return
        const current = store.get(playgroundController.selectors.entityIds())
        const kept = store.get(keptEntityIdsAtomFamily(appId))
        if (kept.length !== current.length) {
            store.set(playgroundController.actions.setEntityIds, kept)
        }
        if (kept.length === 0 && latestId) select([latestId])
        // `keptIds` only triggers the effect: in the commit that sets the playground up it is
        // still the value from before, so the store is read instead.
    }, [appId, keptIds, latestId, select, store])

    // Write the selection to `?revisions=`. Local drafts stay out until share links exist.
    useEffect(() => {
        if (sessionAppRef.current !== appId) return
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
    }, [appId, entityIds, store])

    const retry = useCallback(() => {
        const queryClient = store.get(queryClientAtom)
        void queryClient.refetchQueries({predicate: (query) => query.state.status === "error"})
        void queryClient.refetchQueries({queryKey: ["workflows", "latestRevision", appId]})
    }, [appId, store])

    const status = ((): PlaygroundSessionStatus => {
        if (detail.isError || latestQuery.isError || (primaryId && primaryQuery.isError)) {
            return "error"
        }
        if (detail.isPending) return "loading"
        if (!appUsable) return "not-found"
        if (!primaryId) {
            // An app with no revision gets the error state, as in the old playground.
            return latestId || latestQuery.isPending ? "loading" : "error"
        }
        if (primaryQuery.isPending) return "loading"
        if (isEvaluator) return "evaluator"
        if (isAgent) return "agent"
        return "ready"
    })()

    return {status, primaryId, entityIds, retry}
}
