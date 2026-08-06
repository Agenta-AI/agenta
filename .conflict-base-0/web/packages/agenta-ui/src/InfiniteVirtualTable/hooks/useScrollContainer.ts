import {useEffect, useRef, useState} from "react"

interface ScrollContainerResult {
    scrollContainer: HTMLDivElement | null
    visibilityRoot: HTMLDivElement | null
}

/**
 * Hook to detect and track the scrollable container element within the table.
 * Optimized to avoid unnecessary state updates during scroll.
 */
const useScrollContainer = (
    containerRef: React.RefObject<HTMLDivElement | null>,
    dependencies: {scrollX?: number | string; scrollY?: number; className?: string},
): ScrollContainerResult => {
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null)
    const [visibilityRoot, setVisibilityRoot] = useState<HTMLDivElement | null>(null)
    // Track last known elements to avoid redundant state updates
    const lastScrollContainerRef = useRef<HTMLDivElement | null>(null)
    const lastVisibilityRootRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const containerElement = containerRef.current
        if (!containerElement) {
            if (lastScrollContainerRef.current !== null) {
                lastScrollContainerRef.current = null
                setScrollContainer(null)
            }
            if (lastVisibilityRootRef.current !== null) {
                lastVisibilityRootRef.current = null
                setVisibilityRoot(null)
            }
            return
        }

        const tableBody = containerElement.querySelector<HTMLDivElement>(".ant-table-body") ?? null

        const isScrollable = (element: HTMLDivElement | null) => {
            if (!element) return false
            const style = window.getComputedStyle(element)
            const overflowValues = [style.overflow, style.overflowX, style.overflowY]
            return overflowValues.some((value) => ["auto", "scroll", "overlay"].includes(value))
        }

        const preferredContainer = isScrollable(tableBody) ? tableBody : null
        const nextScrollContainer = preferredContainer ?? containerElement

        // Only update state if the element reference actually changed
        if (nextScrollContainer !== lastScrollContainerRef.current) {
            lastScrollContainerRef.current = nextScrollContainer
            setScrollContainer(nextScrollContainer)
        }

        const headerContainer =
            containerElement.querySelector<HTMLDivElement>(".ant-table-container") ??
            containerElement

        if (headerContainer !== lastVisibilityRootRef.current) {
            lastVisibilityRootRef.current = headerContainer
            setVisibilityRoot(headerContainer)
        }
    }, [dependencies.scrollX, dependencies.scrollY, dependencies.className, containerRef])

    return {scrollContainer, visibilityRoot}
}

export default useScrollContainer
