import {useEffect} from "react"

import {isSessionFresh, type SessionStream} from "@agenta/entities/session"
import type {QueryClient} from "@tanstack/react-query"
import {atom, useAtom, useAtomValue, type createStore} from "jotai"

import {pageSessionIdAtom} from "../chat/pageSessionId"
import {sessionHeaderKey, useSessionHeader} from "../chat/useSessionHeader"

import {
    pageContextAtom,
    pagePartKey,
    resolvePagePart,
    type PageContextPage,
    type PageSessionState,
} from "./pageContext"

/**
 * The page part the person removed with "Remove the context", by its key. It counts only on the
 * page it was removed on: another page shows its chip again.
 */
export const removedPagePartAtom = atom<string | null>(null)

const notRemoved = (page: PageContextPage | null, removed: string | null) =>
    page && pagePartKey(page) !== removed ? page : null

/** The page part of this moment, as the chip shows it. Subscribes to the page session's row. */
export const usePagePart = (projectId: string) => {
    const configuration = useAtomValue(pageContextAtom)
    const pageSessionId = useAtomValue(pageSessionIdAtom)
    // A new session with no turn has no row to read: no request for it.
    const sessionId = pageSessionId && !isSessionFresh(pageSessionId) ? pageSessionId : ""
    // The same query the session header reads, so the chip adds no request.
    const row = useSessionHeader(projectId, configuration ? "" : sessionId)
    const page = resolvePagePart(
        configuration,
        sessionId && !configuration ? {id: sessionId, pending: row.isPending, row: row.data} : null,
    )
    const [removed, setRemoved] = useAtom(removedPagePartAtom)
    const key = pagePartKey(page)
    // A removal ends when the page changes.
    useEffect(() => {
        if (removed && removed !== key) setRemoved(null)
    }, [key, removed, setRemoved])
    return {
        page,
        removed: Boolean(page) && removed === key,
        remove: () => setRemoved(key),
        restore: () => setRemoved(null),
    }
}

/** The page part when the person presses Send, read from the store and the query cache. */
export const readPagePart = (
    store: ReturnType<typeof createStore>,
    queryClient: QueryClient,
    projectId: string,
): PageContextPage | null => {
    const pageSessionId = store.get(pageSessionIdAtom)
    let session: PageSessionState | null = null
    if (pageSessionId && !isSessionFresh(pageSessionId)) {
        const state = queryClient.getQueryState<SessionStream | null>(
            sessionHeaderKey(projectId, pageSessionId),
        )
        session = {
            id: pageSessionId,
            pending: !state || state.data === undefined,
            row: state?.data,
        }
    }
    return notRemoved(
        resolvePagePart(store.get(pageContextAtom), session),
        store.get(removedPagePartAtom),
    )
}
