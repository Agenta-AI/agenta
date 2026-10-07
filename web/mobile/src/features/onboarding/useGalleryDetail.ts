import {useCallback, useLayoutEffect, useRef, type RefObject} from "react"

import {useRouter} from "next/router"

/** `?onboarding-detail`: a phone shows one template (or the blank start) in place of the list. */
const DETAIL_PARAM = "onboarding-detail"

/** Below `md` the list and the focused panel are two views; from `md` they sit side by side. */
const isTwoColumn = () =>
    typeof window !== "undefined" && (window.matchMedia?.("(min-width: 48rem)").matches ?? false)

const scrollerOf = (node: HTMLElement | null) =>
    node?.closest<HTMLElement>("[data-onboarding-scroller]") ?? null

/**
 * The gallery's phone navigation. Opening a detail adds a shallow `?onboarding-detail` entry, so
 * the system back gesture closes it; the list's scroll position comes back with it.
 */
export const useGalleryDetail = (rootRef: RefObject<HTMLElement | null>) => {
    const router = useRouter()
    const open = router.query[DETAIL_PARAM] !== undefined
    const pushedRef = useRef(false)
    const listScrollRef = useRef(0)

    const withoutParam = () => {
        const query = {...router.query}
        delete query[DETAIL_PARAM]
        return {pathname: router.pathname, query}
    }

    const openDetail = useCallback(() => {
        if (isTwoColumn() || open) return
        const scroller = scrollerOf(rootRef.current)
        listScrollRef.current = scroller?.scrollTop ?? 0
        pushedRef.current = true
        void router.push(
            {pathname: router.pathname, query: {...router.query, [DETAIL_PARAM]: "1"}},
            undefined,
            {shallow: true, scroll: false},
        )
    }, [open, rootRef, router])

    const closeDetail = () => {
        if (!open) return
        if (pushedRef.current) {
            pushedRef.current = false
            router.back()
            return
        }
        void router.replace(withoutParam(), undefined, {shallow: true, scroll: false})
    }

    /** Leaving the gallery drops the entry without adding one, so Back never reopens it. */
    const dropDetail = () => {
        if (!open) return
        pushedRef.current = false
        void router.replace(withoutParam(), undefined, {shallow: true, scroll: false})
    }

    const wasOpenRef = useRef(open)
    useLayoutEffect(() => {
        const scroller = scrollerOf(rootRef.current)
        if (scroller && open !== wasOpenRef.current) {
            scroller.scrollTop = open ? 0 : listScrollRef.current
        }
        wasOpenRef.current = open
    }, [open, rootRef])

    return {open, returning: !open && wasOpenRef.current, openDetail, closeDetail, dropDetail}
}
