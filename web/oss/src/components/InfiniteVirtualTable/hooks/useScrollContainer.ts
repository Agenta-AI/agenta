import {useEffect, useState} from "react"

interface ScrollContainerResult {
    scrollContainer: HTMLDivElement | null
    visibilityRoot: HTMLDivElement | null
}

/**
 * Hook to detect and track the scrollable container element within the table
 */
const useScrollContainer = (
    containerRef: React.RefObject<HTMLDivElement | null>,
    dependencies: {scrollX?: number | string; scrollY?: number; className?: string},
): ScrollContainerResult => {
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null)
    const [visibilityRoot, setVisibilityRoot] = useState<HTMLDivElement | null>(null)

    useEffect(() => {
        const containerElement = containerRef.current
        if (!containerElement) {
            if (scrollContainer) {
                setScrollContainer(null)
            }
            setVisibilityRoot(null)
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

        if (nextScrollContainer !== scrollContainer) {
            setScrollContainer(nextScrollContainer)
        }

        const headerContainer =
            containerElement.querySelector<HTMLDivElement>(".ant-table-container") ??
            containerElement
        setVisibilityRoot((prev) => (prev === headerContainer ? prev : headerContainer))
    }, [dependencies.scrollX, dependencies.scrollY, dependencies.className, containerRef])

    return {scrollContainer, visibilityRoot}
}

export default useScrollContainer
