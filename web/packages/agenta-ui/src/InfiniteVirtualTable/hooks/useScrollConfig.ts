import {useMemo, useRef, type RefObject} from "react"

import type {TableProps} from "antd/es/table"

import {shallowEqual} from "../utils/columnUtils"

interface UseScrollConfigOptions<RecordType> {
    containerRef: RefObject<HTMLDivElement | null>
    bodyHeight: number | null
    containerWidth: number
    containerHeight: number
    tableHeaderHeight: number | null
    computedScrollX: number
    tableProps?: TableProps<RecordType>
}

interface ScrollConfig {
    x: number | string | boolean | undefined
    y: number | undefined
}

/**
 * Hook to compute scroll configuration for the virtual table
 */
const useScrollConfig = <RecordType>({
    containerRef,
    bodyHeight,
    containerWidth,
    containerHeight,
    tableHeaderHeight,
    computedScrollX,
    tableProps,
}: UseScrollConfigOptions<RecordType>): ScrollConfig => {
    const lastScrollConfigRef = useRef<ScrollConfig | null>(null)

    const scrollConfig = useMemo(() => {
        const resolvedTableProps = tableProps ?? ({} as TableProps<RecordType>)

        if (typeof bodyHeight === "number" && Number.isFinite(bodyHeight)) {
            const resolvedScroll = resolvedTableProps.scroll
            const resolvedX =
                resolvedScroll && typeof resolvedScroll.x !== "undefined"
                    ? resolvedScroll.x
                    : containerWidth > 0
                      ? containerWidth
                      : undefined
            return {x: resolvedX, y: bodyHeight}
        }

        const headerHeight =
            (typeof tableHeaderHeight === "number" && Number.isFinite(tableHeaderHeight)
                ? tableHeaderHeight
                : (containerRef.current?.querySelector(".ant-table-thead") as HTMLElement | null)
                      ?.offsetHeight) ?? null

        const computedY = Math.max((containerHeight ?? 0) - (headerHeight ?? 0), 0)
        const resolvedScroll = resolvedTableProps.scroll
        const requestedY =
            resolvedScroll && typeof resolvedScroll.y === "number" ? resolvedScroll.y : undefined
        const fallbackY = requestedY ?? computedY
        let resolvedY =
            typeof fallbackY === "number" && Number.isFinite(fallbackY) ? fallbackY : undefined

        const resolvedX = (() => {
            const rawX = resolvedScroll?.x
            if (typeof rawX === "number" || typeof rawX === "string") {
                return rawX
            }
            if (Number.isFinite(computedScrollX) && computedScrollX > 0) {
                return computedScrollX
            }
            return containerWidth > 0 ? containerWidth : undefined
        })()

        if (resolvedY === undefined || resolvedY <= 0) {
            const measured = containerHeight ?? 0
            resolvedY = measured > 0 ? Math.max(measured - (headerHeight ?? 0), 0) : 360
        }

        if (resolvedY <= 0) {
            resolvedY = 360
        }

        const nextConfig: ScrollConfig = {
            x: resolvedX,
            y: resolvedY,
        }

        const previous = lastScrollConfigRef.current
        if (shallowEqual(previous, nextConfig)) {
            return previous!
        }
        lastScrollConfigRef.current = nextConfig
        return nextConfig
    }, [
        bodyHeight,
        computedScrollX,
        containerHeight,
        containerRef,
        containerWidth,
        tableHeaderHeight,
        tableProps,
    ])

    return scrollConfig
}

export default useScrollConfig
