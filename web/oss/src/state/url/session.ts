import {atom, getDefaultStore} from "jotai"
import Router from "next/router"

import {
    initialSessionDrawerState,
    openSessionDrawerAtom,
    sessionDrawerAtom,
    setSessionDrawerActiveSpanAtom,
} from "@/oss/components/SharedDrawers/SessionDrawer/store/sessionDrawerStore"

import {isSessionSupportedRoute} from "./routeMatchers"

const isBrowser = typeof window !== "undefined"

export const setSessionIdQueryParam = (sessionId: string | null) => {
    if (!isBrowser) return
    const url = new URL(window.location.href)
    if (sessionId) {
        url.searchParams.set("session", sessionId)
    } else {
        url.searchParams.delete("session")
    }
    const newPath = `${url.pathname}${url.search}${url.hash}`
    void Router.push(newPath, undefined, {shallow: true})
}

export const openSessionDrawerWithUrlAtom = atom(
    null,
    (_get, set, payload: {sessionId: string; activeSpanId?: string | null}) => {
        setSessionIdQueryParam(payload.sessionId)
        set(openSessionDrawerAtom, payload)
    },
)

export const sessionIdAtom = atom<string | undefined>(undefined)

export const clearSessionDrawerState = () => {
    const store = getDefaultStore()
    const current = store.get(sessionDrawerAtom)

    if (current.open || current.sessionId || current.activeSpanId) {
        store.set(sessionDrawerAtom, () => ({...initialSessionDrawerState}))
    }

    store.set(sessionIdAtom, undefined)
}

export const syncSessionStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const sessionParam = url.searchParams.get("session") ?? undefined
        const spanParam = url.searchParams.get("span") ?? undefined
        const routeSupportsSession = isSessionSupportedRoute(url.pathname)
        const currentSessionId = store.get(sessionIdAtom)
        const currentDrawerState = store.get(sessionDrawerAtom)

        if (!routeSupportsSession) {
            if (sessionParam) {
                url.searchParams.delete("session")
                // We keep span param if it's there as it might be used by trace drawer?
                // But if we are in session route, maybe we should clean it if it was for session?
                // For now let's just clean session param if route doesn't support it.

                const newPath = `${url.pathname}${url.search}${url.hash}`
                void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
                    console.error("Failed to remove unsupported session query params:", error)
                })
            }
            if (currentSessionId !== undefined) {
                clearSessionDrawerState()
            }
            return
        }

        if (!sessionParam) {
            if (currentSessionId !== undefined) {
                clearSessionDrawerState()
            }
            return
        }

        if (currentDrawerState.open && currentSessionId === sessionParam) {
            return
        }

        store.set(sessionIdAtom, sessionParam)

        store.set(openSessionDrawerAtom, {
            sessionId: sessionParam,
            activeSpanId: spanParam ?? null,
        })

        store.set(setSessionDrawerActiveSpanAtom, spanParam ?? null)
    } catch (err) {
        console.error("Failed to sync session state from URL:", nextUrl, err)
    }
}

export const clearSessionQueryParam = () => {
    if (!isBrowser) return
    try {
        const url = new URL(window.location.href)
        let mutated = false
        if (url.searchParams.has("session")) {
            url.searchParams.delete("session")
            mutated = true
        }
        // We probably shouldn't clear 'span' here broadly as it might be used by trace?
        // But if the drawer closes, we might want to clear it.
        // Trace drawer clears both.
        if (url.searchParams.has("span")) {
            url.searchParams.delete("span")
            mutated = true
        }
        if (!mutated) return
        const newPath = `${url.pathname}${url.search}${url.hash}`
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to clear session query params:", error)
        })
    } catch (err) {
        console.error("Failed to clear session query params:", err)
    }
}

export const clearSessionParamAtom = atom(null, (_get, _set) => {
    clearSessionQueryParam()
})
