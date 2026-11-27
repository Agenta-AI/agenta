import {useLayoutEffect, useRef, useState} from "react"

/** Room kept under the table for the footer: "Showing N of M" and Load more. */
const FOOTER_ROOM = 72
/** The body never gets shorter than this, so a short window still shows rows. */
const MIN_BODY = 240

/**
 * The height of the table body that fits the window under the table's header, or undefined
 * while the rows fit anyway. With a height the body scrolls on its own and the header stays in
 * place; without one the table is as tall as its rows. Measured again when the window resizes.
 */
export function useTableBodyHeight(contentHeight: number, deps: readonly unknown[]) {
    const boxRef = useRef<HTMLDivElement>(null)
    const [room, setRoom] = useState<number | null>(null)

    useLayoutEffect(() => {
        const measure = () => {
            const box = boxRef.current
            if (!box) return
            const top = box.getBoundingClientRect().top
            const header = box.querySelector("thead")?.getBoundingClientRect().height ?? 0
            setRoom(Math.max(MIN_BODY, Math.floor(window.innerHeight - top - header - FOOTER_ROOM)))
        }
        measure()
        window.addEventListener("resize", measure)
        return () => window.removeEventListener("resize", measure)
        // The header height changes with the density and the evaluator columns.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)

    const height = room !== null && contentHeight > room ? room : undefined
    return {boxRef, height}
}
