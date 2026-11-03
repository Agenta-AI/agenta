import {useCallback} from "react"

import {useRouter} from "next/router"

import {currentQuery} from "../bindTraceDrawerSeams"

const readParam = (value: string | string[] | undefined): string | null =>
    typeof value === "string" && value !== "" ? value : null

/**
 * The open observability session lives in the address bar, as `?session=`, so a link opens it,
 * Back closes it and the screen needs no state of its own. Opening and moving between sessions
 * push a history entry. Closing replaces the entry, so Back does not reopen what was closed.
 * Both keep the other params (`app`, `trace`) and drop `span`, which belongs to the session
 * that was open.
 */
export const useObservabilitySessionUrl = () => {
    const router = useRouter()
    const sessionId = readParam(router.query.session)
    const spanId = readParam(router.query.span)

    const open = useCallback(
        (id: string) => {
            const query = currentQuery(router, window.location.search)
            query.session = id
            delete query.span
            void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
        },
        [router],
    )

    const close = useCallback(() => {
        const query = currentQuery(router, window.location.search)
        delete query.session
        delete query.span
        void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
    }, [router])

    return {sessionId, spanId, open, close}
}
