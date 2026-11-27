import {useLayoutEffect, useRef, useState} from "react"

/** Room kept under the table for the footer: "Showing N of M" and Load more. */
const FOOTER_ROOM = 72
/** The body never gets shorter than this, so a short window still shows rows. */
const MIN_BODY = 240

/**
 * How far the page is scrolled: the nearest scrolling box above the table (a /m screen scrolls
 * inside `ScreenScaffold`, not in the window), else the window.
 */
function scrolledBy(box: HTMLElement): number {
    for (let node = box.parentElement; node; node = node.parentElement) {
        const {overflowY} = window.getComputedStyle(node)
        if (overflowY === "auto" || overflowY === "scroll") return node.scrollTop
    }
    return window.scrollY
}

/**
 * The room under the table's header, in px, with the page scrolled to its top: the table's place
 * is read from the top of the page, so scrolling the page does not change it.
 */
function roomOf(box: HTMLElement | null): number | null {
    if (!box) return null
    const top = box.getBoundingClientRect().top + scrolledBy(box)
    const header = box.querySelector("thead")?.getBoundingClientRect().height ?? 0
    return Math.max(MIN_BODY, Math.floor(window.innerHeight - top - header - FOOTER_ROOM))
}

/**
 * The height of the table body that fits the window under the table's header, or undefined
 * while the rows fit anyway. With a height the body scrolls on its own and the header stays in
 * place; without one the table is as tall as its rows. Measured after every render (a line above
 * the table may come or go, the header may grow) and on a window resize.
 */
export function useTableBodyHeight(contentHeight: number) {
    const boxRef = useRef<HTMLDivElement>(null)
    const [room, setRoom] = useState<number | null>(null)

    // No dependency list on purpose: setting the same number does not render again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
        setRoom(roomOf(boxRef.current))
    })
    useLayoutEffect(() => {
        const onResize = () => setRoom(roomOf(boxRef.current))
        window.addEventListener("resize", onResize)
        return () => window.removeEventListener("resize", onResize)
    }, [])

    const height = room !== null && contentHeight > room ? room : undefined
    return {boxRef, height}
}
