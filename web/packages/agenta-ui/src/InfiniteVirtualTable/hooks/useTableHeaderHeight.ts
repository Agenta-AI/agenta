import {useLayoutEffect, useState, type RefObject} from "react"

import type {ColumnsType, TableProps} from "antd/es/table"

interface UseTableHeaderHeightOptions<RecordType> {
    containerRef: RefObject<HTMLDivElement | null>
    columns: ColumnsType<RecordType>
    dataSource: RecordType[]
    components?: TableProps<RecordType>["components"]
}

/**
 * Hook to observe and track table header height using ResizeObserver
 */
const useTableHeaderHeight = <RecordType>({
    containerRef,
    columns,
    dataSource,
    components,
}: UseTableHeaderHeightOptions<RecordType>) => {
    const [tableHeaderHeight, setTableHeaderHeight] = useState<number | null>(null)

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) {
            setTableHeaderHeight(null)
            return
        }
        const headerEl =
            container.querySelector<HTMLElement>(".ant-table-thead") ??
            container.querySelector<HTMLElement>("table thead")
        if (!headerEl) {
            setTableHeaderHeight(null)
            return
        }
        const updateHeight = () => {
            const nextHeight = headerEl.getBoundingClientRect().height
            setTableHeaderHeight((prev) => {
                if (prev === nextHeight) return prev
                return Number.isFinite(nextHeight) ? nextHeight : prev
            })
        }
        const observer = new ResizeObserver(() => updateHeight())
        observer.observe(headerEl)
        updateHeight()
        return () => observer.disconnect()
    }, [columns, containerRef, dataSource, components])

    return tableHeaderHeight
}

export default useTableHeaderHeight
