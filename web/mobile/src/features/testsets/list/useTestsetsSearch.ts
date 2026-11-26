import {useEffect, useRef, useState} from "react"

import {useRouter} from "next/router"

export const SEARCH_DEBOUNCE_MS = 300

/**
 * The list's search term, kept in the URL as `?q=` so a reload keeps it and a fresh visit opens
 * unfiltered. The box shows what the reader types at once; the URL, and so the request, follows
 * after a pause. A change to the URL that this hook did not make (a cold load, Back) replaces
 * the box.
 */
export function useTestsetsSearch() {
    const router = useRouter()
    const urlTerm = typeof router.query.q === "string" ? router.query.q : ""
    const [draft, setDraft] = useState(urlTerm)
    // Every value this hook wrote, so a late echo of an older write is not taken for a Back.
    const written = useRef(new Set<string>([urlTerm]))

    useEffect(() => {
        if (written.current.has(urlTerm)) return
        written.current.add(urlTerm)
        setDraft(urlTerm)
    }, [urlTerm])

    useEffect(() => {
        if (!router.isReady || draft.trim() === urlTerm.trim()) return
        const timer = setTimeout(() => {
            const {q: _previous, ...rest} = router.query
            const next = draft.trim()
            written.current.add(next)
            void router.replace(
                {pathname: router.pathname, query: next ? {...rest, q: next} : rest},
                undefined,
                {shallow: true},
            )
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [draft, router, urlTerm])

    return {draft, setDraft, term: urlTerm.trim()}
}
