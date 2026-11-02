import {useEffect, useRef, useState} from "react"

import {useRouter} from "next/router"

export const SEARCH_DEBOUNCE_MS = 300

/**
 * The list's search term, kept in the URL as `?q=` so a reload keeps it and a fresh visit opens
 * unfiltered. The box shows what the reader types at once; the URL, and so the request, follows
 * after a pause.
 */
export function useTestsetsSearch() {
    const router = useRouter()
    const urlTerm = typeof router.query.q === "string" ? router.query.q : ""
    const [draft, setDraft] = useState(urlTerm)
    const seeded = useRef(router.isReady)

    // A cold load has no query until the router is ready: take the URL's term once, then the
    // reader owns the box.
    useEffect(() => {
        if (seeded.current || !router.isReady) return
        seeded.current = true
        setDraft(urlTerm)
    }, [router.isReady, urlTerm])

    useEffect(() => {
        if (!router.isReady || draft === urlTerm) return
        const timer = setTimeout(() => {
            const {q: _previous, ...rest} = router.query
            const query = draft.trim() ? {...rest, q: draft} : rest
            void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [draft, router, urlTerm])

    return {draft, setDraft, term: urlTerm.trim()}
}
