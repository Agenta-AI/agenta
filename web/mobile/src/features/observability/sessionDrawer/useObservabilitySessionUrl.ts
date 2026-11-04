import {useCallback} from "react"

import {useRouter} from "next/router"

import {currentQuery} from "../bindTraceDrawerSeams"

/**
 * The open observability session lives in the address bar, as `?session=`, so a link opens it,
 * Back closes it and the screen needs no state of its own. Opening pushes a history entry and
 * drops `span`, which belongs to the session that was open. The other params (`app`, `trace`)
 * stay.
 *
 * This file is on the page everyone opens. Closing and `?span=` are only needed once the drawer
 * is open, so they live in `useSessionDrawerUrl`, in the drawer's own chunk.
 */
export const useObservabilitySessionUrl = () => {
    const router = useRouter()
    const param = router.query.session
    const sessionId = typeof param === "string" && param !== "" ? param : null

    const open = useCallback(
        (id: string) => {
            const query = currentQuery(router, window.location.search)
            query.session = id
            delete query.span
            void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
        },
        [router],
    )

    return {sessionId, open}
}
