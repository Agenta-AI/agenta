import {useCallback} from "react"

import {useRouter} from "next/router"

import {currentQuery} from "../bindTraceDrawerSeams"

/**
 * What the open drawer needs from the address bar: the `?span=` a link carried, and a way to
 * close. Closing replaces the history entry, so Back does not reopen what was closed, and it
 * drops `session` and `span` and keeps the other params.
 */
export const useSessionDrawerUrl = () => {
    const router = useRouter()
    const param = router.query.span
    const spanId = typeof param === "string" && param !== "" ? param : null

    const close = useCallback(() => {
        const query = currentQuery(router, window.location.search)
        delete query.session
        delete query.span
        void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
    }, [router])

    return {spanId, close}
}
