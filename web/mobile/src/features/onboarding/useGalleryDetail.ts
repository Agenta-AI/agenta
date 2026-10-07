import {useLayoutEffect, useRef, useSyncExternalStore, type RefObject} from "react"

/** Below `md` the list and the focused panel are two views; from `md` they sit side by side. */
const TWO_COLUMN = "(min-width: 48rem)"

const subscribe = (onChange: () => void) => {
    const list = window.matchMedia?.(TWO_COLUMN)
    list?.addEventListener("change", onChange)
    return () => list?.removeEventListener("change", onChange)
}
const isTwoColumn = () => window.matchMedia?.(TWO_COLUMN).matches ?? false

const scrollerOf = (node: HTMLElement | null) =>
    node?.closest<HTMLElement>("[data-onboarding-scroller]") ?? null

/**
 * The gallery's phone view: a focused panel replaces the list, and closing it brings the list
 * back where it was scrolled.
 */
export const useGalleryDetail = (rootRef: RefObject<HTMLElement | null>, focused: boolean) => {
    const twoColumn = useSyncExternalStore(subscribe, isTwoColumn, () => false)
    const open = focused && !twoColumn
    const listScrollRef = useRef(0)

    const wasOpenRef = useRef(open)
    useLayoutEffect(() => {
        const scroller = scrollerOf(rootRef.current)
        if (scroller && open !== wasOpenRef.current) {
            scroller.scrollTop = open ? 0 : listScrollRef.current
        }
        wasOpenRef.current = open
    }, [open, rootRef])

    const rememberListScroll = () => {
        listScrollRef.current = scrollerOf(rootRef.current)?.scrollTop ?? 0
    }

    return {open, twoColumn, returning: !open && wasOpenRef.current, rememberListScroll}
}
