import {useCallback, useEffect, useState} from "react"

import {useVirtualTableScrollContainer} from "@/oss/components/InfiniteVirtualTable"

// Fixed buffer values - no need for dynamic calculation per cell
// These provide generous lookahead for smooth scrolling
const HORIZONTAL_BUFFER = 400
const VERTICAL_BUFFER = 300
const ROOT_MARGIN = `${VERTICAL_BUFFER}px ${HORIZONTAL_BUFFER}px ${VERTICAL_BUFFER}px ${HORIZONTAL_BUFFER}px`

/**
 * Optimized cell visibility hook.
 * Uses a single IntersectionObserver per cell with fixed margins.
 * Removed ResizeObserver to reduce overhead - uses fixed buffer instead.
 *
 * Returns `hasBeenVisible` to track if the cell has ever been visible,
 * which prevents showing loading state when scrolling back to already-loaded cells.
 */
export const useCellVisibility = () => {
    const scrollContainer = useVirtualTableScrollContainer()
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    const [isVisible, setIsVisible] = useState(false)
    // Track if cell has ever been visible - once true, stays true (use state for re-render)
    const [hasBeenVisible, setHasBeenVisible] = useState(false)

    const ref = useCallback((node: HTMLDivElement | null) => {
        setElement(node)
    }, [])

    useEffect(() => {
        if (!element) {
            setIsVisible(false)
            return undefined
        }

        const root =
            scrollContainer ??
            element.closest<HTMLDivElement>(".ant-table-body") ??
            element.closest<HTMLDivElement>(".ant-table-body-inner") ??
            null

        if (!root) {
            setIsVisible(true)
            return undefined
        }

        const observer = new IntersectionObserver(
            (entries) => {
                // Only process the first entry since we observe a single element
                const entry = entries[0]
                if (entry) {
                    const nowVisible = entry.isIntersecting
                    setIsVisible(nowVisible)
                    // Once visible, mark as having been visible (only set, never unset)
                    if (nowVisible) {
                        setHasBeenVisible(true)
                    }
                }
            },
            {
                root,
                threshold: 0,
                rootMargin: ROOT_MARGIN,
            },
        )

        observer.observe(element)
        return () => {
            observer.disconnect()
        }
    }, [element, scrollContainer])

    return {ref, isVisible, hasBeenVisible}
}

export default useCellVisibility
