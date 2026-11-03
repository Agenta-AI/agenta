import {useCallback} from "react"

import {useRouter} from "next/router"

const PARAM = "revisionId"

/**
 * The open revision, kept in the URL as `?revisionId=` (the /w name, so /w links open here too).
 * The URL is the drawer's only open state; `null` closes it.
 */
export const useRevisionParam = () => {
    const router = useRouter()
    const value = router.query[PARAM]
    const revisionId = typeof value === "string" && value ? value : null

    const setRevisionId = useCallback(
        (next: string | null) => {
            const {[PARAM]: _previous, ...rest} = router.query
            void router.replace(
                {pathname: router.pathname, query: next ? {...rest, [PARAM]: next} : rest},
                undefined,
                {shallow: true},
            )
        },
        [router],
    )

    return [revisionId, setRevisionId] as const
}
