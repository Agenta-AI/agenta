import {useCallback, useEffect, useMemo, useState} from "react"

import {useVirtualTableScrollContainer} from "@/oss/components/InfiniteVirtualTable"

const COLUMN_LOOKAHEAD = 1.6
const ROW_LOOKAHEAD = 2
const MIN_HORIZONTAL_BUFFER = 120
const MAX_HORIZONTAL_BUFFER = 800
const MIN_VERTICAL_BUFFER = 160
const MAX_VERTICAL_BUFFER = 400

export const useCellVisibility = () => {
    const scrollContainer = useVirtualTableScrollContainer()
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    const [isVisible, setIsVisible] = useState(false)
    const [dimensions, setDimensions] = useState<{width: number; height: number}>({
        width: 0,
        height: 0,
    })

    const ref = useCallback((node: HTMLDivElement | null) => {
        setElement(node)
    }, [])

    useEffect(() => {
        if (!element) {
            setDimensions({width: 0, height: 0})
            return undefined
        }

        if (typeof ResizeObserver === "undefined") {
            const rect = element.getBoundingClientRect()
            setDimensions({
                width: rect.width,
                height: rect.height,
            })
            return undefined
        }

        const resizeObserver = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.target === element) {
                    const {width, height} = entry.contentRect
                    setDimensions({
                        width: width || element.offsetWidth || 0,
                        height: height || element.offsetHeight || 0,
                    })
                }
            })
        })

        resizeObserver.observe(element)
        return () => {
            resizeObserver.disconnect()
        }
    }, [element])

    const horizontalBuffer = useMemo(() => {
        const base = dimensions.width ? dimensions.width * COLUMN_LOOKAHEAD : MIN_HORIZONTAL_BUFFER
        return Math.max(
            MIN_HORIZONTAL_BUFFER,
            Math.min(base || MIN_HORIZONTAL_BUFFER, MAX_HORIZONTAL_BUFFER),
        )
    }, [dimensions.width])

    const verticalBuffer = useMemo(() => {
        const base = dimensions.height ? dimensions.height * ROW_LOOKAHEAD : MIN_VERTICAL_BUFFER
        return Math.max(
            MIN_VERTICAL_BUFFER,
            Math.min(base || MIN_VERTICAL_BUFFER, MAX_VERTICAL_BUFFER),
        )
    }, [dimensions.height])

    const rootMargin = useMemo(
        () => `${verticalBuffer}px ${horizontalBuffer}px ${verticalBuffer}px ${horizontalBuffer}px`,
        [horizontalBuffer, verticalBuffer],
    )

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
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.target === element) {
                        setIsVisible(entry.isIntersecting || !root)
                    }
                })
            },
            {
                root,
                threshold: 0,
                rootMargin,
            },
        )

        observer.observe(element)
        return () => {
            observer.disconnect()
        }
    }, [element, scrollContainer, rootMargin])

    return {ref, isVisible}
}

export default useCellVisibility
