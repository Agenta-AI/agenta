import {useCallback, useEffect, useRef} from "react"

import {
    annotationFormController,
    annotationSessionController,
    registerAnnotationCallbacks,
    type SessionView,
} from "@agenta/annotation"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

/** Anything but a known view reads as the Annotate tab. */
export const parseSessionView = (raw: unknown): SessionView =>
    raw === "list" || raw === "configuration" ? raw : "annotate"

interface RouteState {
    view: SessionView
    scenarioId: string | undefined
}

/**
 * The session's tab and scenario live in the URL (`?view=&scenarioId=`), written with a shallow
 * replace. The hook opens the queue in the session controller, feeds URL changes to it, writes its
 * scenario moves back to the URL, and closes the session and the form drafts on leave.
 */
export const useQueueSessionRoute = (queueId: string) => {
    const router = useRouter()
    const view = parseSessionView(router.query.view)
    const scenarioId =
        typeof router.query.scenarioId === "string" && router.query.scenarioId
            ? router.query.scenarioId
            : undefined

    const openQueue = useSetAtom(annotationSessionController.actions.openQueue)
    const closeSession = useSetAtom(annotationSessionController.actions.closeSession)
    const clearFormState = useSetAtom(annotationFormController.actions.clearFormState)
    const applyRouteState = useSetAtom(annotationSessionController.actions.applyRouteState)
    const setActiveView = useSetAtom(annotationSessionController.actions.setActiveView)
    const syncScenarioOrder = useSetAtom(annotationSessionController.actions.syncScenarioOrder)
    const scenarioCount = useAtomValue(annotationSessionController.selectors.scenarioIds()).length
    const scenariosData = useAtomValue(annotationSessionController.selectors.scenariosQuery()).data

    const routerRef = useRef(router)
    // What the URL should read once every write has landed. Two writes in a row (a tab change and
    // the scenario move it causes) merge here instead of the second one undoing the first.
    const wanted = useRef<RouteState>({view, scenarioId})
    const pendingWrites = useRef(0)
    const initialRoute = useRef<RouteState>({view, scenarioId})
    useEffect(() => {
        routerRef.current = router
    })

    const writeRoute = useCallback((patch: Partial<RouteState>) => {
        wanted.current = {...wanted.current, ...patch}
        const current = routerRef.current
        const query: Record<string, string | string[] | undefined> = {
            ...current.query,
            view: wanted.current.view,
            scenarioId: wanted.current.scenarioId,
        }
        if (!query.scenarioId) delete query.scenarioId
        pendingWrites.current += 1
        void current
            .replace({pathname: current.pathname, query}, undefined, {shallow: true})
            .catch(() => undefined)
            .finally(() => {
                pendingWrites.current -= 1
            })
    }, [])

    useEffect(() => {
        if (!queueId) return
        openQueue({
            queueId,
            queueType: "simple",
            initialView: initialRoute.current.view,
            initialScenarioId: initialRoute.current.scenarioId ?? null,
        })
        return () => {
            closeSession()
            clearFormState()
        }
    }, [queueId, openQueue, closeSession, clearFormState])

    useEffect(() => {
        // An older write landing while a newer one is on its way: the controller is already ahead.
        const target = wanted.current
        const stale =
            pendingWrites.current > 0 && (target.view !== view || target.scenarioId !== scenarioId)
        if (stale) return
        wanted.current = {view, scenarioId}
        applyRouteState({view, scenarioId})
    }, [applyRouteState, view, scenarioId, scenarioCount])

    useEffect(() => {
        syncScenarioOrder()
    }, [syncScenarioOrder, scenariosData])

    useEffect(() => {
        registerAnnotationCallbacks({onNavigate: (nextId) => writeRoute({scenarioId: nextId})})
        return () => registerAnnotationCallbacks({})
    }, [writeRoute])

    const setView = useCallback(
        (next: SessionView) => {
            setActiveView(next)
            writeRoute({view: next})
        },
        [setActiveView, writeRoute],
    )

    // The tab shows the controller's view, so a click answers before the URL write lands.
    const activeView = useAtomValue(annotationSessionController.selectors.activeView())
    return {view: activeView, setView}
}
