import {useLayoutEffect, useState} from "react"

const MIN_HEIGHT = 240

const scrollParentOf = (node: HTMLElement): HTMLElement | null => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
    }
    return null
}

/** A height that makes `node` take the rest of its page, so the page does not scroll and the node does. */
export function useFillPageHeight(node: HTMLElement | null): number | undefined {
    const [height, setHeight] = useState<number>()

    useLayoutEffect(() => {
        if (!node) return
        const scroller = scrollParentOf(node)
        if (!scroller) return
        const measure = () => {
            // Everything in the page but this node: its content height minus the node's own.
            const content = Array.from(scroller.children).reduce(
                (sum, child) => sum + (child as HTMLElement).offsetHeight,
                0,
            )
            const rest = content - node.offsetHeight
            setHeight(Math.max(MIN_HEIGHT, scroller.clientHeight - rest))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(scroller)
        // Content above or below the node can change too (a row that shows or hides).
        for (const child of Array.from(scroller.children)) observer.observe(child)
        return () => observer.disconnect()
    }, [node])

    return height
}
