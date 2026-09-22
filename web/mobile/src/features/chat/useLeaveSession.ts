import {useCallback, useEffect, useRef} from "react"

import {sessionRoutePath} from "@agenta/sessions/link"
import {
    closeSessionTabsAtom,
    nearestSurvivingTab,
    renderedSessionTabsAtomFamily,
    sessionTabScope,
} from "@agenta/sessions/state"
import {useStore} from "jotai"
import Router, {useRouter} from "next/router"

import {startBlankSession} from "./useStartBlankSession"

/** The session a verb removed, and the agent whose rail it sat in. */
export interface LeaveSessionTarget {
    sessionId: string
    appId: string | null
}

/** Resolves either way: a cancelled navigation resolves false and a refused one throws. */
const settle = (navigation: Promise<unknown>) =>
    navigation.then(
        () => undefined,
        () => undefined,
    )

/** Resolves when the route change issued next has landed or failed. */
const nextRouteChange = () =>
    new Promise<void>((resolve) => {
        const done = () => {
            Router.events.off("routeChangeComplete", done)
            Router.events.off("routeChangeError", done)
            resolve()
        }
        Router.events.on("routeChangeComplete", done)
        Router.events.on("routeChangeError", done)
    })

/** The session on screen, from the route — the one whose removal has to move you. */
const useActiveSessionId = (): string | undefined => {
    const {session_id: sessionId} = useRouter().query
    return typeof sessionId === "string" ? sessionId : undefined
}

/**
 * Where a verb that removes a session — archive, delete — leaves you.
 *
 * A session is a URL here, so removing the one you are on is a route change, the same rule
 * closing its tab follows. Without it the verb landed, the rail dropped the row, and the page
 * stayed parked on a session no list carries, retitled "New session" over its old transcript.
 *
 * Lands on the nearest surviving tab; a blank session with the same agent when it was the only
 * one; the sessions list when the session's agent is unknown. Resolves once the route change has
 * settled. Bound to the route, not to a chat surface, so the nav drawer's rows use it too.
 */
export const useLeaveSession = (base: string) => {
    const router = useRouter()
    const store = useStore()
    const activeId = useActiveSessionId()

    // The tab of the session being left, dropped once the route has moved on. Not at landing:
    // the session on screen always rejoins the open set, and the rail's join effect for the
    // old id can still run after the route event fires, putting the tab straight back.
    const pendingCloseRef = useRef<LeaveSessionTarget | null>(null)
    useEffect(() => {
        const pending = pendingCloseRef.current
        if (!pending || pending.sessionId === activeId) return
        pendingCloseRef.current = null
        store.set(closeSessionTabsAtom, {
            scope: sessionTabScope(pending.appId),
            ids: [pending.sessionId],
        })
    }, [activeId, store])

    /** Drop the tab, and first move off it when it is the one on screen. */
    return useCallback(
        async ({sessionId, appId}: LeaveSessionTarget) => {
            const scope = sessionTabScope(appId)
            if (sessionId !== activeId) {
                store.set(closeSessionTabsAtom, {scope, ids: [sessionId]})
                return
            }
            pendingCloseRef.current = {sessionId, appId}
            // Read at call time: the rendered order changes often, and this must not.
            const openTabIds = store.get(renderedSessionTabsAtomFamily(scope))
            const survivor = nearestSurvivingTab(openTabIds, new Set([sessionId]), sessionId)
            if (survivor && survivor !== sessionId) {
                await settle(router.push(sessionRoutePath(base, survivor)))
            } else if (appId) {
                // `startBlankSession` owns its navigation (and de-duplicates a double tap), so
                // its landing is watched on the router rather than awaited — unless the one it
                // hands back has landed already, when no further event is coming.
                const landed = nextRouteChange()
                const blankId = startBlankSession(base, appId)
                if (!Router.asPath.includes(blankId)) await landed
            } else {
                await settle(router.push(`${base}/sessions`))
            }
            // A navigation that did not move (refused, cancelled) must not close the tab later.
            if (
                pendingCloseRef.current?.sessionId === sessionId &&
                Router.asPath.includes(sessionId)
            )
                pendingCloseRef.current = null
        },
        [activeId, base, router, store],
    )
}
